/**
 * REWE Germany scraper, via shop.rewe.de/api/products JSON endpoint.
 *
 * REWE's HTML routes sit behind Akamai Bot Manager (403 on every
 * /search, /produkte, /sitemap path), but the JSON product list at
 * `https://shop.rewe.de/api/products?search=<term>&serviceTypes=PICKUP`
 * is not gated. Plain `node:fetch` returns 200 OK with ~80kB JSON
 * carrying 40 products per page across ~90 pages for a common query.
 *
 * The catch: every product ships `_embedded.articles: []` (no prices)
 * until the request carries a valid `wwIdent` + `marketCode` pair
 * identifying a specific REWE delivery market. Without it the API
 * returns `type: SEARCH_RESULT` but the article entry stays empty.
 * Guessing market codes returns `type: NO_HIT`, count 0.
 *
 * Capture procedure (one-off, done outside this scraper):
 *
 *   1. Open shop.rewe.de in a Browser Use Cloud session with DE proxy
 *   2. Dismiss the Usercentrics consent overlay
 *   3. Open the "Standort wählen" modal, enter 10115 Berlin Mitte
 *   4. Wait for the city autocomplete, click the suggested market
 *   5. Toggle Lieferservice (delivery) mode
 *   6. Read the `wwIdent` cookie (or the network call that follows
 *      the market click)
 *   7. Hardcode the value as REWE_WW_IDENT + REWE_MARKET_CODE in .env
 *
 * After capture the daily cron runs pure HTTP, no Browser Use Cloud
 * session. The captured market code is stable for roughly six months
 * until REWE rotates internal market IDs.
 *
 * Until both env vars are set, the scraper emits clean misses for
 * every slug with reason `REWE market not configured`, matching the
 * existing pipeline convention for unprovisioned scrapers.
 */
import { env } from "../env.js";
import type { ProductTarget } from "../products.js";
import { targetsForRetailer } from "../products.js";
import type { ScrapedProduct, ScraperResult } from "../types.js";

const BASE = "https://shop.rewe.de";

// Plain desktop Chrome UA + de-DE Accept-Language. REWE's product API
// does not bot-check the JSON endpoint but tightens response shape if
// the UA hints at a script.
const REQUEST_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Accept-Language": "de-DE,de;q=0.9,en;q=0.8",
  Accept: "application/json, text/plain, */*",
};

// One JSON response is ~80kB and downloads in well under a second
// from anywhere; 20s is a safety margin for slow proxies.
const FETCH_TIMEOUT_MS = 20_000;

interface DePicker {
  /** German search keyword. */
  query: string;
  /** Product title must match. */
  include: RegExp;
  /** Product title MUST NOT match. */
  exclude: readonly RegExp[];
  /** Pack size in target.unit (g or mL or pcs). */
  sizeRange: { min: number; max: number };
}

const PICKERS: Partial<Record<ProductTarget["slug"], DePicker>> = {
  // Whole milk (Vollmilch). German UHT 1L cartons are the staple.
  milk_1l: {
    query: "vollmilch",
    include: /\bvollmilch\b/i,
    exclude: [
      /\b(fettarm|entrahmt|laktosefrei|haltbar|aroma|schokolade|kakao|kaffee|sahnig|kondens|pulver|baby|hipp|kinder|säugling|wachstum|getränk|soja|reis|mandel|hafer|kokos|kefir|joghurt|sahne)\b/i,
    ],
    sizeRange: { min: 800, max: 1100 },
  },
  // Fresh eggs (Eier). DE packs ship 4 / 6 / 10 / 12; canonical 12.
  eggs_12: {
    query: "eier",
    include: /\b(eier|hühnerei)/i,
    exclude: [
      /\b(wachtel|enten|gänse|schokolade|oster|paste|pudding|öl|tortelloni|ravioli|nudel|mayonnaise|flüssig|eiweiß|eigelb)\b/i,
    ],
    sizeRange: { min: 6, max: 12 },
  },
  // Butter (Butter). DE 250g standard; canonical slug is 200g, sizeRange
  // widened to catch 200-250g packs.
  butter_200g: {
    query: "butter",
    include: /\bbutter\b/i,
    exclude: [
      /\b(margarine|streichfett|aufstrich|geklärt|ghee|kakao|schokolade|nüss|nuss|erdnuss|mandel|sesam|spread|kekse|brioche|creme|sahnig|gesalzen|aromatisier)\b/i,
    ],
    sizeRange: { min: 180, max: 300 },
  },
  // Hard cheese (Käse). DE common: Gouda, Emmentaler, Edamer in 200-500g
  // wedges. Canonical 500g, normalize.ts rescales.
  cheese_local_500g: {
    query: "gouda",
    include: /\b(gouda|emmental|edamer|bergkäse|tilsiter|appenzeller|leerdammer)/i,
    exclude: [
      /\b(scheibe|geriebe|streukäse|reibe|aufstrich|frisch|sahnig|stick|snack|mini|baby|portion|würfel|sticks|krümel|happen)/i,
      /\b(vegan|pflanz|laktosefrei|milchfrei|frei von)/i,
      /\b(philadelphia|brie|camembert|feta|halloumi|cheddar|mozzarell|ricotta|mascarpone|hüttenkäse|harzer|limburger|raclette|fondue|gorgonzola|stilton)/i,
      /\b(rauch|paprika|kümmel|kräuter|knoblauch|trüffel|chili)/i,
    ],
    sizeRange: { min: 100, max: 600 },
  },
  // White sliced bread (Toastbrot). 500g loaves are standard.
  bread_500g: {
    query: "toastbrot",
    include: /\b(toastbrot|weißbrot|sandwichbrot|kastenbrot)/i,
    exclude: [
      /\b(vollkorn|mehrkorn|saaten|kürbis|nuss|leinsamen|sonnenblume|hafer|dinkel|roggen|sauerteig|glutenfrei|laktosefrei|baguette|ciabatta)/i,
    ],
    sizeRange: { min: 300, max: 700 },
  },
  // White sugar (Zucker). 1kg DE staple.
  sugar_1kg: {
    query: "zucker",
    include: /\bzucker\b/i,
    exclude: [
      /\b(braun|roh|kandis|puderzucker|vanille|stevia|süßstoff|fruchtzucker|maltitol|saccharin|eritritol|aspartam|kokos|honig)\b/i,
    ],
    sizeRange: { min: 800, max: 1200 },
  },
  // Rice (Reis). 1kg standard.
  rice_1kg: {
    query: "reis",
    include: /\breis\b/i,
    exclude: [
      /\b(milch|getränk|nudel|mehl|essig|cracker|kekse|tortin|riegel|salat|schwarz|naturreis|integral)\b/i,
      /\b(vorgekocht|mikrowelle|fertig|gefroren|tiefkühl|kochbeutel)\b/i,
    ],
    sizeRange: { min: 800, max: 1200 },
  },
  // Olive oil (Olivenöl). 1L standard.
  olive_oil_1l: {
    query: "olivenöl",
    include: /\boliven[öo]l\b/i,
    exclude: [
      /\b(sonnenblumen|raps|mais|sesam|palm|kokos|erdnuss|sojabohnen|distel|kürbiskern)/i,
      /\b(aromatisier|kräuter|knoblauch|chili|trüffel|zitrone|basilikum|rosmarin|gewürzt|infundiert|spray)/i,
      /\bdressing\b|\bgewürzöl\b/i,
    ],
    sizeRange: { min: 800, max: 1200 },
  },
  // Chicken breast (Hähnchenbrust). DE supermarkets ship 300-1200g.
  chicken_breast_1kg: {
    query: "hähnchenbrust",
    include: /\bhähnchen\b.*\b(brust|filet)|brust|filet.*\bhähnchen\b/i,
    exclude: [
      /\b(schenkel|keule|flügel|leber|herzen|nuggets|panier|paniert|kebab|burger|spieß|gefüllt|wrap|tikka|tandoori|bbq|teriyaki|grilliert|gebraten|gekocht|geräuchert)/i,
      /\b(tiefkühl|gefroren|haltbar|fertig|aufgewärmt)/i,
      /\b(pute|truthahn|ente|gans|rind|kalb|schwein|lamm)\b/i,
    ],
    sizeRange: { min: 300, max: 1200 },
  },
  // Ground beef (Hackfleisch). DE staple, 400-1000g.
  beef_ground_1kg: {
    query: "rinderhackfleisch",
    include: /\b(rinderhack|rind.*hackfleisch|hackfleisch.*rind)/i,
    exclude: [
      /\b(schwein|pute|huhn|hähnchen|lamm|kalb|gemischt|hähnchenhack|gehacktes)/i,
      /\b(burger|frikadelle|köfte|krokett|wurst|kebab|spieß|tikka|tandoori|bbq|geräuchert|gewürzt|aromatisier|fertig)/i,
      /\b(tiefkühl|gefroren|ragu|sauce|bolognese|lasagne|chili)/i,
    ],
    sizeRange: { min: 300, max: 1200 },
  },
  // Tomatoes (Tomaten). Fresh 1kg.
  tomatoes_1kg: {
    query: "tomaten",
    include: /\btomate/i,
    exclude: [
      /\b(passiert|mark|ketchup|sauce|sosse|getrocknet|sundried|dose|konserv|passata|saft|samen)/i,
    ],
    sizeRange: { min: 800, max: 1200 },
  },
  // Potatoes (Kartoffeln). 1kg loose / bagged.
  potatoes_1kg: {
    query: "kartoffeln",
    include: /\bkartoffel/i,
    exclude: [
      /\b(süßkartoff|chips|pommes|frites|wedge|püree|stampf|getrocknet|flocken|geschnitten|gebacken|gewürzt|gewaschen|sausage|kuchen|waffel|tiefkühl|gefroren|fertig)/i,
    ],
    sizeRange: { min: 800, max: 1200 },
  },
  // Bananas (Bananen). 1kg.
  bananas_1kg: {
    query: "bananen",
    include: /\bbanane/i,
    exclude: [
      /\b(getrocknet|chips|baby|rot|schokolade|gefroren|kuchen|muffin|kekse|sahne|smoothie|laib|brot|pulver|aromatisier)/i,
    ],
    sizeRange: { min: 800, max: 1200 },
  },
  // Apples (Äpfel). 1kg.
  apples_1kg: {
    query: "äpfel",
    include: /\bapfel|äpfel/i,
    exclude: [
      /\b(ananas|getrocknet|geschnitten|gefroren|chips|kuchen|kekse|sahne|saft|sauce|cider|essig|wein|krümel|strudel|toffee|karamell|aromatisier|süß)/i,
      /\b(schorle|nektar|getränk|konzentrat|sparkling|sprudel|beverage|wasser|limo|kombucha|smoothie|tee)/i,
    ],
    sizeRange: { min: 800, max: 1200 },
  },
  // Still bottled water (stilles Wasser). 1.5L PET.
  water_bottled_1500ml: {
    query: "wasser still",
    include: /\bwasser\b/i,
    exclude: [
      /\b(sprudel|kohlensäure|medium|spritzig|sparkling)/i,
      /\baromatisier|aromatic|sabor|geschmack|kohlen|cocktail|tonic|fragol|minze|tee|tea/i,
      /\bkölnisch|parfum|cosmetic|micellar|bad|dusche|shampoo|reiniger/i,
      /\bkochwasser|destillier|deioni|demineralisier/i,
      /\bbaby|säugling|infant|formula|entwöhnung/i,
    ],
    sizeRange: { min: 1400, max: 1600 },
  },
  // Imported beer single (Heineken, Carlsberg, etc.). 330-500ml.
  beer_imported_500ml: {
    query: "heineken",
    include:
      /\b(heineken|carlsberg|tuborg|stella artois|becks|budweiser|corona extra|leffe|hoegaarden|krombacher|paulaner|warsteiner|asahi|peroni|kronenbourg|guinness|grolsch|amstel|miller|estrella damm|san miguel|moretti|tyskie|zywiec|lech)/i,
    exclude: [
      /\b(alkoholfrei|alcohol-free|0\.0%|0%|alc-free)/i,
      /\b(radler|shandy)/i,
      /\b(light|leicht|low-alc)/i,
    ],
    sizeRange: { min: 250, max: 550 },
  },
};

interface ReweArticle {
  pricing?: {
    currentRetailPrice?: number;
    /** Price in cents (some Rewe articles use this shape). */
    price?: number;
  };
  grammage?: string;
  articleName?: string;
}

interface ReweProduct {
  id: string;
  productName?: string;
  _embedded?: {
    articles?: ReweArticle[];
  };
  _links?: {
    detail?: { href?: string };
  };
}

export interface ParsedProduct {
  title: string;
  priceMajor: number;
  packSize: number;
  sourceUrl: string;
}

/**
 * Parse a `productName` like "Hemme Milch Frische Vollmilch 3,7% 1l"
 * into a packSize value in the target unit (g or mL or pcs).
 *
 * Extracted heuristics:
 *   - " 1l" / " 1L" / " 1 l" -> 1000 mL
 *   - " 500g" / " 500 g" -> 500 g
 *   - " 1,5l" / " 1.5l" -> 1500 mL
 *   - " 12er" / " 12 Stück" -> 12 pcs
 *
 * Exported for unit tests.
 */
export function parseSizeFromName(name: string): number | null {
  // Litre forms first so "1l" doesn't get caught by the gram pattern.
  const litres = name.match(/(\d+(?:[.,]\d+)?)\s*(?:l|L|liter|litre)\b/);
  if (litres) {
    const v = parseFloat(litres[1]!.replace(",", "."));
    if (Number.isFinite(v)) return Math.round(v * 1000);
  }
  const ml = name.match(/(\d+(?:[.,]\d+)?)\s*ml\b/i);
  if (ml) {
    const v = parseFloat(ml[1]!.replace(",", "."));
    if (Number.isFinite(v)) return Math.round(v);
  }
  const kg = name.match(/(\d+(?:[.,]\d+)?)\s*kg\b/i);
  if (kg) {
    const v = parseFloat(kg[1]!.replace(",", "."));
    if (Number.isFinite(v)) return Math.round(v * 1000);
  }
  const g = name.match(/(\d+(?:[.,]\d+)?)\s*g\b/i);
  if (g) {
    const v = parseFloat(g[1]!.replace(",", "."));
    if (Number.isFinite(v)) return Math.round(v);
  }
  const pcs = name.match(/(\d+)\s*(?:er|st\.|stück|stk\.?)\b/i);
  if (pcs) {
    const v = parseInt(pcs[1]!, 10);
    if (Number.isFinite(v)) return v;
  }
  return null;
}

/**
 * Decode a single product entry into a normalized ParsedProduct.
 * Returns null when articles is empty (no market context) or pricing
 * is missing.
 *
 * Exported for unit tests.
 */
export function parseProduct(p: ReweProduct): ParsedProduct | null {
  const articles = p._embedded?.articles ?? [];
  if (articles.length === 0) return null;
  const a = articles[0]!;
  const priceMajor =
    a.pricing?.currentRetailPrice ??
    (typeof a.pricing?.price === "number" ? a.pricing.price / 100 : undefined);
  if (typeof priceMajor !== "number" || !Number.isFinite(priceMajor) || priceMajor <= 0) {
    return null;
  }
  const title = p.productName ?? a.articleName ?? "";
  if (!title) return null;
  const size = parseSizeFromName(title);
  if (size === null || size <= 0) return null;
  const detailHref = p._links?.detail?.href ?? `/p/${p.id}`;
  const sourceUrl = detailHref.startsWith("http") ? detailHref : `${BASE}${detailHref}`;
  return {
    title,
    priceMajor,
    packSize: size,
    sourceUrl,
  };
}

function pickBestMatch(
  products: ParsedProduct[],
  picker: DePicker,
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

async function fetchSearchProducts(
  query: string,
  wwIdent: string,
  marketCode: string,
): Promise<ParsedProduct[]> {
  const url =
    `${BASE}/api/products?` +
    new URLSearchParams({
      search: query,
      serviceTypes: "PICKUP",
      wwIdent,
      marketCode,
      objectsPerPage: "40",
      page: "1",
    }).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: REQUEST_HEADERS,
      redirect: "follow",
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const json = (await res.json()) as {
      type?: string;
      _embedded?: { products?: ReweProduct[] };
    };
    if (json.type !== "SEARCH_RESULT") return [];
    const products = json._embedded?.products ?? [];
    return products
      .map((p) => parseProduct(p))
      .filter((p): p is ParsedProduct => p !== null);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Live scrape, exported entry point. Pure HTTP, no Browser Use Cloud.
 */
export async function scrapeReweDe(): Promise<ScraperResult> {
  const targets = targetsForRetailer("rewe-de");
  const scrapedAt = new Date().toISOString();
  const scraped: ScrapedProduct[] = [];
  const misses: ScraperResult["misses"] = [];

  const wwIdent = env.REWE_WW_IDENT;
  const marketCode = env.REWE_MARKET_CODE;
  if (!wwIdent || !marketCode) {
    for (const target of targets) {
      misses.push({
        target,
        reason:
          "REWE market not configured · set REWE_WW_IDENT + REWE_MARKET_CODE in .env (see docs/deferred-retailers.md for capture procedure)",
      });
    }
    return { retailer: "rewe-de", scraped, misses };
  }

  for (const target of targets) {
    const picker = PICKERS[target.slug];
    if (!picker) {
      misses.push({ target, reason: "no picker configured for this slug" });
      continue;
    }
    const parsed = await fetchSearchProducts(picker.query, wwIdent, marketCode);
    const match = pickBestMatch(parsed, picker);
    if (!match) {
      misses.push({
        target,
        reason: `no match for "${picker.query}" (${parsed.length} priced candidates)`,
      });
      continue;
    }
    scraped.push({
      target,
      retailerSku: match.title.slice(0, 50),
      retailerTitle: match.title,
      priceMajor: match.priceMajor,
      packSize: match.packSize,
      scrapedAt,
      sourceUrl: match.sourceUrl,
    });
  }

  return { retailer: "rewe-de", scraped, misses };
}
// @scraper: rewe-de
// @rate-limit: respect retailer crawl policy
// @retry: exponential backoff on fetch failure
// @config: add feature flag toggle
// @a11y: check contrast ratio here
