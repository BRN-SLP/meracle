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
// 16 sequential PLP searches under one session. Homepage warm + 16
// navigations + lazy-load waits typically finishes in 4 to 5 min. The
// earlier 2-min cap killed the session mid-batch after roughly four
// slugs (production cron held on to 11 of 16 by accident; everything
// after `olive_oil_1l` reliably hit "browser has been closed"). 8 min
// matches the working Carrefour FR ceiling; Browser Use bills per
// actual second so the unused tail is free.
const SESSION_TIMEOUT_MIN = 8;

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
  // Sainsbury's lists potatoes by named variety ("Maris Piper", "King
  // Edward", "Charlotte") and as generic "white" or "salad" lines.
  // sizeRange 800-1200 keeps 1-kg bags and rejects baby potato punnets
  // (350g) and oversized 2.5kg bags.
  potatoes_1kg: {
    query: "potatoes 1kg",
    include: /\bpotato/i,
    exclude: [
      /\b(sweet|chip|crisp|wedge|fries|mashed|dried|flake|sliced|baked|salad-bag|sausage|cake|waffle|microwave|ready)\b/i,
    ],
    sizeRange: { min: 800, max: 1200 },
  },
  // Sainsbury's PLP search for "olive oil 1l". sizeRange 800-1200 ml
  // selects 1-litre bottles and rejects 500 ml / 750 ml premium SKUs.
  // Sunflower blends are the main confounder, blend-style mayos /
  // tapenades / pestos may also surface, all excluded explicitly.
  olive_oil_1l: {
    query: "olive oil 1l",
    include: /\bolive oil\b/i,
    exclude: [
      /\b(sunflower|spray|infused|flavoured|flavored|truffle|garlic|herb|lemon|chili|chilli|basil|rosemary|pesto|mayo|mayonnaise|tapenade)\b/i,
      /\bwith\b/i,
    ],
    sizeRange: { min: 800, max: 1200 },
  },
  // Sainsbury's PLP search for "still water 1.5l". sizeRange 1400-1600 ml
  // selects standard 1.5 L bottles. Sparkling / flavoured / tonic variants
  // are the main confounders, all rejected by the exclude list. Distilled,
  // baby, filter and cleaning waters are also rejected explicitly.
  water_bottled_1500ml: {
    query: "still water 1.5l",
    include: /\bwater\b/i,
    exclude: [
      /\b(sparkling|carbonated|tonic|soda|cordial|squash|juice|flavou?red|infused|aromat|distilled|baby|infant|formula|filter|kettle|cleaner|cleansing|micellar|rose|coconut|barley|tap)\b/i,
    ],
    sizeRange: { min: 1400, max: 1600 },
  },
  // Sainsbury's PLP search for "bananas 1kg". UK supermarkets sell
  // bananas mostly loose (sold by weight) plus a handful of organic /
  // baby / chocolate variants. sizeRange 800-1200 g keeps 1-kg packs
  // and loose bags. Dried / freeze-dried / cake / muffin variants
  // are excluded.
  bananas_1kg: {
    query: "bananas 1kg",
    include: /\bbanana/i,
    exclude: [
      /\b(dried|freeze-dried|chips|crisps|baby|red|chocolate|frozen|cake|muffin|cookie|biscuit|cream|smoothie|loaf|bread|powder|flavou?red)\b/i,
    ],
    sizeRange: { min: 800, max: 1200 },
  },
  // Sainsbury's PLP search for "apples 1kg". UK supermarkets surface
  // apples by named variety (Braeburn, Gala, Pink Lady, Bramley, etc.)
  // plus generic "by Sainsbury's" packs. Critically excludes pineapple,
  // which matches the bare apple stem, plus processed forms.
  //
  // The squash, cordial, drink, concentrate, blackcurrant exclude
  // band is a separate line because UK supermarkets shelve fruit-
  // flavoured beverages (canonical example: "Robinsons Apple &
  // Blackcurrant Squash 1L") on the `apples 1kg` PLP, and the 1 L
  // size happens to fall inside the 800 to 1200 sizeRange window.
  // That beverage line was the cheapest fixture in the prior live
  // cron run and won the cheapest-priced selection on apples_1kg.
  apples_1kg: {
    query: "apples 1kg",
    include: /\bapple/i,
    exclude: [
      /\b(pine|dried|freeze-dried|sliced|frozen|chips|crisps|cake|cookie|biscuit|cream|juice|sauce|cider|vinegar|wine|crumble|strudel|toffee|caramel|flavou?red|sweet)\b/i,
      /\b(squash|cordial|drink|concentrate|blackcurrant|sparkling|fizz|beverage|water|soda|kombucha|smoothie|tea)\b/i,
    ],
    sizeRange: { min: 800, max: 1200 },
  },
  // Sainsbury's PLP search for "chicken breast fillet 1kg". UK supermarkets
  // ship chicken breast as packs of fillets (300-650 g typically) with
  // occasional 1 kg "large pack" or "family pack" SKUs. sizeRange 800-1200
  // keeps the 1 kg packs and rejects portion-size ones. Marinated, breaded,
  // smoked, mini-fillets and ready-cook variants are rejected.
  chicken_breast_1kg: {
    query: "chicken breast fillet 1kg",
    include: /\bchicken\b.*\b(breast|breasts|fillet|fillets)\b/i,
    // Excludes match prefix stems (no trailing \b) so `nugget` blocks
    // both `Nugget` and `Nuggets`. The previous trailing word boundary
    // let "Sainsbury's Chicken Breast Nuggets 1kg" (processed) win the
    // cheapest-priced sort over fresh fillet packs.
    exclude: [
      /\b(thigh|drumstick|wing|leg|heart|liver|kiev|nugget|sausage|ham|smoked|breaded|crumb|marinad|frozen|mince|kebab|skewer|burger|stuffed|wrap|tikka|tandoori|bbq|jerk|teriyaki|peri-peri|coated|seasoned|cooked|ready|roast|goujon|popper|dipper|tender|popcorn)/i,
    ],
    sizeRange: { min: 800, max: 1200 },
  },
  // Sainsbury's PLP search for "beef mince 1kg". UK supermarkets ship
  // mince in 400-500 g standard packs, 750 g family packs, and
  // occasional 1 kg "value" / "large" packs. sizeRange 800-1200 keeps
  // the 1 kg packs and rejects portion-size ones. Fat percentages
  // (5% / 12% / 20%) are all accepted, cheapest wins. Mixed protein
  // (pork+beef "steak mince"), processed and ready-cooked variants
  // are excluded explicitly.
  beef_ground_1kg: {
    query: "beef mince 1kg",
    include: /\bbeef\b.*\b(mince|minced|ground)\b|\b(mince|minced|ground)\b.*\bbeef\b/i,
    exclude: [
      /\b(pork|chicken|turkey|lamb|veal|sausage|burger|meatball|kofta|frozen|smoked|cooked|marinad|kebab|skewer|stuffed|wrap|tikka|tandoori|bbq|peri-peri|seasoned|ready|spaghetti|bolognese|chilli|chili|lasagne|lasagna|cottage|shepherd|pie|wellington)\b/i,
    ],
    sizeRange: { min: 800, max: 1200 },
  },
  // Cheddar block, UK's mass-market hard cheese staple. Sainsbury's
  // ships own-brand cheddar in 400 g / 500 g / 750 g / 1 kg blocks
  // across mild, medium, mature, extra-mature strengths plus the
  // 'British' tier. The 500 g block is the standard SKU. sizeRange
  // 400-600 g catches the typical block; the cheapest mature wins.
  //
  // Excludes:
  // - Pre-sliced / grated / shredded variants (snack packaging)
  // - Flavored / smoked / herbed cheddars (truffle, jalapeño, etc.)
  // - 'Cheese spread' / 'cheese product' / processed
  // - Other cheese types (red leicester, wensleydale, etc.)
  // - Vegan / plant-based cheese substitutes
  cheese_local_500g: {
    query: "cheddar 500g",
    include: /\bcheddar\b/i,
    // Excludes match prefix stems so `slice` blocks both `Slice` and
    // `Sliced` / `Slices`. The previous trailing-\b form let processed-
    // cheese SKUs through and broke the cheese sanity range floor.
    exclude: [
      /\b(slice|grat|shred|spread|melt|process|stick|snack|nibble|cube|portion|mini|baby|bite|crumbl|dipper|stringer|dunker)/i,
      /\b(jalape|chilli|chili|smoked|herb|garlic|onion|pickle|chutney|cranberry|truffle|honey|whisky|wine|spicy|caramelis|ploughman)/i,
      /\b(vegan|plant-based|dairy-free|lactose-free|free from)/i,
      /\b(red leicester|wensleydale|stilton|cheshire|double gloucester|monterey|colby|gouda|edam|brie|camembert|mozzarell|feta|parmesan|halloumi|paneer)/i,
      /\b(product|substitute|imitation)/i,
    ],
    sizeRange: { min: 400, max: 600 },
  },
  // Imported single-can / single-bottle beer. Sainsbury's PLP search
  // 'Heineken' typically surfaces 440ml UK-pint cans (the standard
  // single SKU for imported lager in UK supermarkets) alongside
  // multi-packs (4x440 / 12x330 etc., rejected by sizeRange). The
  // whitelist below captures international brands sold at Sainsbury's
  // as singles; British brands (Foster's, Carling, Tetley's,
  // Boddington's, Theakston) are filtered out by virtue of not being
  // on the whitelist.
  //
  // sizeRange 250-550 ml catches:
  // - 440 ml UK-pint cans (Heineken, Stella, Carlsberg standard)
  // - 500 ml continental cans (Becks, Krombacher, Paulaner)
  // - 330 ml bottles (Corona, Peroni standard bottle)
  // - 275 / 284 ml premium bottles (Hoegaarden, Leffe, Guinness)
  //
  // Excludes non-alcoholic / 0.0% / radler / shandy.
  beer_imported_500ml: {
    query: "Heineken",
    include: /\b(heineken|carlsberg|tuborg|stella artois|becks|budweiser|corona extra|leffe|hoegaarden|krombacher|paulaner|warsteiner|asahi|peroni|kronenbourg|guinness|grolsch|amstel|miller|estrella damm|san miguel|moretti|tyskie|zywiec|lech)\b/i,
    exclude: [
      /\b(non-alcoholic|alcohol-free|0\.0%|0%|alc-free|alcohol free)\b/i,
      /\b(radler|shandy)\b/i,
      /\b(lite|light|low(-|\s)?alc)\b/i,
    ],
    sizeRange: { min: 250, max: 550 },
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
// @scraper: sainsburys-uk
// @rate-limit: respect retailer crawl policy
// @retry: exponential backoff on fetch failure
