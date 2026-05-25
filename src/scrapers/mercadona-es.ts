/**
 * Mercadona Spain scraper, tienda.mercadona.es API.
 *
 * Public, unauthenticated JSON API. Each top-level category (e.g.
 * id=60 "Pan de molde y otras especialidades", id=72 "Leche y bebidas
 * vegetales") returns its subcategories inline with products. Prices
 * are in EUR major units already, sizes come in kg or L which the
 * scraper converts to g / mL to match ProductTarget.unit.
 *
 * The scraper:
 *   1. Fetches one parent category per slug
 *   2. Walks subcategories that match the picker's predicate
 *   3. Filters products with picker (pattern + size band, single-unit)
 *   4. Picks the cheapest match (mass-market staple proxy)
 *
 * Targets the Madrid warehouse (wh=mad1) because that's the
 * stand-in for "Spain reference price" in the Mercato basket.
 */
import { z } from "zod";

import type { ProductTarget } from "../products.js";
import { targetsForRetailer } from "../products.js";
import type { ScrapedProduct, ScraperResult } from "../types.js";

const API_BASE = "https://tienda.mercadona.es/api/v1_1";
const WAREHOUSE = "mad1";

const MercadonaPriceSchema = z.object({
  unit_size: z.number().positive(),
  size_format: z.enum(["kg", "l", "ud"]),
  total_units: z.number().int().nullable(),
  unit_price: z.string(), // "0.96"
  bulk_price: z.string(), // "0.96" — per kg/L
  is_pack: z.boolean(),
});

const MercadonaProductSchema = z.object({
  id: z.string(),
  display_name: z.string(),
  packaging: z.string().nullable(),
  price_instructions: MercadonaPriceSchema,
});
type MercadonaProduct = z.infer<typeof MercadonaProductSchema>;

const MercadonaSubcategorySchema = z.object({
  id: z.number().int(),
  name: z.string(),
  products: z.array(MercadonaProductSchema),
});

const MercadonaCategorySchema = z.object({
  id: z.number().int(),
  name: z.string(),
  categories: z.array(MercadonaSubcategorySchema),
});

interface MercadonaPicker {
  /** Top-level parent category id (e.g. 60 for sliced bread). */
  parentCategoryId: number;
  /** Subcategory name predicate (e.g. /pan de molde/i). */
  subcategoryMatch: RegExp;
  /** Product display_name must match. */
  include: RegExp;
  /** Product display_name MUST NOT match. */
  exclude: readonly RegExp[];
  /** Pack size in target.unit (g or mL). */
  sizeRange: { min: number; max: number };
}

const PICKERS: Partial<Record<ProductTarget["slug"], MercadonaPicker>> = {
  bread_500g: {
    parentCategoryId: 60,
    subcategoryMatch: /pan de molde/i,
    include: /pan de molde blanco/i,
    exclude: [/sin corteza/i, /integral/i, /familiar/i, /avena/i, /semillas/i],
    sizeRange: { min: 300, max: 700 },
  },
  milk_1l: {
    parentCategoryId: 72,
    subcategoryMatch: /leche entera/i,
    include: /leche entera/i,
    exclude: [/sin lactosa/i, /infantil/i, /condensada/i, /chocolate/i],
    sizeRange: { min: 800, max: 1100 },
  },
  // Eggs ship in Spain as 12-packs (the standard "Huevos grandes L" /
  // "Huevos super grandes XL"). Catalog canonical matches at 12, so
  // normalize.ts treats the price as-is on the common case and rescales
  // any odd 10-pack to per-12.
  eggs_12: {
    parentCategoryId: 77,
    subcategoryMatch: /^huevos$/i,
    include: /huevos/i,
    exclude: [/codorniz/i, /infantil/i],
    sizeRange: { min: 10, max: 12 },
  },
  butter_200g: {
    parentCategoryId: 75,
    subcategoryMatch: /^mantequilla$/i,
    include: /mantequilla/i,
    exclude: [/margarina/i, /untable/i, /spread/i, /vegetal/i],
    sizeRange: { min: 180, max: 300 },
  },
  sugar_1kg: {
    parentCategoryId: 89,
    subcategoryMatch: /^az[uú]car$/i,
    include: /az[uú]car blanco/i,
    exclude: [/moreno/i, /panela/i, /glas|glas[eé]/i, /ca[nñ]a/i, /edulcorante/i],
    sizeRange: { min: 800, max: 1200 },
  },
  rice_1kg: {
    parentCategoryId: 118,
    subcategoryMatch: /^arroz$/i,
    include: /arroz/i,
    exclude: [/leche/i, /bebida/i, /vinagre/i, /tortita/i, /harina/i],
    sizeRange: { min: 800, max: 1200 },
  },
};

/**
 * Mercadona returns unit_size in kg / L / ud. Convert kg+L to g / mL
 * (matches ProductTarget.unit "g" or "ml"). For "ud" (unidades / pieces,
 * used by eggs etc.) return the count as-is, the catalog stores the
 * piece-counted unit ("pcs") so no conversion is needed.
 */
function sizeToTargetUnit(p: MercadonaProduct): number {
  const { unit_size, size_format } = p.price_instructions;
  if (size_format === "kg" || size_format === "l") {
    return unit_size * 1000;
  }
  // "ud" passes through unchanged.
  return unit_size;
}

function pickBestMatch(
  category: z.infer<typeof MercadonaCategorySchema>,
  picker: MercadonaPicker,
): { product: MercadonaProduct; size: number } | null {
  const candidates: Array<{ product: MercadonaProduct; size: number }> = [];
  for (const sc of category.categories) {
    if (!picker.subcategoryMatch.test(sc.name)) continue;
    for (const p of sc.products) {
      if (p.price_instructions.is_pack) continue; // skip 6-bottle multipacks
      if (!picker.include.test(p.display_name)) continue;
      if (picker.exclude.some((rx) => rx.test(p.display_name))) continue;
      const size = sizeToTargetUnit(p);
      if (size < picker.sizeRange.min || size > picker.sizeRange.max) continue;
      candidates.push({ product: p, size });
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort(
    (a, b) =>
      Number.parseFloat(a.product.price_instructions.unit_price) -
      Number.parseFloat(b.product.price_instructions.unit_price),
  );
  return candidates[0]!;
}

async function fetchCategory(
  categoryId: number,
  fetchImpl: typeof fetch = fetch,
): Promise<z.infer<typeof MercadonaCategorySchema>> {
  const url = `${API_BASE}/categories/${categoryId}/?lang=es&wh=${WAREHOUSE}`;
  const res = await fetchImpl(url, {
    headers: { "User-Agent": "meRacle/0.1 (+https://github.com/BRN-SLP/meracle)" },
  });
  if (!res.ok) {
    throw new Error(`mercadona ${categoryId}: HTTP ${res.status}`);
  }
  const raw: unknown = await res.json();
  return MercadonaCategorySchema.parse(raw);
}

/**
 * Pure-function scraper, takes pre-loaded category JSONs. Used by
 * tests and by the live scrape, which fetches first then delegates.
 */
export function scrapeFromFixture(
  categoryById: Record<number, z.infer<typeof MercadonaCategorySchema>>,
  scrapedAt: string,
): ScraperResult {
  const targets = targetsForRetailer("mercadona-es");
  const scraped: ScrapedProduct[] = [];
  const misses: ScraperResult["misses"] = [];

  for (const target of targets) {
    const picker = PICKERS[target.slug];
    if (!picker) {
      misses.push({ target, reason: "no picker configured for this slug" });
      continue;
    }
    const category = categoryById[picker.parentCategoryId];
    if (!category) {
      misses.push({
        target,
        reason: `category ${picker.parentCategoryId} not loaded`,
      });
      continue;
    }
    const match = pickBestMatch(category, picker);
    if (!match) {
      misses.push({
        target,
        reason: `no match in category ${picker.parentCategoryId}`,
      });
      continue;
    }
    scraped.push({
      target,
      retailerSku: match.product.id,
      retailerTitle: match.product.display_name,
      priceMajor: Number.parseFloat(match.product.price_instructions.unit_price),
      packSize: match.size,
      scrapedAt,
      sourceUrl: `https://tienda.mercadona.es/product/${match.product.id}`,
    });
  }

  return { retailer: "mercadona-es", scraped, misses };
}

export async function scrapeMercadonaEs(
  fetchImpl: typeof fetch = fetch,
): Promise<ScraperResult> {
  const targets = targetsForRetailer("mercadona-es");
  const categoryIds = Array.from(
    new Set(
      targets
        .map((t) => PICKERS[t.slug]?.parentCategoryId)
        .filter((cid): cid is number => cid !== undefined),
    ),
  );
  const categoryById: Record<number, z.infer<typeof MercadonaCategorySchema>> =
    {};
  for (const cid of categoryIds) {
    categoryById[cid] = await fetchCategory(cid, fetchImpl);
  }
  return scrapeFromFixture(categoryById, new Date().toISOString());
}
