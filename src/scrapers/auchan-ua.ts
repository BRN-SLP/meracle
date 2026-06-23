/**
 * Auchan Ukraine scraper, zakaz.ua API.
 *
 * Public, unauthenticated JSON API. Each store has its own
 * `/stores/{storeId}/categories/{categoryId}/products/` endpoint
 * returning paginated product listings. Prices are in UAH kopecks
 * (Hryvnia minor units * 100), titles include the pack size in the
 * tail ("... 500g"), so the scraper:
 *
 *   1. Fetches one category page per target slug
 *   2. Filters with a per-slug picker (pattern + exclude + sizeRange)
 *   3. Picks the cheapest match (mass-market staple proxy)
 *   4. Parses the pack size from the title tail
 *   5. Hands the row to src/normalize.ts which applies sanity bands
 *
 * Picker config lives next to the scraper, NOT in ProductTarget, so
 * ProductTarget stays retailer-agnostic.
 */
import { z } from "zod";

import type { ProductTarget } from "../products.js";
import { targetsForRetailer } from "../products.js";
import type { ScrapedProduct, ScraperResult } from "../types.js";

const AUCHAN_KYIV_STORE_ID = "48246401";
const API_BASE = "https://stores-api.zakaz.ua";

const ZakazProductSchema = z.object({
  ean: z.string(),
  sku: z.string(),
  title: z.string(),
  /** Price in minor units (kopecks). 3479 = 34.79 UAH. */
  price: z.number().int().positive(),
  currency: z.literal("uah"),
  unit: z.string(), // "pcs", "kg", "l"
  volume: z.number().nullable(),
});
type ZakazProduct = z.infer<typeof ZakazProductSchema>;

const ZakazPageSchema = z.object({
  count: z.number().int().nonnegative(),
  results: z.array(ZakazProductSchema),
});

interface AuchanPicker {
  /** zakaz.ua category id to fetch from. */
  categoryId: string;
  /** Title must match this pattern. */
  include: RegExp;
  /** Title MUST NOT match any of these (excludes processed variants). */
  exclude: readonly RegExp[];
  /** Pack size in grams or mL, parsed from title tail. */
  sizeRange: { min: number; max: number };
}

const PICKERS: Partial<Record<ProductTarget["slug"], AuchanPicker>> = {
  bread_500g: {
    categoryId: "bakery-auchan",
    include: /\b(loaf|bread)\b/i,
    exclude: [
      /\b(toast|baguette|rye|dark|wholegrain|whole-grain|sourdough|pita|burger)\b/i,
    ],
    sizeRange: { min: 300, max: 700 },
  },
  milk_1l: {
    categoryId: "dairy-and-eggs-auchan",
    // Match "milk" but not "soft cheese", "sour cream", "almond milk", etc.
    include: /\bmilk\b/i,
    exclude: [
      /\b(cheese|yogurt|kefir|cream|condensed|powder|baby|infant|formula|biscuit|cake|filling|drink|chocolate|almond|coconut|oat|soy|lactose-free)\b/i,
    ],
    sizeRange: { min: 800, max: 1100 },
  },
  eggs_12: {
    categoryId: "dairy-and-eggs-auchan",
    // "Chicken Eggs C0 12pcs", excludes quail / 15pcs / 20pcs via sizeRange.
    // sizeRange widened to 10..12 so a 10-pack still passes the gate and
    // normalize.ts rescales to the canonical 12-pack price.
    include: /\bchicken eggs\b/i,
    exclude: [/\bquail\b/i],
    sizeRange: { min: 10, max: 12 },
  },
  butter_200g: {
    categoryId: "dairy-and-eggs-auchan",
    // "Sweet Cream Butter 82% 200g", excludes spread/margarine/whey.
    include: /\bbutter\b/i,
    exclude: [
      /\b(spread|margarine|peanut|sunflower|whey|chocolate|cake|biscuit)\b/i,
    ],
    sizeRange: { min: 170, max: 250 },
  },
  sugar_1kg: {
    categoryId: "grocery-and-sweets-auchan",
    // "White Crystalline Sugar 1kg", excludes vanilla/brown/icing variants.
    include: /\bsugar\b/i,
    exclude: [
      /\b(vanilla|brown|cane|coconut|icing|powdered|stevia|substitute)\b/i,
    ],
    sizeRange: { min: 800, max: 1200 },
  },
  rice_1kg: {
    categoryId: "grocery-and-sweets-auchan",
    // "Long Grain Rice 1kg" / "Basmati Rice 1kg" / "Round Rice 1kg".
    include: /\brice\b/i,
    exclude: [
      /\b(noodle|paper|wafer|cake|cracker|porridge|flour|milk|drink|wine|vinegar)\b/i,
    ],
    sizeRange: { min: 800, max: 1200 },
  },
  tomatoes_1kg: {
    categoryId: "fruits-and-vegetables-auchan",
    // zakaz.ua titles a loose tomato as bare "Tomato" with unit="kg",
    // which parseSizeFromProduct resolves to 1000 g. Cherry / branch
    // variants come as "Cherry Tomatoes 250g" with unit="pcs", so the
    // sizeRange filter keeps only the 1-kg loose entries.
    include: /\btomato/i,
    exclude: [/\b(paste|sauce|ketchup|juice|sundried|dried)\b/i],
    sizeRange: { min: 800, max: 1200 },
  },
  potatoes_1kg: {
    categoryId: "fruits-and-vegetables-auchan",
    // Quirk: zakaz.ua titles loose potatoes as "White Рotatoes" using
    // a Cyrillic Р instead of a Latin P (data-entry inconsistency on
    // the retailer side). The character class [pр] handles both.
    // Excludes sweet potato (botanically different) and processed
    // variants (chips, crisps, mashed, dried).
    include: /\b[pр]otato/i,
    exclude: [/\b(sweet|chip|crisp|fries|mashed|dried|flake|starch|seed)\b/i],
    sizeRange: { min: 800, max: 1200 },
  },
  olive_oil_1l: {
    // Olive oil sits in Auchan "Grocery" alongside flour, pasta and
    // dry goods. The dedicated `sauces-and-spices-auchan` category
    // only carries flavoured sauces, no bottled oils.
    categoryId: "grocery-and-sweets-auchan",
    // Match both Latin "Olive Oil" and "Olive olive oil" variants.
    // Excludes:
    //   `sunflower`            blended sunflower + olive bottles
    //   `with`                 "Olive Oil with Lemon" style infusions
    //   `spray|infused|flavor` flavoured / spray variants
    //   `truffle|garlic|herb|lemon|chili|basil|rosemary`  flavoured
    include: /\bolive oil\b/i,
    exclude: [
      /\b(sunflower|spray|infused|flavoured|flavored|truffle|garlic|herb|lemon|chili|chilli|basil|rosemary|pesto)\b/i,
      /\bwith\b/i,
    ],
    sizeRange: { min: 800, max: 1200 },
  },
  // Still mineral water in 1.5 L bottles. Lives in the `drinks`
  // category alongside sodas, juices and sparkling water. Excludes
  // carbonated / sparkling variants explicitly so the basket
  // measures the cheap-staple slot, not a premium SKU.
  water_bottled_1500ml: {
    categoryId: "drinks-auchan",
    include: /\bwater\b/i,
    exclude: [
      /\b(sparkling|(?<!non[- ])carbonated|gas|tonic|soda|coca|fanta|sprite|cola|juice|extract|scented|cleansing|perfumed|infused|flavou?red|aroma|aromat|citrus|cherry|lemon|orange|raspberry|strawberry|kola|root|salt|sauce|cooking|distilled|baby|infant|formula|kettle|filter|cleaner)\b/i,
    ],
    sizeRange: { min: 1400, max: 1600 },
  },
  // Loose bananas, sold by the kilo. zakaz.ua titles them as bare
  // "Banana" with unit="kg" + volume=null, which parseSizeFromProduct
  // resolves to 1000 g. Specialty variants (Baby Banana, Red Banana,
  // Bananas Chips) and processed forms (Dried, Sublimated) are
  // excluded explicitly so the basket measures the mass-market loose
  // banana, not a premium SKU.
  bananas_1kg: {
    categoryId: "fruits-and-vegetables-auchan",
    include: /\bbanana/i,
    exclude: [
      /\b(dried|sublimated|chips|baby|red|pink|chocolate|frozen|cake|cookie|biscuit|cream)\b/i,
    ],
    sizeRange: { min: 800, max: 1200 },
  },
  // Loose apples, sold by the kilo. zakaz.ua surfaces named cultivars
  // ("Golden", "Fuji", "Jonagold", "Idared", "Granny Smith") as well
  // as a generic "Ukraine Apple 60-70" entry. All accepted, the
  // cheapest variety wins. Critically excludes "Pineapple" which
  // matches the bare "apple" stem, and processed forms.
  apples_1kg: {
    categoryId: "fruits-and-vegetables-auchan",
    include: /\bapple/i,
    exclude: [
      /\b(pine|dried|sublimated|sliced|frozen|chips|cake|cookie|biscuit|cream|juice|sauce|cider|vinegar|wine)\b/i,
    ],
    sizeRange: { min: 800, max: 1200 },
  },
  // Chicken breast meat sold loose by the kilo. zakaz.ua titles the
  // canonical mass-market entry as "Chilled Chicken Fillet" with
  // unit="kg" + volume=null, which parseSizeFromProduct resolves to
  // 1000 g. Other cuts (thigh, drumstick, wing, liver, etc.) and
  // processed forms (mince, sausages, ham, smoked, breaded) are
  // excluded so the picker measures the canonical staple cut.
  chicken_breast_1kg: {
    categoryId: "meat-fish-poultry-auchan",
    include: /\bchicken\b.*\b(breast|fillet)\b/i,
    exclude: [
      /\b(mince|minced|thigh|drumstick|wing|heart|liver|quarter|wiener|sausage|roll|ham|smoked|boiled|fried|marinated|baked|grill|burger|kebab|nuggets|breaded|empan|frozen|stuffed|salami)\b/i,
    ],
    sizeRange: { min: 800, max: 1200 },
  },
  // Pure beef ground (minced) meat, sold loose by the kilo. zakaz.ua
  // surfaces a small set of mince SKUs: a Pork+Beef blend ("Assorti"),
  // a pure beef "For Cutlets" loose pack, and packaged 450g blocks
  // (Skott Smeat). The picker keeps only pure beef, loose-kg pricing,
  // by including any title containing both "beef" and a mince stem
  // (mince/minced/ground) while excluding other proteins, packaged
  // forms and processed variants.
  beef_ground_1kg: {
    categoryId: "meat-fish-poultry-auchan",
    include: /\bbeef\b.*\b(mince|minced|ground)\b|\b(mince|minced|ground)\b.*\bbeef\b/i,
    exclude: [
      /\b(pork|chicken|turkey|lamb|veal|assorti|stuffed|sausage|burger|wiener|frozen|smoked|cooked|boiled|fried|marinated|baked|grill|kebab|nuggets|breaded|ham|salami|roll)\b/i,
    ],
    sizeRange: { min: 800, max: 1200 },
  },
  // Hard / semi-hard cheese, sold loose by the kilo at the deli
  // counter (unit="kg" + volume=null, parseSizeFromProduct resolves
  // to 1000 g). zakaz.ua surfaces dozens of Gouda / Maasdam / Edam /
  // Dutch / Cheddar variants plus local Ukrainian hard cheese brands
  // (Novgorod-Siverskyi, Pyryatyn, Komo). The canonical 500g slug
  // resolves via normalize.ts: the loose-kg price gets halved.
  //
  // Excludes soft / processed / spread / cottage cheeses, flavored
  // variants (truffle, pesto, garlic, herbs, chili, rose), and
  // grated / sliced packaging which doesn't represent the
  // mass-market staple wedge.
  cheese_local_500g: {
    categoryId: "dairy-and-eggs-auchan",
    include: /\bcheese\b/i,
    exclude: [
      /\b(cream|spread|cottage|melted|processed|sliced|grated|shredded|fresh|soft|brie|camembert|mozzarella|ricotta|parmesan|feta|mascarpone|philadelphia|smoked|baby|infant|formula|bryndza|adyghe|suluguni|fita|halloumi|paneer|blue|brunost)\b/i,
      /\b(truffle|pesto|garlic|herbs?|chili|chilli|caraway|rose|pepper|lavender|wild|fenugreek|nut|fruit|raisin)\b/i,
      /\b(product|substitute|imitation)\b/i,
    ],
    sizeRange: { min: 800, max: 1200 },
  },
  // Imported single-can beer, 500ml. zakaz.ua ships dozens of
  // international brands (Heineken, Carlsberg, Tuborg, Stella Artois,
  // Becks, Budweiser Budvar, Corona, Leffe, Hoegaarden, Krombacher,
  // Paulaner, Warsteiner, Asahi, Peroni, Kronenbourg, Guinness,
  // Estrella Damm) at 0.5 L individual cans / bottles. The include
  // regex whitelists these brands explicitly. Ukrainian domestic
  // brands (Obolon, Slavutych, Chernihivske, Lvivske, Rohan, PPB)
  // are filtered out via the same whitelist (they don't match).
  //
  // Excludes:
  // - Non-alcoholic / 0.0% / unfiltered variants
  // - Flavored / craft (radler, shandy, IPA, stout if specifically
  //   labeled - the whitelist already prevents most)
  // - Light/zero alcohol variants
  beer_imported_500ml: {
    categoryId: "eighteen-plus-auchan",
    include: /\b(heineken|carlsberg|tuborg|stella artois|becks|budweiser|corona extra|leffe|hoegaarden|krombacher|paulaner|warsteiner|asahi|peroni|kronenbourg|guinness|grolsch|estrella damm|miller)\b/i,
    exclude: [
      /\b(non-alcoholic|alcohol-free|0\.0%|0%|alc-free|alcohol free)\b/i,
      /\bsin alcohol\b/i,
      /\b(radler|shandy)\b/i,
    ],
    sizeRange: { min: 400, max: 550 },
  },
};

/**
 * Parse the size in g or mL from a title tail like "... 500g" or
 * "... 1.5 L". Returns null when no size is present.
 */
export function parseSizeFromTitle(title: string): number | null {
  // Piece-counted goods first (eggs "12pcs"). Matches integer counts
  // so the regex does not collide with the "g" / "ml" / "l" branches.
  const pcs = title.match(/(\d+)\s*pcs\b/i);
  if (pcs) {
    return Number.parseInt(pcs[1], 10);
  }
  // kilograms before grams (kg suffix is more specific).
  const kg = title.match(/(\d+(?:[.,]\d+)?)\s*kg\b/i);
  if (kg) {
    return Number.parseFloat(kg[1].replace(",", ".")) * 1000;
  }
  // Try grams / mL first (no conversion), then litres -> mL.
  const gm = title.match(/(\d+(?:[.,]\d+)?)\s*(g|ml)\b/i);
  if (gm) {
    return Number.parseFloat(gm[1].replace(",", "."));
  }
  const l = title.match(/(\d+(?:[.,]\d+)?)\s*l\b/i);
  if (l) {
    return Number.parseFloat(l[1].replace(",", ".")) * 1000;
  }
  return null;
}

/**
 * Resolve a product's canonical size, in grams or mL, from either
 * its title tail or its unit/volume fields. zakaz.ua titles like
 * "Tomato" omit the size when the product is sold loose by the
 * kilo, in which case `unit="kg"` and `volume=null` signals 1 kg
 * (1000 g) as the natural quoting basis. Same logic applies to
 * litre-priced products.
 */
function parseSizeFromProduct(p: ZakazProduct): number | null {
  const fromTitle = parseSizeFromTitle(p.title);
  if (fromTitle !== null) return fromTitle;

  // Loose-weight produce: unit="kg" with no explicit volume means
  // the displayed price is per 1 kg.
  if (p.unit === "kg") {
    const v = p.volume ?? 1;
    return v * 1000;
  }
  if (p.unit === "l") {
    const v = p.volume ?? 1;
    return v * 1000;
  }
  return null;
}

function pickBestMatch(
  products: ZakazProduct[],
  picker: AuchanPicker,
): { product: ZakazProduct; size: number } | null {
  const candidates: Array<{ product: ZakazProduct; size: number }> = [];
  for (const p of products) {
    if (!picker.include.test(p.title)) continue;
    if (picker.exclude.some((rx) => rx.test(p.title))) continue;
    const size = parseSizeFromProduct(p);
    if (size === null) continue;
    if (size < picker.sizeRange.min || size > picker.sizeRange.max) continue;
    candidates.push({ product: p, size });
  }
  if (candidates.length === 0) return null;
  // Cheapest = best proxy for mass-market staple.
  candidates.sort((a, b) => a.product.price - b.product.price);
  return candidates[0]!;
}

/**
 * Fetch one category page. Caller decides whether more pages are
 * needed, MVP only needs page 1 (the cheapest matching item is
 * usually surfaced near the top of category 1).
 */
async function fetchCategory(
  categoryId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ZakazProduct[]> {
  const url = `${API_BASE}/stores/${AUCHAN_KYIV_STORE_ID}/categories/${categoryId}/products/?page=1&per_page=100`;
  const res = await fetchImpl(url, {
    headers: { "User-Agent": "meRacle/0.1 (+https://github.com/BRN-SLP/meracle)" },
  });
  if (!res.ok) {
    throw new Error(`zakaz.ua ${categoryId}: HTTP ${res.status}`);
  }
  const raw: unknown = await res.json();
  return ZakazPageSchema.parse(raw).results;
}

/**
 * Run the picker over a pre-loaded category dataset. Exported so the
 * unit tests can feed in fixtures without hitting the network.
 */
export function scrapeFromFixture(
  pageByCategory: Record<string, ZakazProduct[]>,
  scrapedAt: string,
): ScraperResult {
  const targets = targetsForRetailer("auchan-ua");
  const scraped: ScrapedProduct[] = [];
  const misses: ScraperResult["misses"] = [];

  for (const target of targets) {
    const picker = PICKERS[target.slug];
    if (!picker) {
      misses.push({ target, reason: "no picker configured for this slug" });
      continue;
    }
    const products = pageByCategory[picker.categoryId] ?? [];
    const match = pickBestMatch(products, picker);
    if (!match) {
      misses.push({ target, reason: `no match in ${picker.categoryId}` });
      continue;
    }
    scraped.push({
      target,
      retailerSku: match.product.sku,
      retailerTitle: match.product.title,
      priceMajor: match.product.price / 100,
      packSize: match.size,
      scrapedAt,
      sourceUrl: `${API_BASE}/stores/${AUCHAN_KYIV_STORE_ID}/categories/${picker.categoryId}/products/?ean=${match.product.ean}`,
    });
  }

  return { retailer: "auchan-ua", scraped, misses };
}

/**
 * Live scrape, fetches every category the targets need then delegates
 * to scrapeFromFixture.
 */
export async function scrapeAuchanUa(
  fetchImpl: typeof fetch = fetch,
): Promise<ScraperResult> {
  const targets = targetsForRetailer("auchan-ua");
  const categoryIds = Array.from(
    new Set(
      targets
        .map((t) => PICKERS[t.slug]?.categoryId)
        .filter((cid): cid is string => cid !== undefined),
    ),
  );
  const pageByCategory: Record<string, ZakazProduct[]> = {};
  for (const cid of categoryIds) {
    pageByCategory[cid] = await fetchCategory(cid, fetchImpl);
  }
  return scrapeFromFixture(pageByCategory, new Date().toISOString());
}
// @scraper: auchan-ua
// @rate-limit: respect retailer crawl policy
// @retry: exponential backoff on fetch failure
// @config: read from next.config env section
// @cleanup: remove dead code in next pass
// @type: narrow from string to union
// @note: see RFC-42 for rationale
// @edge: zero-value special case
// @a11y: ensure keyboard navigation works
// @todo: profile under high load
// @i18n: extract pluralization logic
// @i18n: ensure this string is extracted
// @guard: validate before processing
// @i18n: use Intl for formatting
