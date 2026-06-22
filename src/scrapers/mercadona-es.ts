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
  /**
   * Whether `is_pack: true` items count as candidates. Off by default
   * so beverage/dairy slugs do not get a 6-bottle multipack price.
   * On for produce: Mercadona ships loose fruit / vegetables as
   * single-unit items (e.g. 0.2 kg apple at EUR 0.44) AND bagged
   * bulk packs (1.55 kg bag of apples at EUR 3.10). The bulk pack is
   * cheaper per kg and is the correct cheapest-staple match.
   */
  allowPacks?: boolean;
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
  // Mercadona's olive-oil subcategory ships only pure olive oil
  // variants (refinado / virgen / virgen extra Hacendado, plus a few
  // PDO specials). No blends to filter out at this level, sizeRange
  // 800-1200 ml automatically rejects 0.2 / 0.5 / 0.75 L premium SKUs
  // and 3 L / 5 L family bottles.
  olive_oil_1l: {
    parentCategoryId: 112,
    subcategoryMatch: /^aceite de oliva$/i,
    include: /aceite de oliva/i,
    exclude: [/girasol/i, /mezcla/i, /sabor/i, /ajo/i, /lim[oó]n/i, /hierbas/i],
    sizeRange: { min: 800, max: 1200 },
  },
  // Still water in 1.5 L bottles. Subcategory `Agua sin gas` (id 525)
  // under parent 156 (`Agua`) ships only flat water — sparkling lives
  // in subcategory 528 and "gaseosa" (carbonated drinking water) in
  // 529, both rejected by the subcategoryMatch predicate.
  water_bottled_1500ml: {
    parentCategoryId: 156,
    subcategoryMatch: /^agua sin gas$/i,
    include: /agua/i,
    exclude: [/con gas/i, /gaseosa/i, /sabor/i],
    sizeRange: { min: 1400, max: 1600 },
  },
  // Chicken breast meat (pechuga de pollo). Mercadona surfaces both
  // sliced fillets ("Filetes pechuga de pollo") and whole breasts
  // ("Pechugas enteras de pollo") under subcategory 281 "Pollo".
  // sizeRange 900-1200 g matches the 1.14 kg "familiar" pack and
  // rejects 0.5 / 0.6 kg portion packs. Marinated, breaded and
  // herb-flavoured variants are excluded explicitly.
  chicken_breast_1kg: {
    parentCategoryId: 38,
    subcategoryMatch: /^pollo$/i,
    include: /pechuga/i,
    exclude: [
      /marinad/i,
      /empan/i,
      /hierba/i,
      /tierno/i,
      /finas/i,
      /salsa/i,
      /asad|frit|cocid|crujient|nugget|hamburg|albondig|brocheta/i,
    ],
    sizeRange: { min: 900, max: 1200 },
  },
  // Pure beef ground meat (carne picada vacuno). Mercadona ships three
  // pure-beef SKUs in subcategory 783 "Picadas y otros" (under parent
  // 44 "Hamburguesas y picadas") at 0.4 / 0.5 / 1.0 kg pack sizes.
  // sizeRange 800-1200 g keeps only the 1 kg "preparado familiar"
  // pack at EUR 10.80/kg. Vacuno+cerdo blends, cerdo solo, pollo
  // picada, albóndigas (meatballs) and processed/cooked forms are
  // excluded explicitly.
  beef_ground_1kg: {
    parentCategoryId: 44,
    subcategoryMatch: /^picadas y otros$/i,
    include: /picada.*vacuno|vacuno.*picada/i,
    exclude: [
      /cerdo/i,
      /pollo/i,
      /pavo/i,
      /cordero/i,
      /albondig/i,
      /hamburg/i,
      /burger/i,
      /asad|frit|cocid|crujient|nugget|brocheta|empan/i,
    ],
    sizeRange: { min: 800, max: 1200 },
  },
  // Cured / semi-cured / young hard cheese wedges. Spain's mass-market
  // staple is the 'Queso curado mezcla Hacendado' (cow+sheep+goat
  // blend) wedge at ~0.41 kg, but the cheapest pure variant per kg is
  // 'Queso tierno gouda de vaca Hacendado' at 0.45 kg / EUR 7.33/kg.
  // sizeRange 350-550 g catches the 0.40-0.45 kg standard wedges
  // (rejects 100-300 g snack packs and 1+ kg family blocks). After
  // normalize.ts rescaling to canonical 500 g, the on-chain price is
  // priceMajor * (500 / packSize).
  //
  // Excludes:
  // - Flavored variants (con trufa, con pimentón, ahumado)
  // - DOP premium (manchego, viejo de oveja) - too expensive, not staple
  // - Specialty cuts (tabla de quesos, snack)
  // - Sheep/goat-only (viejo de oveja, cabra) - too expensive
  cheese_local_500g: {
    parentCategoryId: 54,
    subcategoryMatch: /^queso (curado|semicurado|tierno)$/i,
    include: /queso/i,
    exclude: [
      /trufa/i,
      /pimentón|pimenton/i,
      /ahumad/i,
      /manchego/i,
      /viejo/i,
      /añejo|anejo/i,
      /tabla/i,
      /snack/i,
      /cabra/i,
      /oveja/i,
      /tronch[oó]n/i,
      /cuñit/i,
      /dados/i,
      /escamas/i,
      /sin lactosa/i,
      /baja en sal/i,
    ],
    sizeRange: { min: 350, max: 550 },
  },
  // Imported single-can beer 500ml. Mercadona's `Cerveza lata` (cat
  // 549 under parent 164) ships Heineken at 0.33 L singles for EUR
  // 0.79. Other available imports are sparse: Steinburg is Mercadona
  // own-brand domestic, Mahou / Estrella Galicia / Voll-Damm / Alhambra
  // are Spanish, 1925 Alhambra is Spanish premium. The whitelist below
  // captures imported international brands; in practice Heineken is
  // the only consistent match at Mercadona Madrid.
  //
  // sizeRange 250-550 ml catches:
  // - 0.33 L single cans (standard for ES, normalize.ts rescales)
  // - 0.5 L singles if Mercadona stocks any
  // - 0.25 L bottles (botellín) of imported brands
  //
  // Multi-pack SKUs (Heineken 8x33cl = 2.64 L total) are rejected by
  // the global is_pack check in pickBestMatch.
  //
  // Excludes:
  // - Non-alcoholic / sin alcohol variants
  // - Radler / shandy / aromatizada flavored variants
  beer_imported_500ml: {
    parentCategoryId: 164,
    subcategoryMatch: /^cerveza (lata|botella y botellín|botella y botellin)$/i,
    include: /\b(heineken|carlsberg|tuborg|stella artois|becks|budweiser|corona extra|leffe|hoegaarden|krombacher|paulaner|warsteiner|asahi|peroni|kronenbourg|guinness|grolsch|miller|amstel|desperados)\b/i,
    exclude: [
      /sin alcohol/i,
      /\b(0\.0%|0%|alcohol-free|non-alcoholic)\b/i,
      /\b(radler|shandy|aromatizada|sabor|con zumo)\b/i,
    ],
    sizeRange: { min: 250, max: 550 },
  },
  // Bananas (plátano / banana). Cat 27 sub 853 "Plátano y uva" ships
  // single-bunch loose units (e.g. 0.15 kg single Plátano de Canarias
  // at EUR 0.44, or 0.18 kg Banana at EUR 0.23) and bulk bags. The
  // `allowPacks` flag enables the bagged version to compete on the
  // per-kg bulk_price axis. `plátano macho` (cooking plantain) is
  // ranged out via include with no need for an exclude.
  bananas_1kg: {
    parentCategoryId: 27,
    subcategoryMatch: /pl[áa]tano/i,
    include: /\b(pl[áa]tano|banana)\b/i,
    exclude: [
      /\b(macho|fritura|chips|deshidrat|seco|congelad|preparad|snack|tostada|smoothie|zumo|jugo|barrita|papilla)\b/i,
    ],
    sizeRange: { min: 100, max: 3000 },
    allowPacks: true,
  },
  // Apples (manzana). Cat 27 sub 251 "Manzana y pera" ships loose
  // single fruit (Golden, Granny Smith, roja, acidulce; ~0.16 to
  // 0.28 kg each) and bagged kg multipacks. The bagged 1.55 kg pack
  // typically wins on bulk_price. Excludes block pears and apple
  // products (juice, baby food, sauce).
  apples_1kg: {
    parentCategoryId: 27,
    subcategoryMatch: /manzana/i,
    include: /\bmanzanas?\b/i,
    exclude: [
      /\bpera\b|\bperas\b/i,
      /\b(zumo|jugo|smoothie|papilla|compot|asada|pur[ée]|crema|barrita|t[ée]|snack|deshidrat|sec|seca|congelad)\b/i,
    ],
    sizeRange: { min: 100, max: 3000 },
    allowPacks: true,
  },
  // Tomatoes (tomate). Cat 29 sub 855 "Tomate" ships loose single
  // tomatoes (ensalada ~0.28 kg, canario ~0.19 kg, pera ~0.17 kg)
  // and tray packs. Cheapest per kg wins. Excludes block tomato
  // products (frito, triturado, deshidratado, soup, gazpacho).
  tomatoes_1kg: {
    parentCategoryId: 29,
    subcategoryMatch: /tomate/i,
    include: /\btomates?\b/i,
    exclude: [
      /\b(frito|triturad|deshidrat|sec|seca|conserv|salsa|gazpach|sopa|crema|zumo|jugo|relleno|aliñad|salpic)\b/i,
    ],
    sizeRange: { min: 100, max: 3000 },
    allowPacks: true,
  },
  // Potatoes (patata). Cat 29 sub 854 "Patata" ships loose units
  // (~0.22 kg single Patata at EUR 0.42) and 2 to 3 kg bulk bags
  // (Patatas rojas 2 kg at EUR 3.80, Patatas 3 kg at EUR 4.65). The
  // bagged versions usually win on bulk_price. Excludes block fries
  // (sub 267 Verduras al vapor "Patatas para microondas", frozen
  // chips in Congelados, snack crisps in Aperitivos, all of which
  // live outside cat 29 anyway but defended against in case sub 854
  // ever carries them).
  potatoes_1kg: {
    parentCategoryId: 29,
    subcategoryMatch: /patata/i,
    include: /\bpatatas?\b/i,
    exclude: [
      /\b(frita|frito|chips|crujient|onduladas?|microondas|prefrit|congelad|deshidrat|seco|seca|cocida|cocinada|pur[ée]|copos)\b/i,
    ],
    sizeRange: { min: 100, max: 5000 },
    allowPacks: true,
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
      // Default behaviour: skip 6-bottle / 4-can multipacks because
      // those are not the slug's cheapest-staple proxy. Produce
      // pickers opt in via picker.allowPacks (loose-fruit single
      // units AND bagged kg-bulk packs both count).
      if (p.price_instructions.is_pack && !picker.allowPacks) continue;
      if (!picker.include.test(p.display_name)) continue;
      if (picker.exclude.some((rx) => rx.test(p.display_name))) continue;
      const size = sizeToTargetUnit(p);
      if (size < picker.sizeRange.min || size > picker.sizeRange.max) continue;
      candidates.push({ product: p, size });
    }
  }
  if (candidates.length === 0) return null;
  // Sort by per-kg / per-L `bulk_price` when packs are in play
  // (produce ships single units AND bulk bags side by side, so the
  // raw sticker `unit_price` ranks the smallest bag first instead of
  // the cheapest per-kg pack). For non-pack slugs, sizes inside the
  // picker's sizeRange are comparable and the two orderings agree;
  // we keep `unit_price` there to avoid touching the existing
  // baseline.
  if (picker.allowPacks) {
    candidates.sort(
      (a, b) =>
        Number.parseFloat(a.product.price_instructions.bulk_price) -
        Number.parseFloat(b.product.price_instructions.bulk_price),
    );
  } else {
    candidates.sort(
      (a, b) =>
        Number.parseFloat(a.product.price_instructions.unit_price) -
        Number.parseFloat(b.product.price_instructions.unit_price),
    );
  }
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
// @scraper: mercadona-es
// @rate-limit: respect retailer crawl policy
// @retry: exponential backoff on fetch failure
// @i18n: extract pluralization logic
// @perf: add caching layer here
// @config: make this configurable via env
// @todo: add unit test coverage
// @note: coordinated with PR #87
// @note: coordinated with PR #87
// @i18n: ensure this string is extracted
// @config: expose timeout as parameter
// @type: narrow the generic constraint
// @guard: rate limit this operation
// @note: see design doc in Notion
