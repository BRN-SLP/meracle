/**
 * Carrefour France scraper, via Browser Use Cloud + Playwright CDP.
 *
 * Carrefour.fr sits behind Akamai Bot Manager. Direct curl returns 403
 * even with a desktop UA, and a naive headless playwright trips the
 * same fingerprint. We work around it by driving a remote chromium
 * that Browser Use Cloud provisions with a FR residential proxy.
 *
 * Strategy:
 *   1. Spin up remote browser (FR proxy, ~5 min session)
 *   2. Warm cookies with a homepage visit (Akamai issues a free pass
 *      cookie on a clean homepage hit; the search request rides it)
 *   3. Navigate to /s?q=<query> for each target slug
 *   4. Extract product cards from the rendered DOM
 *   5. Filter with a per-slug picker, pick cheapest match
 *
 * Carrefour ships product detail URLs as /p/<slug>-<id>. The PLP
 * embeds schema.org Product JSON-LD blocks (one per visible tile) so
 * we parse those first and fall back to anchor scraping if the LD
 * block is missing or malformed.
 *
 * Pickers are added in follow-up commits one slug-group at a time.
 * An empty PICKERS map is valid; scrapeCarrefourFr() reports every FR
 * target as a miss with reason "no picker configured", and the batch
 * pipeline tolerates that gracefully.
 *
 * The DOM selectors below are MVP-blind, they may need a tweak after
 * the first live run. The picker logic itself is product-agnostic so
 * a selector change is a one-line fix in scrapeOneSearch.
 */
import { chromium } from "playwright-core";
import type { Browser } from "playwright-core";

import { withSession } from "../browseruse.js";
import type { ProductTarget } from "../products.js";
import { targetsForRetailer } from "../products.js";
import type { ScrapedProduct, ScraperResult } from "../types.js";

const BASE = "https://www.carrefour.fr";
// 16 sequential searches under one session. Homepage warm + 16 navs +
// hydration waits typically fit inside 3 min on a warm proxy. 5 min
// cap is a safety belt; Browser Use bills per actual second.
const SESSION_TIMEOUT_MIN = 5;

interface FrPicker {
  /** French search keyword. */
  query: string;
  /** Product title must match. */
  include: RegExp;
  /** Product title MUST NOT match. */
  exclude: readonly RegExp[];
  /** Pack size in target.unit (g or mL or pcs). */
  sizeRange: { min: number; max: number };
}

// Pickers are added in follow-up commits one slug-group at a time.
// 5 thematic PRs: dairy, dry goods, produce, meat, beverages.
const PICKERS: Partial<Record<ProductTarget["slug"], FrPicker>> = {};

export interface ParsedProduct {
  title: string;
  priceMajor: number;
  packSize: number;
  sourceUrl: string;
}

/**
 * Parse a size in grams, millilitres, or pieces from a product label.
 *
 * French label idioms:
 *   "Lait demi-écrémé UHT 1 L"     -> 1000 mL
 *   "Beurre doux 250 g"            -> 250 g
 *   "Sucre en poudre 1 kg"         -> 1000 g
 *   "Eau de source 1,5 L"          -> 1500 mL
 *   "12 oeufs frais bio"           -> 12 pieces
 *   "Heineken 33 cl"               -> 330 mL
 *   "Pommes Gala 1 kg"             -> 1000 g
 */
export function parseSize(text: string): number | null {
  // Piece counts first (FR egg labels: "12 oeufs", "Boîte de 12",
  // "Pack de 10"). Tried before weight so "10 oeufs frais" doesn't
  // accidentally trip the grams regex via stray "10 g" further down.
  let m = text.match(/\b(\d+)\s*œ?(?:o|0)?eufs?\b/i);
  if (m) return Number.parseInt(m[1]!, 10);
  m = text.match(/\b(?:bo[iî]te|pack|lot|paquet)\s+de\s+(\d+)\b/i);
  if (m) return Number.parseInt(m[1]!, 10);
  m = text.match(/\bx\s*(\d+)\b/i);
  if (m && /œuf|oeuf/i.test(text)) return Number.parseInt(m[1]!, 10);

  // mL (most specific)
  m = text.match(/(\d+(?:[.,]\d+)?)\s*ml\b/i);
  if (m) return Number.parseFloat(m[1]!.replace(",", "."));

  // cL (centilitres, common for beverages in France)
  m = text.match(/(\d+(?:[.,]\d+)?)\s*cl\b/i);
  if (m) return Number.parseFloat(m[1]!.replace(",", ".")) * 10;

  // L / litre / litres
  m = text.match(/(\d+(?:[.,]\d+)?)\s*(?:litres?|L)\b/i);
  if (m) return Number.parseFloat(m[1]!.replace(",", ".")) * 1000;

  // kg
  m = text.match(/(\d+(?:[.,]\d+)?)\s*kg\b/i);
  if (m) return Number.parseFloat(m[1]!.replace(",", ".")) * 1000;

  // grams (least specific, last)
  m = text.match(/(\d+(?:[.,]\d+)?)\s*g\b/i);
  if (m) return Number.parseFloat(m[1]!.replace(",", "."));

  return null;
}

/**
 * Parse an EUR price (1,99 €, 12,34€, "1.99 €") from a label.
 *
 * French standard uses a comma decimal separator with a trailing
 * euro sign. Some Carrefour widgets render the euro sign as a
 * separate span, so we accept whitespace between the number and €.
 */
export function parsePrice(text: string): number | null {
  const m = text.match(/(\d+(?:[.,]\d+)?)\s*€/);
  if (m) return Number.parseFloat(m[1]!.replace(",", "."));
  return null;
}

/**
 * Extract product cards from the rendered HTML. Tries JSON-LD first
 * (the modern schema.org embed pattern most retailers ship) and
 * falls back to an anchor scrape that looks for Carrefour's PDP
 * route (`/p/...`).
 *
 * Exported so unit tests can feed in fixtures.
 */
export function parseProductsFromHtml(
  html: string,
  baseUrl = BASE,
): ParsedProduct[] {
  const out: ParsedProduct[] = [];

  // 1) JSON-LD ItemList / Product blocks.
  const ldMatches = html.match(
    /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi,
  );
  if (ldMatches) {
    for (const block of ldMatches) {
      const inner = block.replace(/<script[^>]*>|<\/script>/gi, "");
      try {
        const data = JSON.parse(inner) as unknown;
        const items = Array.isArray(data)
          ? data
          : typeof data === "object" && data !== null
            ? [data]
            : [];
        const flat: Array<Record<string, unknown>> = [];
        const walk = (n: unknown): void => {
          if (Array.isArray(n)) n.forEach(walk);
          else if (n && typeof n === "object") {
            const obj = n as Record<string, unknown>;
            flat.push(obj);
            for (const v of Object.values(obj)) walk(v);
          }
        };
        items.forEach(walk);
        for (const node of flat) {
          if (node["@type"] !== "Product") continue;
          const title =
            typeof node.name === "string" ? node.name : null;
          const offers = node.offers as Record<string, unknown> | undefined;
          const priceRaw =
            offers && typeof offers === "object"
              ? (offers as Record<string, unknown>).price
              : undefined;
          const price =
            typeof priceRaw === "string"
              ? Number.parseFloat(priceRaw.replace(",", "."))
              : typeof priceRaw === "number"
                ? priceRaw
                : null;
          const urlRaw = typeof node.url === "string" ? node.url : null;
          if (title && price !== null && Number.isFinite(price)) {
            const size = parseSize(title);
            if (size !== null) {
              out.push({
                title,
                priceMajor: price,
                packSize: size,
                sourceUrl: urlRaw
                  ? new URL(urlRaw, baseUrl).toString()
                  : baseUrl,
              });
            }
          }
        }
      } catch {
        // Non-JSON or malformed LD block, skip.
      }
    }
  }

  // 2) Fallback: anchor scrape, find "<a href='/p/...'> ... title ... 1,99€ ... 1L </a>"
  if (out.length === 0) {
    const anchorRegex =
      /<a[^>]+href="([^"]*\/p\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let m: RegExpExecArray | null;
    while ((m = anchorRegex.exec(html)) !== null) {
      const href = m[1]!;
      const body = m[2]!.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      const price = parsePrice(body);
      const size = parseSize(body);
      if (price && size && body.length > 5) {
        out.push({
          title: body,
          priceMajor: price,
          packSize: size,
          sourceUrl: new URL(href, baseUrl).toString(),
        });
      }
    }
  }

  return out;
}

function pickBestMatch(
  products: ParsedProduct[],
  picker: FrPicker,
): ParsedProduct | null {
  const candidates = products.filter((p) => {
    if (!picker.include.test(p.title)) return false;
    if (picker.exclude.some((rx) => rx.test(p.title))) return false;
    if (p.packSize < picker.sizeRange.min || p.packSize > picker.sizeRange.max)
      return false;
    return true;
  });
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.priceMajor - b.priceMajor);
  return candidates[0]!;
}

/**
 * Drive a remote chromium through a homepage warm + search navigation,
 * then extract product tiles via DOM queries inside the page context.
 *
 * Carrefour's PLP markup is React-rendered; tiles typically expose
 * `<a href="/p/...">` with a `data-testid` attribute on the wrapper.
 * The DOM scrape below is best-effort, the JSON-LD path in
 * parseProductsFromHtml is the durable primary surface.
 */
async function scrapeOneSearch(
  browser: Browser,
  query: string,
): Promise<ParsedProduct[]> {
  const context =
    browser.contexts()[0] ?? (await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
      locale: "fr-FR",
    }));
  const page = context.pages()[0] ?? (await context.newPage());

  // Warm cookies on the homepage so Akamai issues the bot-pass cookie
  // before our search request. Skip this and the very first /s?q= hit
  // tends to draw a 403.
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(3000);

  const url = `${BASE}/s?q=${encodeURIComponent(query)}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  // Carrefour lazy-renders tiles after the search API responds. Poll
  // for any product anchor before reading, fall through on timeout so
  // the empty result is reported as a miss.
  await page
    .waitForFunction(
      () => document.querySelectorAll('a[href*="/p/"]').length > 0,
      { timeout: 15000 },
    )
    .catch(() => {
      // No tiles within 15 s, fall through to extract whatever DOM
      // returned. The empty result is reported as a miss upstream.
    });

  const html = await page.content();
  return parseProductsFromHtml(html);
}

/**
 * Live scrape, exported entry point. Requires BROWSER_USE_API_KEY.
 */
export async function scrapeCarrefourFr(): Promise<ScraperResult> {
  const targets = targetsForRetailer("carrefour-fr");
  const scrapedAt = new Date().toISOString();
  const scraped: ScrapedProduct[] = [];
  const misses: ScraperResult["misses"] = [];

  await withSession("fr", SESSION_TIMEOUT_MIN, async (session) => {
    if (!session.cdpUrl) {
      throw new Error("Browser Use session has no cdpUrl");
    }
    const browser = await chromium.connectOverCDP(session.cdpUrl);
    try {
      for (const target of targets) {
        const picker = PICKERS[target.slug];
        if (!picker) {
          misses.push({ target, reason: "no picker configured for this slug" });
          continue;
        }
        let parsed: ParsedProduct[];
        try {
          parsed = await scrapeOneSearch(browser, picker.query);
        } catch (e: unknown) {
          const reason = e instanceof Error ? e.message : String(e);
          misses.push({ target, reason: `fetch: ${reason}` });
          continue;
        }
        const match = pickBestMatch(parsed, picker);
        if (!match) {
          misses.push({
            target,
            reason: `no match for "${picker.query}" (${parsed.length} candidates parsed)`,
          });
          continue;
        }
        scraped.push({
          target,
          retailerSku: match.sourceUrl.split("/").pop() ?? match.title,
          retailerTitle: match.title,
          priceMajor: match.priceMajor,
          packSize: match.packSize,
          scrapedAt,
          sourceUrl: match.sourceUrl,
        });
      }
    } finally {
      await browser.close();
    }
  });

  return { retailer: "carrefour-fr", scraped, misses };
}
