/**
 * meRacle product catalog.
 *
 * Each entry pairs a Mercato canonical product slug with a country code
 * and the retailer the scraper will visit. Slug values MUST match
 * Mercato's `apps/web/src/lib/products.ts` exactly, the same string is
 * keccak256'd to bytes12 by both sides, any drift breaks aggregation.
 *
 * Country codes are ISO-3166-1 alpha-2 in upper case ("GB", not "UK").
 * Mercato encodes them to bytes6 zoneKey as ASCII left-padded with
 * zeros, the agent reproduces that encoding in src/encode.ts.
 *
 * Currency is informational here, the on-chain priceCents is in
 * local-currency cents (UAH cents, GBP pence, EUR cents, PLN groszy).
 * Cross-country comparison happens in the Mercato UI via offchain FX,
 * NOT in the scraper.
 *
 * `canonicalSize` is the size baked into the slug. For weights and
 * volumes the value is in grams or millilitres. For piece-counted
 * goods (eggs) it is the number of items in the pack.
 *
 * Scope expands by appending entries here, the rest of the pipeline
 * (encode, normalize, submit) is product-agnostic. Adding a new
 * retailer requires a corresponding scraper module in src/scrapers/.
 */

export type Retailer =
  | "novus-ua"
  | "sainsburys-uk"
  | "mercadona-es"
  | "biedronka-pl"
  | "rewe-de"
  | "carrefour-fr"
  | "esselunga-it";

export type Unit = "g" | "ml" | "pcs";

export type ProductSlug =
  | "bread_500g"
  | "milk_1l"
  | "eggs_12"
  | "butter_200g"
  | "sugar_1kg"
  | "rice_1kg"
  | "tomatoes_1kg"
  | "potatoes_1kg";

export type CountryCode = "UA" | "GB" | "ES" | "PL" | "DE" | "FR" | "IT";

export type CurrencyCode = "UAH" | "GBP" | "EUR" | "PLN";

export interface ProductTarget {
  /** Mercato canonical slug, hashed to bytes12 barcode. */
  slug: ProductSlug;
  /** Canonical size baked into the slug. */
  canonicalSize: number;
  /** Unit the canonical size is measured in. */
  unit: Unit;
  /** ISO-3166-1 alpha-2 country code. */
  country: CountryCode;
  /** ISO-4217 currency code, informational. */
  currency: CurrencyCode;
  /** Which scraper module fetches this target. */
  retailer: Retailer;
  /**
   * Sanity range in local currency major units. Observations falling
   * outside the range are flagged before submission, prevents bad
   * scrapes from polluting the on-chain dataset.
   */
  sanityRange: { minMajor: number; maxMajor: number };
}

export const PRODUCT_TARGETS: readonly ProductTarget[] = [
  // UKRAINE, Novus Kyiv via zakaz.ua API
  { slug: "bread_500g",  canonicalSize: 500,  unit: "g",   country: "UA", currency: "UAH", retailer: "novus-ua",      sanityRange: { minMajor: 15, maxMajor: 90 } },
  { slug: "milk_1l",     canonicalSize: 1000, unit: "ml",  country: "UA", currency: "UAH", retailer: "novus-ua",      sanityRange: { minMajor: 30, maxMajor: 90 } },
  { slug: "eggs_12",  canonicalSize: 12,   unit: "pcs", country: "UA", currency: "UAH", retailer: "novus-ua",      sanityRange: { minMajor: 48, maxMajor: 180 } },
  { slug: "butter_200g", canonicalSize: 200,  unit: "g",   country: "UA", currency: "UAH", retailer: "novus-ua",      sanityRange: { minMajor: 50, maxMajor: 200 } },
  { slug: "sugar_1kg",   canonicalSize: 1000, unit: "g",   country: "UA", currency: "UAH", retailer: "novus-ua",      sanityRange: { minMajor: 20, maxMajor: 100 } },
  { slug: "rice_1kg",    canonicalSize: 1000, unit: "g",   country: "UA", currency: "UAH", retailer: "novus-ua",      sanityRange: { minMajor: 40, maxMajor: 200 } },
  { slug: "tomatoes_1kg",canonicalSize: 1000, unit: "g",   country: "UA", currency: "UAH", retailer: "novus-ua",      sanityRange: { minMajor: 30, maxMajor: 250 } },
  { slug: "potatoes_1kg",canonicalSize: 1000, unit: "g",   country: "UA", currency: "UAH", retailer: "novus-ua",      sanityRange: { minMajor: 15, maxMajor: 80 } },

  // UNITED KINGDOM, Sainsbury's via Browser Use Cloud
  { slug: "bread_500g",  canonicalSize: 500,  unit: "g",   country: "GB", currency: "GBP", retailer: "sainsburys-uk", sanityRange: { minMajor: 0.5, maxMajor: 3 } },
  { slug: "milk_1l",     canonicalSize: 1000, unit: "ml",  country: "GB", currency: "GBP", retailer: "sainsburys-uk", sanityRange: { minMajor: 0.9, maxMajor: 2 } },
  { slug: "eggs_12",  canonicalSize: 12,   unit: "pcs", country: "GB", currency: "GBP", retailer: "sainsburys-uk", sanityRange: { minMajor: 1.8, maxMajor: 6 } },
  { slug: "butter_200g", canonicalSize: 200,  unit: "g",   country: "GB", currency: "GBP", retailer: "sainsburys-uk", sanityRange: { minMajor: 1, maxMajor: 4 } },
  { slug: "sugar_1kg",   canonicalSize: 1000, unit: "g",   country: "GB", currency: "GBP", retailer: "sainsburys-uk", sanityRange: { minMajor: 0.7, maxMajor: 3 } },
  { slug: "rice_1kg",    canonicalSize: 1000, unit: "g",   country: "GB", currency: "GBP", retailer: "sainsburys-uk", sanityRange: { minMajor: 1, maxMajor: 5 } },
  { slug: "tomatoes_1kg",canonicalSize: 1000, unit: "g",   country: "GB", currency: "GBP", retailer: "sainsburys-uk", sanityRange: { minMajor: 1.5, maxMajor: 7 } },
  { slug: "potatoes_1kg",canonicalSize: 1000, unit: "g",   country: "GB", currency: "GBP", retailer: "sainsburys-uk", sanityRange: { minMajor: 0.7, maxMajor: 4 } },

  // SPAIN, Mercadona (Madrid postal 28001)
  { slug: "bread_500g",  canonicalSize: 500,  unit: "g",   country: "ES", currency: "EUR", retailer: "mercadona-es",  sanityRange: { minMajor: 0.6, maxMajor: 3 } },
  { slug: "milk_1l",     canonicalSize: 1000, unit: "ml",  country: "ES", currency: "EUR", retailer: "mercadona-es",  sanityRange: { minMajor: 0.8, maxMajor: 2 } },
  { slug: "eggs_12",  canonicalSize: 12,   unit: "pcs", country: "ES", currency: "EUR", retailer: "mercadona-es",  sanityRange: { minMajor: 1.8, maxMajor: 6 } },
  { slug: "butter_200g", canonicalSize: 200,  unit: "g",   country: "ES", currency: "EUR", retailer: "mercadona-es",  sanityRange: { minMajor: 1.5, maxMajor: 5 } },
  { slug: "sugar_1kg",   canonicalSize: 1000, unit: "g",   country: "ES", currency: "EUR", retailer: "mercadona-es",  sanityRange: { minMajor: 0.7, maxMajor: 3 } },
  { slug: "rice_1kg",    canonicalSize: 1000, unit: "g",   country: "ES", currency: "EUR", retailer: "mercadona-es",  sanityRange: { minMajor: 1, maxMajor: 5 } },
  { slug: "tomatoes_1kg",canonicalSize: 1000, unit: "g",   country: "ES", currency: "EUR", retailer: "mercadona-es",  sanityRange: { minMajor: 1.2, maxMajor: 6 } },
  { slug: "potatoes_1kg",canonicalSize: 1000, unit: "g",   country: "ES", currency: "EUR", retailer: "mercadona-es",  sanityRange: { minMajor: 0.7, maxMajor: 4 } },

  // POLAND, Biedronka (scraper pending)
  { slug: "bread_500g",  canonicalSize: 500,  unit: "g",   country: "PL", currency: "PLN", retailer: "biedronka-pl",  sanityRange: { minMajor: 2, maxMajor: 15 } },
  { slug: "milk_1l",     canonicalSize: 1000, unit: "ml",  country: "PL", currency: "PLN", retailer: "biedronka-pl",  sanityRange: { minMajor: 2.5, maxMajor: 10 } },
  { slug: "eggs_12",  canonicalSize: 12,   unit: "pcs", country: "PL", currency: "PLN", retailer: "biedronka-pl",  sanityRange: { minMajor: 6, maxMajor: 24 } },
  { slug: "butter_200g", canonicalSize: 200,  unit: "g",   country: "PL", currency: "PLN", retailer: "biedronka-pl",  sanityRange: { minMajor: 5, maxMajor: 15 } },
  { slug: "sugar_1kg",   canonicalSize: 1000, unit: "g",   country: "PL", currency: "PLN", retailer: "biedronka-pl",  sanityRange: { minMajor: 3, maxMajor: 12 } },
  { slug: "rice_1kg",    canonicalSize: 1000, unit: "g",   country: "PL", currency: "PLN", retailer: "biedronka-pl",  sanityRange: { minMajor: 4, maxMajor: 15 } },
  { slug: "tomatoes_1kg",canonicalSize: 1000, unit: "g",   country: "PL", currency: "PLN", retailer: "biedronka-pl",  sanityRange: { minMajor: 4, maxMajor: 18 } },
  { slug: "potatoes_1kg",canonicalSize: 1000, unit: "g",   country: "PL", currency: "PLN", retailer: "biedronka-pl",  sanityRange: { minMajor: 2, maxMajor: 10 } },

  // GERMANY, Rewe (scraper pending)
  { slug: "bread_500g",  canonicalSize: 500,  unit: "g",   country: "DE", currency: "EUR", retailer: "rewe-de",       sanityRange: { minMajor: 0.6, maxMajor: 3.5 } },
  { slug: "milk_1l",     canonicalSize: 1000, unit: "ml",  country: "DE", currency: "EUR", retailer: "rewe-de",       sanityRange: { minMajor: 0.8, maxMajor: 2.5 } },
  { slug: "eggs_12",  canonicalSize: 12,   unit: "pcs", country: "DE", currency: "EUR", retailer: "rewe-de",       sanityRange: { minMajor: 1.8, maxMajor: 6 } },
  { slug: "butter_200g", canonicalSize: 200,  unit: "g",   country: "DE", currency: "EUR", retailer: "rewe-de",       sanityRange: { minMajor: 1.5, maxMajor: 4 } },
  { slug: "sugar_1kg",   canonicalSize: 1000, unit: "g",   country: "DE", currency: "EUR", retailer: "rewe-de",       sanityRange: { minMajor: 0.7, maxMajor: 3 } },
  { slug: "rice_1kg",    canonicalSize: 1000, unit: "g",   country: "DE", currency: "EUR", retailer: "rewe-de",       sanityRange: { minMajor: 1, maxMajor: 5 } },
  { slug: "tomatoes_1kg",canonicalSize: 1000, unit: "g",   country: "DE", currency: "EUR", retailer: "rewe-de",       sanityRange: { minMajor: 1.5, maxMajor: 6 } },
  { slug: "potatoes_1kg",canonicalSize: 1000, unit: "g",   country: "DE", currency: "EUR", retailer: "rewe-de",       sanityRange: { minMajor: 0.8, maxMajor: 4 } },

  // FRANCE, Carrefour (scraper pending)
  { slug: "bread_500g",  canonicalSize: 500,  unit: "g",   country: "FR", currency: "EUR", retailer: "carrefour-fr",  sanityRange: { minMajor: 0.7, maxMajor: 4 } },
  { slug: "milk_1l",     canonicalSize: 1000, unit: "ml",  country: "FR", currency: "EUR", retailer: "carrefour-fr",  sanityRange: { minMajor: 0.8, maxMajor: 2 } },
  { slug: "eggs_12",  canonicalSize: 12,   unit: "pcs", country: "FR", currency: "EUR", retailer: "carrefour-fr",  sanityRange: { minMajor: 2.4, maxMajor: 8.4 } },
  { slug: "butter_200g", canonicalSize: 200,  unit: "g",   country: "FR", currency: "EUR", retailer: "carrefour-fr",  sanityRange: { minMajor: 2, maxMajor: 5 } },
  { slug: "sugar_1kg",   canonicalSize: 1000, unit: "g",   country: "FR", currency: "EUR", retailer: "carrefour-fr",  sanityRange: { minMajor: 0.8, maxMajor: 3 } },
  { slug: "rice_1kg",    canonicalSize: 1000, unit: "g",   country: "FR", currency: "EUR", retailer: "carrefour-fr",  sanityRange: { minMajor: 1, maxMajor: 5 } },
  { slug: "tomatoes_1kg",canonicalSize: 1000, unit: "g",   country: "FR", currency: "EUR", retailer: "carrefour-fr",  sanityRange: { minMajor: 1.5, maxMajor: 6 } },
  { slug: "potatoes_1kg",canonicalSize: 1000, unit: "g",   country: "FR", currency: "EUR", retailer: "carrefour-fr",  sanityRange: { minMajor: 0.8, maxMajor: 4 } },

  // ITALY, Esselunga (scraper pending)
  { slug: "bread_500g",  canonicalSize: 500,  unit: "g",   country: "IT", currency: "EUR", retailer: "esselunga-it",  sanityRange: { minMajor: 0.6, maxMajor: 3 } },
  { slug: "milk_1l",     canonicalSize: 1000, unit: "ml",  country: "IT", currency: "EUR", retailer: "esselunga-it",  sanityRange: { minMajor: 0.9, maxMajor: 2 } },
  { slug: "eggs_12",  canonicalSize: 12,   unit: "pcs", country: "IT", currency: "EUR", retailer: "esselunga-it",  sanityRange: { minMajor: 2.4, maxMajor: 6 } },
  { slug: "butter_200g", canonicalSize: 200,  unit: "g",   country: "IT", currency: "EUR", retailer: "esselunga-it",  sanityRange: { minMajor: 1.5, maxMajor: 5 } },
  { slug: "sugar_1kg",   canonicalSize: 1000, unit: "g",   country: "IT", currency: "EUR", retailer: "esselunga-it",  sanityRange: { minMajor: 0.8, maxMajor: 3 } },
  { slug: "rice_1kg",    canonicalSize: 1000, unit: "g",   country: "IT", currency: "EUR", retailer: "esselunga-it",  sanityRange: { minMajor: 1, maxMajor: 5 } },
  { slug: "tomatoes_1kg",canonicalSize: 1000, unit: "g",   country: "IT", currency: "EUR", retailer: "esselunga-it",  sanityRange: { minMajor: 1.2, maxMajor: 5 } },
  { slug: "potatoes_1kg",canonicalSize: 1000, unit: "g",   country: "IT", currency: "EUR", retailer: "esselunga-it",  sanityRange: { minMajor: 0.8, maxMajor: 4 } },
];

export function targetsForRetailer(retailer: Retailer): ProductTarget[] {
  return PRODUCT_TARGETS.filter((t) => t.retailer === retailer);
}
