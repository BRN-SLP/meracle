/**
 * Conad Italy scraper, via Browser Use Cloud + Playwright CDP.
 *
 * Conad's online store (spesaonline.conad.it) sits behind a SAP
 * Commerce (Hybris) OCC API at api.cfp5zmx7oc-conadscrl1-d1-public
 * .model-t.cc.commerce.ondemand.com. The OCC endpoint demands an
 * OAuth bearer token + recaptcha enterprise + storeId, so a direct
 * fetch is blocked at the CORS layer. We work around it by driving
 * a remote chromium that Browser Use Cloud provisions with an IT
 * residential proxy, letting JS hydration populate prices.
 *
 * Strategy:
 *   1. Spin up remote browser (IT proxy, ~5 min session)
 *   2. Warm cookies + select a default store via homepage visit
 *   3. Navigate to the search URL for the target slug
 *   4. Wait for JS hydration (data-product[basePrice > 0] cards)
 *   5. Extract product cards from the rendered DOM
 *   6. Filter with a per-slug picker, pick cheapest match
 *
 * Conad embeds product metadata directly in each card via a
 * `data-product='{"code":"...", "nome":"...", "netQuantity":..., ...}'
 * JSON attribute. The pre-hydration SSR ships `basePrice: 0` for most
 * cards; after the OCC fetch lands, the active store's prices are
 * populated. The scraper waits for at least one priced card before
 * reading.
 *
 * Picker config lives next to the scraper, NOT in ProductTarget, so
 * ProductTarget stays retailer-agnostic.
 */
import { chromium } from "playwright-core";
import type { Browser } from "playwright-core";

import { withSession } from "../browseruse.js";
import type { ProductTarget } from "../products.js";
import { targetsForRetailer } from "../products.js";
import type { ScrapedProduct, ScraperResult } from "../types.js";

const BASE = "https://spesaonline.conad.it";
// 16 sequential searches under one session. Homepage warm + 16 navs +
// hydration waits typically finishes in 2-3 min. 5 min cap is a safety
// belt; Browser Use bills per actual second so the cap is a guard, not
// the target.
const SESSION_TIMEOUT_MIN = 5;

interface ConadPicker {
  /** Italian search keyword. */
  query: string;
  /** Product name (nome) must match. */
  include: RegExp;
  /** Product name MUST NOT match. */
  exclude: readonly RegExp[];
  /** Pack size in target.unit (g or mL or pcs). */
  sizeRange: { min: number; max: number };
}

// Pickers are added in follow-up commits one slug-group at a time.
// An empty PICKERS map is valid; scrapeConadIt() reports every IT
// target as a miss with reason "no picker configured", and the batch
// pipeline tolerates that gracefully.
const PICKERS: Partial<Record<ProductTarget["slug"], ConadPicker>> = {
  // Whole milk (latte intero). Italian milk is sold UHT (long-life,
  // 1 L bricks) and fresco (refrigerated, 1 L bottles). Conad's
  // own-brand "Latte Intero UHT 1 L" is the mass-market staple.
  // sizeRange 800-1100 ml allows for the rare 900 / 1000 / 1050 ml
  // variant, normalize.ts rescales to canonical 1000.
  milk_1l: {
    query: "latte intero",
    include: /\blatte\b.*\bintero\b|\bintero\b.*\blatte\b/i,
    exclude: [
      /\b(scremato|parzialmente|delattosato|senza lattosio|cappuccino|cacao|cioccolat|caffè|caffe|fragola|vaniglia|miele|condensato|polvere|infante|crescita|bevanda|soia|riso|mandorla|cocco|avena|kefir|yogurt|panna|crema|alta digeribilità)\b/i,
    ],
    sizeRange: { min: 800, max: 1100 },
  },
  // Fresh eggs, 6-pack standard. Conad ships "6 Uova Fresche da
  // Galline Allevate a Terra" at EUR 1.99 (probed live). 12-packs
  // (the catalog canonical) and 10-packs both exist; sizeRange 6..12
  // catches all, normalize.ts rescales 6 / 10 / 12 to per-12 price.
  eggs_12: {
    query: "uova fresche",
    include: /\b\d+\s+uova\b/i,
    exclude: [
      /\b(quaglia|anatra|oca|cioccolat|pasqua|paste|tortelloni|ravioli|tagliatell|gelato|maionese|liquid|albume|tuorlo)\b/i,
    ],
    sizeRange: { min: 6, max: 12 },
  },
  // Butter (burro). Italian standard sizes: 125g / 200g / 250g /
  // 500g bricks. The canonical 200g slug matches the 200-250g typical
  // pack. sizeRange 180-300g catches 200g and 250g, normalize.ts
  // rescales to per-200g.
  butter_200g: {
    query: "burro",
    include: /\bburro\b/i,
    exclude: [
      /\b(margarina|spalmabile|chiarificato|ghi|anidro|cacao|cioccolat|noci|nocciol|arachidi|sesamo|mandorl|spread|biscott|brioche|crema|salat|aromatizzat)\b/i,
    ],
    sizeRange: { min: 180, max: 300 },
  },
  // Hard cheese wedges. Italy's mass-market staple is Parmigiano
  // Reggiano / Grana Padano in 200-500g wedges. Conad ships these
  // alongside Asiago, Pecorino, Provolone, Caciocavallo. The picker
  // accepts any hard / aged cheese variant; cheapest per pack wins.
  // After normalize.ts rescaling to canonical 500g, the on-chain
  // price is priceMajor * (500 / packSize).
  //
  // Excludes:
  // - Soft / fresh cheeses (mozzarella, ricotta, mascarpone, fresco)
  // - Branded soft (philadelphia, brie, camembert, feta, halloumi)
  // - Spreads / slices / cubes / shavings (snack packaging)
  // - Flavored / smoked variants (al tartufo, alla pepe, affumicato)
  // - 'Formaggio fuso' (processed cheese) substitutes
  cheese_local_500g: {
    query: "formaggio grattugiato",
    include: /\b(parmigiano|grana padano|grana|asiago|pecorino|provolone|caciocavallo|fontina|montasio|gruviera|emmental|sbrinz)\b/i,
    exclude: [
      /\b(grattugia|grattugiato|fiocchi|scaglie|fuso|spalmabile|fett|cubett|tagliat|filant|stick|snack|portatile|baby|porzion)\b/i,
      /\b(mozzarell|ricott|mascarpon|crescenz|stracchin|robiola|caprino|tomino|burrata|burrini|fresco|fresch)\b/i,
      /\b(philadelphia|brie|camembert|feta|halloumi|paneer|gorgonzola|stilton|cheddar|gouda|edam|brunost)\b/i,
      /\b(tartuf|peperoncin|piccant|affumicat|alle erbe|al pepe|al cumino|al peperone|alla noce|al miele)\b/i,
      /\b(vegan|vegetal|senza lattosio|delattosato)\b/i,
      /\b(prodotto|imitazione|sostituto)\b/i,
    ],
    sizeRange: { min: 350, max: 600 },
  },
  // White bread, sliced (pane in cassetta / pane bianco a fette).
  // Italian mass-market staple is the 400-500 g sliced loaf. Conad
  // sells own-brand "Pane Bianco a Fette" at ~EUR 1.20-1.50.
  bread_500g: {
    query: "pane in cassetta",
    include: /\bpan(e|ino)\b/i,
    exclude: [
      /\b(integrale|cereali|semi|noci|olive|tostat|grissini|cracker|focaccia|pizza|piadina|carasau|carrè|carre|raffermo|crouton|panko|dolce|farcito|brioche|pagnotta|baguett|ciabatta|nero|carbone|farro|kamut|orzo|segale|avena)\b/i,
    ],
    sizeRange: { min: 300, max: 700 },
  },
  // White granulated sugar (zucchero bianco / semolato). Conad ships
  // own-brand "Zucchero Semolato 1 kg" as the staple. Excludes brown,
  // cane, icing, vanilla-flavored, and sweetener substitutes.
  sugar_1kg: {
    query: "zucchero",
    include: /\bzucchero\b/i,
    exclude: [
      /\b(canna|integrale|grezzo|moscovado|bruno|panela|vanigliato|vaniglia|velo|impalpabile|stevia|dolcificante|fruttosio|maltitolo|saccarina|eritritolo|aspartam)\b/i,
    ],
    sizeRange: { min: 800, max: 1200 },
  },
  // Rice (riso). Italian rice varieties for risotto (Arborio,
  // Carnaroli, Vialone Nano) plus long-grain (basmati, parboiled,
  // jasmine, lungo). The picker accepts any pure rice 800-1200 g.
  // Cheapest wins, which tends to be Arborio / long-grain Conad own.
  rice_1kg: {
    query: "riso",
    include: /\briso\b/i,
    exclude: [
      /\b(latte|bevanda|sciroppo|farina|aceto|gallett|cracker|biscott|tortin|barrett|insalata|nero|venere|integrale)\b/i,
      /\b(precotto|microond|pronto|surgelat|congelat|cotto)\b/i,
      /\b(pilaf|sushi|orientale|cinese|thai|esotic)\b/i,
    ],
    sizeRange: { min: 800, max: 1200 },
  },
  // Olive oil (olio di oliva). Italy is the canonical source: extra
  // virgin (extravergine), virgin (vergine), refined (raffinato).
  // Conad ships own-brand "Olio Extra Vergine di Oliva" 1 L bottles
  // at EUR 5-7. Excludes blends, flavored, and seed oils.
  olive_oil_1l: {
    query: "olio extra vergine oliva",
    include: /\bolio\b.*\boliv/i,
    exclude: [
      /\b(girasol|semi|mais|colza|arachidi|sesamo|palm|coco|burro)\b/i,
      /\b(aromatizz|aromatic|tartuf|aglio|limon|peperonc|rosmarino|basilico|origano|menta|chili|ervas|infuso|spray)\b/i,
      /\bcondimento\b/i,
    ],
    sizeRange: { min: 800, max: 1200 },
  },
  // Fresh tomatoes (pomodori). Italy ships these as named cultivars:
  // ciliegino (cherry), datterino (date), cuore di bue (oxheart),
  // pachino (Sicilian PDO), san marzano, costoluto. The picker
  // accepts any loose 1 kg variant; cheapest wins. Processed forms
  // (passata, pelati, polpa, conserva) excluded explicitly.
  tomatoes_1kg: {
    query: "pomodori",
    include: /\bpomodor/i,
    exclude: [
      /\b(passat|pelat|polpa|conserv|concentrat|salsa|sugo|ketchup|essicat|sundri|secchi|seccati|liofilizz|surgelat|congelat)\b/i,
      /\b(succo|bevanda|prosciutto|farciti|ripieni|condimento|aromatizzat)\b/i,
    ],
    sizeRange: { min: 800, max: 1200 },
  },
  // Potatoes (patate). Loose by kg in the produce aisle. Italian
  // varieties: novelle (new), pasta gialla (yellow flesh), pasta
  // bianca (white flesh), rosse (red skin), viola (purple). The
  // generic 1 kg bag wins, processed forms excluded.
  potatoes_1kg: {
    query: "patate",
    include: /\bpatat/i,
    exclude: [
      /\b(dolc|dolce|americana|batata|igname)\b/i,
      /\b(chips|crocchett|gnocchi|pure|fritt|surgelat|congelat|essicat|liofilizz|farina|fecola|amido)\b/i,
      /\b(condit|aromatizz|sale|paprika|aromi|spezie)\b/i,
    ],
    sizeRange: { min: 800, max: 1200 },
  },
  // Bananas (banane). Sold loose by kg or in 1 kg netted bags.
  // Conad ships own-brand + branded (Chiquita, Bonita). Excludes
  // dried / chips / chocolate-coated variants.
  bananas_1kg: {
    query: "banane",
    include: /\bbanan/i,
    exclude: [
      /\b(secch|essicat|liofilizz|chips|cioccolat|frullat|frull|gelato|surgelat|congelat|farina|polver|biscott|merend|baby|infant)\b/i,
      /\b(plantain|verde|piscar|rossa|baby banana)\b/i,
    ],
    sizeRange: { min: 800, max: 1200 },
  },
  // Apples (mele). Italian cultivars: Gala, Pink Lady, Granny Smith,
  // Fuji, Golden Delicious, Renetta, Stark. All accepted, cheapest
  // wins. Excludes processed and pineapple (ananas; doesn't share the
  // stem but kept consistent with other-country pickers as a guard).
  apples_1kg: {
    query: "mele",
    include: /\bmel(a|e)\b/i,
    exclude: [
      /\b(ananas|cotogn|cotognat)\b/i,
      /\b(succo|bevanda|aceto|sidro|liofilizz|essicat|chips|biscott|crostat|torta|crostina|crumble|strudel|composta|conserva|marmellata|gelatina|gelato|surgelat|congelat|farciti|ripieni)\b/i,
      /\b(cera|profumat|aromatizzat|gomma|caramelle)\b/i,
    ],
    sizeRange: { min: 800, max: 1200 },
  },
};

/**
 * Conad ships netQuantity in kg / L / pieces via netQuantityUm:
 *   KG -> grams (multiply by 1000)
 *   LT -> milliliters (multiply by 1000)
 *   PZ -> pieces (passes through)
 *
 * The catalog stores pack size in the same units, so for eggs (PZ)
 * a 6-pack returns 6, not 6000.
 */
function netQuantityToTargetUnit(
  netQuantity: number,
  netQuantityUm: string,
): number {
  const um = netQuantityUm.toUpperCase();
  if (um === "KG" || um === "LT") return netQuantity * 1000;
  return netQuantity;
}

export interface ConadProductRaw {
  /** Conad SKU (5-6 digit numeric string). */
  code: string;
  /** Display name with brand + size suffix. */
  nome: string;
  /** Net quantity in the unit below. */
  netQuantity: number;
  /** Unit: "KG", "LT", "PZ". */
  netQuantityUm: string;
  /** EUR price major units. 0.0 means "ask in store" / unpriced. */
  basePrice: number;
}

export interface ParsedProduct {
  code: string;
  title: string;
  priceMajor: number;
  packSize: number;
  sourceUrl: string;
}

/**
 * Parse the `data-product` JSON attribute from each rendered card.
 * Cards with basePrice === 0 are dropped (variable / ask-in-store).
 *
 * Exported so unit tests can feed in fixtures.
 */
export function parseProductsFromCards(
  cards: ConadProductRaw[],
  baseUrl = BASE,
): ParsedProduct[] {
  const out: ParsedProduct[] = [];
  for (const c of cards) {
    if (!c.code || !c.nome) continue;
    if (!Number.isFinite(c.basePrice) || c.basePrice <= 0) continue;
    if (!Number.isFinite(c.netQuantity) || c.netQuantity <= 0) continue;
    const size = netQuantityToTargetUnit(c.netQuantity, c.netQuantityUm);
    // Conad product detail URL pattern, mirrors `assets/products/...`
    // images: `/prodotto/<slug>--<code>`. Used as sourceUrl so the
    // submitter can link back from on-chain observations.
    const slugified = c.nome
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    out.push({
      code: c.code,
      title: c.nome,
      priceMajor: c.basePrice,
      packSize: size,
      sourceUrl: `${baseUrl}/prodotto/${slugified}--${c.code}`,
    });
  }
  return out;
}

function pickBestMatch(
  products: ParsedProduct[],
  picker: ConadPicker,
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
 * then extract product cards via DOM queries inside the page context.
 *
 * Each product card carries `<div ... data-product='{...}'>` with the
 * full SKU JSON. We page.evaluate() to parse all of them in one trip.
 */
async function scrapeOneSearch(
  browser: Browser,
  query: string,
): Promise<ParsedProduct[]> {
  const context =
    browser.contexts()[0] ?? (await browser.newContext({
      userAgent:
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
      locale: "it-IT",
    }));
  const page = context.pages()[0] ?? (await context.newPage());

  // Warm the session on the homepage so Conad's JS picks a default
  // store and the OCC API gets a valid storeId before our search.
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(3000);

  const url = `${BASE}/search?q=${encodeURIComponent(query)}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  // Conad lazy-renders the price after the SAP OCC fetch lands. Poll
  // for the first card with basePrice > 0 in its data-product JSON.
  await page
    .waitForFunction(
      () => {
        const els = document.querySelectorAll<HTMLElement>("[data-product]");
        for (const el of Array.from(els)) {
          try {
            const data = JSON.parse(el.getAttribute("data-product") ?? "");
            if (typeof data.basePrice === "number" && data.basePrice > 0) {
              return true;
            }
          } catch {
            // skip malformed JSON
          }
        }
        return false;
      },
      { timeout: 15000 },
    )
    .catch(() => {
      // If no priced card appears within 15 s, fall through to extract
      // whatever the DOM has. parseProductsFromCards drops basePrice=0
      // entries so the miss is reported cleanly.
    });

  const cards = (await page.evaluate(() => {
    const out: Array<Record<string, unknown>> = [];
    const els = document.querySelectorAll<HTMLElement>("[data-product]");
    for (const el of Array.from(els)) {
      const raw = el.getAttribute("data-product");
      if (!raw) continue;
      try {
        out.push(JSON.parse(raw));
      } catch {
        // skip malformed JSON
      }
    }
    return out;
  })) as unknown as ConadProductRaw[];

  return parseProductsFromCards(cards);
}

/**
 * Live scrape, exported entry point. Requires BROWSER_USE_API_KEY.
 */
export async function scrapeConadIt(): Promise<ScraperResult> {
  const targets = targetsForRetailer("conad-it");
  const scrapedAt = new Date().toISOString();
  const scraped: ScrapedProduct[] = [];
  const misses: ScraperResult["misses"] = [];

  await withSession("it", SESSION_TIMEOUT_MIN, async (session) => {
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
          retailerSku: match.code,
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

  return { retailer: "conad-it", scraped, misses };
}
