/**
 * Sainsbury's UK scraper, via Browser Use Cloud + Playwright CDP.
 *
 * Sainsbury's e-commerce sits behind Akamai Bot Manager which kills
 * direct fetch + naive headless playwright. We work around it by
 * driving a remote chromium that Browser Use Cloud provisions with a
 * UK residential proxy.
 *
 * Strategy:
 *   1. Spin up remote browser (UK proxy, ~5 min session)
 *   2. Warm cookies with a homepage visit
 *   3. Navigate to the search URL for the target slug
 *   4. Extract product cards from the rendered DOM
 *   5. Filter with a per-slug picker, pick cheapest match
 *
 * The DOM selectors below are MVP-blind, they may need a tweak after
 * the first live run. The picker logic itself is product-agnostic so
 * a selector change is a one-line fix in PARSE_RULES.
 */
import { chromium } from "playwright-core";
import type { Browser } from "playwright-core";

import { withSession } from "../browseruse.js";
import type { ProductTarget } from "../products.js";
import { targetsForRetailer } from "../products.js";
import type { ScrapedProduct, ScraperResult } from "../types.js";

const BASE = "https://www.sainsburys.co.uk";
// One scrape (homepage warm + 2 searches + DOM extract) finishes in
// well under a minute. Browser Use Cloud bills only for the time the
// session is actually alive, but a tight timeout is a safety belt:
// if our code hangs, the session auto-kills before draining credits.
const SESSION_TIMEOUT_MIN = 2;

interface UkPicker {
  /** Search keyword. */
  query: string;
  /** Product title must match. */
  include: RegExp;
  /** Product title MUST NOT match. */
  exclude: readonly RegExp[];
  /** Pack size in target.unit (g or mL). */
  sizeRange: { min: number; max: number };
}

const PICKERS: Partial<Record<ProductTarget["slug"], UkPicker>> = {
  bread_500g: {
    query: "white loaf",
    include: /\bwhite\b.*\b(loaf|bread)\b|\b(loaf|bread)\b.*\bwhite\b/i,
    exclude: [
      /\b(thick|seeded|wholemeal|brown|tiger|sourdough|rye|burger|gluten)\b/i,
    ],
    sizeRange: { min: 300, max: 900 },
  },
  milk_1l: {
    query: "milk whole",
    include: /\bwhole\b.*\bmilk\b|\bmilk\b.*\bwhole\b/i,
    exclude: [
      /\b(semi|skimmed|skim|chocolate|strawberry|powder|condensed|infant|baby|formula|oat|almond|coconut|soya|soy|lactose-free)\b/i,
    ],
    sizeRange: { min: 800, max: 1300 },
  },
  // UK eggs ship in 6 / 10 / 12 packs, catalog target is 12. Allow the
  // wider band, normalize.ts rescales the price per packSize.
  eggs_12: {
    query: "free range eggs",
    include: /\beggs?\b/i,
    exclude: [
      /\b(quail|chocolate|easter|hatching|painted|scotch|nesting|substitute)\b/i,
    ],
    sizeRange: { min: 6, max: 12 },
  },
  butter_200g: {
    query: "butter unsalted",
    include: /\bbutter\b/i,
    exclude: [
      /\b(spread|margarine|peanut|cashew|almond|cocoa|chocolate|garlic|herb|whipped|salted-caramel|toffee|brandy|biscuit)\b/i,
    ],
    sizeRange: { min: 180, max: 300 },
  },
  sugar_1kg: {
    query: "white sugar 1kg",
    include: /\b(white|granulated)\s+sugar\b|\bsugar\b/i,
    exclude: [
      /\b(icing|caster|brown|demerara|muscovado|golden|cane|cube|cinnamon|vanilla|stevia|sweetener|coconut)\b/i,
    ],
    sizeRange: { min: 800, max: 1200 },
  },
  rice_1kg: {
    query: "long grain rice 1kg",
    include: /\brice\b/i,
    exclude: [
      /\b(noodle|cake|crispies|pudding|milk|drink|wine|vinegar|paper|flour|popped|porridge|microwave|ready)\b/i,
    ],
    sizeRange: { min: 800, max: 1200 },
  },
  // Sainsbury's lists fresh tomatoes both as loose punnets ("Salad
  // Tomatoes 500g") and as 1 kg bags. Sainsbury's UK uses a packSize
  // tail in grams, so the picker filters down to ~1 kg packs and
  // rejects cherry / vine specialty SKUs that ship at 250-500 g.
  tomatoes_1kg: {
    query: "tomatoes 1kg",
    include: /\btomato/i,
    exclude: [
      /\b(paste|puree|ketchup|sauce|sundried|sun-dried|dried|tinned|canned|chopped|passata|juice|seeds)\b/i,
    ],
    sizeRange: { min: 800, max: 1200 },
  },
};

interface ParsedProduct {
  title: string;
  priceMajor: number;
  packSize: number;
  sourceUrl: string;
}

/**
 * Parse a size in grams or mL from a product label tail.
 *
 *   "Sainsbury's White Bread, 800g" -> 800
 *   "Sainsbury's Whole Milk, 2.272L (4 pints)" -> 2272
 *   "Whole Milk 1 Litre" -> 1000
 */
export function parseSize(text: string): number | null {
  // Piece counts first (UK egg packs: "12 Eggs", "Free Range Eggs x 10",
  // "10 pack"). Tried before weight/volume so a "10 Large Eggs" label
  // doesn't accidentally grab the "10" via the grams regex.
  let m = text.match(/(\d+)\s*(?:large |medium |mixed |free range |organic )*eggs?\b/i);
  if (m) return Number.parseInt(m[1], 10);
  m = text.match(/\bx\s*(\d+)\b/i);
  if (m && /eggs?/i.test(text)) return Number.parseInt(m[1], 10);
  m = text.match(/(\d+)\s*pack\b/i);
  if (m && /eggs?/i.test(text)) return Number.parseInt(m[1], 10);

  // ml first (more specific than g)
  m = text.match(/(\d+(?:[.,]\d+)?)\s*ml\b/i);
  if (m) return Number.parseFloat(m[1].replace(",", "."));

  // litres / L
  m = text.match(/(\d+(?:[.,]\d+)?)\s*(?:litre|liter|L)\b/i);
  if (m) return Number.parseFloat(m[1].replace(",", ".")) * 1000;

  // pints (UK)
  m = text.match(/(\d+(?:[.,]\d+)?)\s*pints?\b/i);
  if (m) return Number.parseFloat(m[1].replace(",", ".")) * 568; // imperial pint = 568.26 mL

  // kg
  m = text.match(/(\d+(?:[.,]\d+)?)\s*kg\b/i);
  if (m) return Number.parseFloat(m[1].replace(",", ".")) * 1000;

  // grams (least specific, last)
  m = text.match(/(\d+(?:[.,]\d+)?)\s*g\b/i);
  if (m) return Number.parseFloat(m[1].replace(",", "."));

  return null;
}

/**
 * Parse a GBP price (£0.85, £1.20, etc.) from a label.
 */
export function parsePrice(text: string): number | null {
  const m = text.match(/£\s*(\d+(?:[.,]\d+)?)/);
  if (m) return Number.parseFloat(m[1].replace(",", "."));
  return null;
}

/**
 * Extract product cards from the rendered HTML. Heuristic-based,
 * tries several common Sainsbury's selectors, falls through to a
 * generic "anchor to /gol-ui/product/ with text + price" pass.
 *
 * Exported so unit tests can feed in fixtures.
 */
export function parseProductsFromHtml(
  html: string,
  baseUrl = BASE,
): ParsedProduct[] {
  const out: ParsedProduct[] = [];

  // 1) JSON-LD ItemList / Product blocks (most retailers embed these).
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
              ? Number.parseFloat(priceRaw)
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

  // 2) Fallback: anchor scrape — look for "<a href='/gol-ui/product/...'> ... £x.xx ... 800g </a>"
  if (out.length === 0) {
    const anchorRegex =
      /<a[^>]+href="([^"]*\/gol-ui\/product\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
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
  picker: UkPicker,
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
 * Sainsbury's renders each product as `<a title="..." class="pt__link"
 * href="...">` for the title (no inner text, anchor body is decorative)
 * and a sibling `.pt__cost` element for the price. The two live inside
 * the same product tile container, so we walk up from the title anchor
 * to the tile root, then scope the price lookup to that subtree.
 */
async function scrapeOneSearch(
  browser: Browser,
  query: string,
): Promise<ParsedProduct[]> {
  // Browser Use sessions have an existing context+page, prefer that
  // when present to avoid double-spawning.
  const context =
    browser.contexts()[0] ?? (await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    }));
  const page = context.pages()[0] ?? (await context.newPage());

  // Warm cookies: visit homepage first. Akamai often gives a free
  // pass cookie for a clean homepage hit, then category requests
  // ride that cookie.
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2000);

  const url = `${BASE}/gol-ui/SearchResults/${encodeURIComponent(query)}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  // Sainsbury's lazy-loads product tiles after initial paint.
  await page.waitForTimeout(5000);

  const raw = await page.evaluate(() => {
    const out: Array<{ title: string; priceText: string | null; href: string }> = [];
    // The title anchor carries `title="<full name>"`, is the cleanest
    // signal. Walk up to the tile container (`.pt`), then read the
    // first .pt__cost text inside that subtree.
    const anchors = document.querySelectorAll<HTMLAnchorElement>(
      'a.pt__link[href*="/gol-ui/product/"][title]',
    );
    for (const a of Array.from(anchors)) {
      const tile = a.closest(".pt") ?? a.closest("[class*='product-tile']") ?? a.parentElement;
      const costEl = tile?.querySelector(".pt__cost, [class*='pricing__now'], [class*='pt-cost']");
      out.push({
        title: a.getAttribute("title") ?? "",
        priceText: costEl?.textContent?.trim() ?? null,
        href: a.href,
      });
    }
    return out;
  });

  const products: ParsedProduct[] = [];
  for (const r of raw) {
    if (!r.title || !r.priceText) continue;
    const price = parsePrice(r.priceText);
    const size = parseSize(r.title);
    if (price === null || size === null) continue;
    products.push({
      title: r.title,
      priceMajor: price,
      packSize: size,
      sourceUrl: r.href,
    });
  }
  return products;
}

/**
 * Live scrape, exported entry point. Requires BROWSER_USE_API_KEY.
 */
export async function scrapeSainsburysUk(): Promise<ScraperResult> {
  const targets = targetsForRetailer("sainsburys-uk");
  const scrapedAt = new Date().toISOString();
  const scraped: ScrapedProduct[] = [];
  const misses: ScraperResult["misses"] = [];

  await withSession("uk", SESSION_TIMEOUT_MIN, async (session) => {
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

  return { retailer: "sainsburys-uk", scraped, misses };
}
