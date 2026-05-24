/**
 * Novus Ukraine scraper, zakaz.ua API.
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

const NOVUS_KYIV_STORE_ID = "482010105";
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

interface NovusPicker {
  /** zakaz.ua category id to fetch from. */
  categoryId: string;
  /** Title must match this pattern. */
  include: RegExp;
  /** Title MUST NOT match any of these (excludes processed variants). */
  exclude: readonly RegExp[];
  /** Pack size in grams or mL, parsed from title tail. */
  sizeRange: { min: number; max: number };
}

const PICKERS: Partial<Record<ProductTarget["slug"], NovusPicker>> = {
  bread_500g: {
    categoryId: "bakery",
    include: /\b(loaf|bread)\b/i,
    exclude: [
      /\b(toast|baguette|rye|dark|wholegrain|whole-grain|sourdough|pita|burger)\b/i,
    ],
    sizeRange: { min: 300, max: 700 },
  },
  milk_1l: {
    categoryId: "dairy-and-eggs",
    // Match "milk" but not "soft cheese", "sour cream", "almond milk", etc.
    include: /\bmilk\b/i,
    exclude: [
      /\b(cheese|yogurt|kefir|cream|condensed|powder|baby|infant|formula|biscuit|cake|filling|drink|chocolate|almond|coconut|oat|soy|lactose-free)\b/i,
    ],
    sizeRange: { min: 800, max: 1100 },
  },
  eggs_10pcs: {
    categoryId: "dairy-and-eggs",
    // "Chicken Eggs C0 10pcs", excludes quail / 15pcs / 20pcs via sizeRange.
    include: /\bchicken eggs\b/i,
    exclude: [/\bquail\b/i],
    sizeRange: { min: 9, max: 12 },
  },
  butter_200g: {
    categoryId: "dairy-and-eggs",
    // "Sweet Cream Butter 82% 200g", excludes spread/margarine/whey.
    include: /\bbutter\b/i,
    exclude: [
      /\b(spread|margarine|peanut|sunflower|whey|chocolate|cake|biscuit)\b/i,
    ],
    sizeRange: { min: 170, max: 250 },
  },
  sugar_1kg: {
    categoryId: "packets-cereals",
    // "White Crystalline Sugar 1kg", excludes vanilla/brown/icing variants.
    include: /\bsugar\b/i,
    exclude: [
      /\b(vanilla|brown|cane|coconut|icing|powdered|stevia|substitute)\b/i,
    ],
    sizeRange: { min: 800, max: 1200 },
  },
  rice_1kg: {
    categoryId: "packets-cereals",
    // "Long Grain Rice 1kg" / "Basmati Rice 1kg" / "Round Rice 1kg".
    include: /\brice\b/i,
    exclude: [
      /\b(noodle|paper|wafer|cake|cracker|porridge|flour|milk|drink|wine|vinegar)\b/i,
    ],
    sizeRange: { min: 800, max: 1200 },
  },
};

/**
 * Parse the size in g or mL from a title tail like "... 500g" or
 * "... 1.5 L". Returns null when no size is present.
 */
function parseSizeFromTitle(title: string): number | null {
  // Piece-counted goods first (eggs "10pcs"). Matches integer counts
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

function pickBestMatch(
  products: ZakazProduct[],
  picker: NovusPicker,
): { product: ZakazProduct; size: number } | null {
  const candidates: Array<{ product: ZakazProduct; size: number }> = [];
  for (const p of products) {
    if (!picker.include.test(p.title)) continue;
    if (picker.exclude.some((rx) => rx.test(p.title))) continue;
    const size = parseSizeFromTitle(p.title);
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
  const url = `${API_BASE}/stores/${NOVUS_KYIV_STORE_ID}/categories/${categoryId}/products/?page=1&per_page=100`;
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
  const targets = targetsForRetailer("novus-ua");
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
      sourceUrl: `${API_BASE}/stores/${NOVUS_KYIV_STORE_ID}/categories/${picker.categoryId}/products/?ean=${match.product.ean}`,
    });
  }

  return { retailer: "novus-ua", scraped, misses };
}

/**
 * Live scrape, fetches every category the targets need then delegates
 * to scrapeFromFixture.
 */
export async function scrapeNovusUa(
  fetchImpl: typeof fetch = fetch,
): Promise<ScraperResult> {
  const targets = targetsForRetailer("novus-ua");
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
