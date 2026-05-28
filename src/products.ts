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
  | "conad-it"
  | "migros-tr";

export type Unit = "g" | "ml" | "pcs";

export type ProductSlug =
  | "bread_500g"
  | "milk_1l"
  | "eggs_12"
  | "butter_200g"
  | "sugar_1kg"
  | "rice_1kg"
  | "tomatoes_1kg"
  | "potatoes_1kg"
  | "olive_oil_1l"
  | "water_bottled_1500ml"
  | "bananas_1kg"
  | "apples_1kg"
  | "chicken_breast_1kg"
  | "beef_ground_1kg"
  | "cheese_local_500g"
  | "beer_imported_500ml";

export type CountryCode = "UA" | "GB" | "ES" | "PL" | "DE" | "FR" | "IT" | "TR";

export type CurrencyCode = "UAH" | "GBP" | "EUR" | "PLN" | "TRY";

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
  { slug: "olive_oil_1l",canonicalSize: 1000, unit: "ml",  country: "UA", currency: "UAH", retailer: "novus-ua",      sanityRange: { minMajor: 150, maxMajor: 900 } },
  { slug: "water_bottled_1500ml",canonicalSize: 1500, unit: "ml", country: "UA", currency: "UAH", retailer: "novus-ua",      sanityRange: { minMajor: 15, maxMajor: 80 } },
  { slug: "bananas_1kg", canonicalSize: 1000, unit: "g",   country: "UA", currency: "UAH", retailer: "novus-ua",      sanityRange: { minMajor: 30, maxMajor: 150 } },
  { slug: "apples_1kg",  canonicalSize: 1000, unit: "g",   country: "UA", currency: "UAH", retailer: "novus-ua",      sanityRange: { minMajor: 20, maxMajor: 200 } },
  { slug: "chicken_breast_1kg",canonicalSize: 1000, unit: "g", country: "UA", currency: "UAH", retailer: "novus-ua",      sanityRange: { minMajor: 100, maxMajor: 500 } },
  { slug: "beef_ground_1kg",canonicalSize: 1000, unit: "g", country: "UA", currency: "UAH", retailer: "novus-ua",      sanityRange: { minMajor: 150, maxMajor: 700 } },
  { slug: "cheese_local_500g",canonicalSize: 500, unit: "g", country: "UA", currency: "UAH", retailer: "novus-ua",      sanityRange: { minMajor: 100, maxMajor: 500 } },
  { slug: "beer_imported_500ml",canonicalSize: 500, unit: "ml", country: "UA", currency: "UAH", retailer: "novus-ua",      sanityRange: { minMajor: 30, maxMajor: 200 } },

  // UNITED KINGDOM, Sainsbury's via Browser Use Cloud
  { slug: "bread_500g",  canonicalSize: 500,  unit: "g",   country: "GB", currency: "GBP", retailer: "sainsburys-uk", sanityRange: { minMajor: 0.5, maxMajor: 3 } },
  { slug: "milk_1l",     canonicalSize: 1000, unit: "ml",  country: "GB", currency: "GBP", retailer: "sainsburys-uk", sanityRange: { minMajor: 0.9, maxMajor: 2 } },
  { slug: "eggs_12",  canonicalSize: 12,   unit: "pcs", country: "GB", currency: "GBP", retailer: "sainsburys-uk", sanityRange: { minMajor: 1.8, maxMajor: 6 } },
  { slug: "butter_200g", canonicalSize: 200,  unit: "g",   country: "GB", currency: "GBP", retailer: "sainsburys-uk", sanityRange: { minMajor: 1, maxMajor: 4 } },
  { slug: "sugar_1kg",   canonicalSize: 1000, unit: "g",   country: "GB", currency: "GBP", retailer: "sainsburys-uk", sanityRange: { minMajor: 0.7, maxMajor: 3 } },
  { slug: "rice_1kg",    canonicalSize: 1000, unit: "g",   country: "GB", currency: "GBP", retailer: "sainsburys-uk", sanityRange: { minMajor: 1, maxMajor: 5 } },
  { slug: "tomatoes_1kg",canonicalSize: 1000, unit: "g",   country: "GB", currency: "GBP", retailer: "sainsburys-uk", sanityRange: { minMajor: 1.5, maxMajor: 7 } },
  { slug: "potatoes_1kg",canonicalSize: 1000, unit: "g",   country: "GB", currency: "GBP", retailer: "sainsburys-uk", sanityRange: { minMajor: 0.7, maxMajor: 4 } },
  { slug: "olive_oil_1l",canonicalSize: 1000, unit: "ml",  country: "GB", currency: "GBP", retailer: "sainsburys-uk", sanityRange: { minMajor: 3, maxMajor: 15 } },
  { slug: "water_bottled_1500ml",canonicalSize: 1500, unit: "ml", country: "GB", currency: "GBP", retailer: "sainsburys-uk", sanityRange: { minMajor: 0.3, maxMajor: 2 } },
  { slug: "bananas_1kg", canonicalSize: 1000, unit: "g",   country: "GB", currency: "GBP", retailer: "sainsburys-uk", sanityRange: { minMajor: 0.6, maxMajor: 3 } },
  { slug: "apples_1kg",  canonicalSize: 1000, unit: "g",   country: "GB", currency: "GBP", retailer: "sainsburys-uk", sanityRange: { minMajor: 1, maxMajor: 5 } },
  { slug: "chicken_breast_1kg",canonicalSize: 1000, unit: "g", country: "GB", currency: "GBP", retailer: "sainsburys-uk", sanityRange: { minMajor: 3, maxMajor: 12 } },
  { slug: "beef_ground_1kg",canonicalSize: 1000, unit: "g", country: "GB", currency: "GBP", retailer: "sainsburys-uk", sanityRange: { minMajor: 4, maxMajor: 18 } },
  { slug: "cheese_local_500g",canonicalSize: 500, unit: "g", country: "GB", currency: "GBP", retailer: "sainsburys-uk", sanityRange: { minMajor: 2, maxMajor: 12 } },
  { slug: "beer_imported_500ml",canonicalSize: 500, unit: "ml", country: "GB", currency: "GBP", retailer: "sainsburys-uk", sanityRange: { minMajor: 1, maxMajor: 5 } },

  // SPAIN, Mercadona (Madrid postal 28001)
  { slug: "bread_500g",  canonicalSize: 500,  unit: "g",   country: "ES", currency: "EUR", retailer: "mercadona-es",  sanityRange: { minMajor: 0.6, maxMajor: 3 } },
  { slug: "milk_1l",     canonicalSize: 1000, unit: "ml",  country: "ES", currency: "EUR", retailer: "mercadona-es",  sanityRange: { minMajor: 0.8, maxMajor: 2 } },
  { slug: "eggs_12",  canonicalSize: 12,   unit: "pcs", country: "ES", currency: "EUR", retailer: "mercadona-es",  sanityRange: { minMajor: 1.8, maxMajor: 6 } },
  { slug: "butter_200g", canonicalSize: 200,  unit: "g",   country: "ES", currency: "EUR", retailer: "mercadona-es",  sanityRange: { minMajor: 1.5, maxMajor: 5 } },
  { slug: "sugar_1kg",   canonicalSize: 1000, unit: "g",   country: "ES", currency: "EUR", retailer: "mercadona-es",  sanityRange: { minMajor: 0.7, maxMajor: 3 } },
  { slug: "rice_1kg",    canonicalSize: 1000, unit: "g",   country: "ES", currency: "EUR", retailer: "mercadona-es",  sanityRange: { minMajor: 1, maxMajor: 5 } },
  { slug: "tomatoes_1kg",canonicalSize: 1000, unit: "g",   country: "ES", currency: "EUR", retailer: "mercadona-es",  sanityRange: { minMajor: 1.2, maxMajor: 6 } },
  { slug: "potatoes_1kg",canonicalSize: 1000, unit: "g",   country: "ES", currency: "EUR", retailer: "mercadona-es",  sanityRange: { minMajor: 0.7, maxMajor: 4 } },
  { slug: "olive_oil_1l",canonicalSize: 1000, unit: "ml",  country: "ES", currency: "EUR", retailer: "mercadona-es",  sanityRange: { minMajor: 3, maxMajor: 15 } },
  { slug: "water_bottled_1500ml",canonicalSize: 1500, unit: "ml", country: "ES", currency: "EUR", retailer: "mercadona-es",  sanityRange: { minMajor: 0.25, maxMajor: 2 } },
  { slug: "bananas_1kg", canonicalSize: 1000, unit: "g",   country: "ES", currency: "EUR", retailer: "mercadona-es",  sanityRange: { minMajor: 0.8, maxMajor: 3.5 } },
  { slug: "apples_1kg",  canonicalSize: 1000, unit: "g",   country: "ES", currency: "EUR", retailer: "mercadona-es",  sanityRange: { minMajor: 1, maxMajor: 4 } },
  { slug: "chicken_breast_1kg",canonicalSize: 1000, unit: "g", country: "ES", currency: "EUR", retailer: "mercadona-es",  sanityRange: { minMajor: 3, maxMajor: 15 } },
  { slug: "beef_ground_1kg",canonicalSize: 1000, unit: "g", country: "ES", currency: "EUR", retailer: "mercadona-es",  sanityRange: { minMajor: 5, maxMajor: 22 } },
  { slug: "cheese_local_500g",canonicalSize: 500, unit: "g", country: "ES", currency: "EUR", retailer: "mercadona-es",  sanityRange: { minMajor: 2.5, maxMajor: 15 } },
  { slug: "beer_imported_500ml",canonicalSize: 500, unit: "ml", country: "ES", currency: "EUR", retailer: "mercadona-es",  sanityRange: { minMajor: 0.6, maxMajor: 5 } },

  // POLAND, Biedronka (scraper pending)
  { slug: "bread_500g",  canonicalSize: 500,  unit: "g",   country: "PL", currency: "PLN", retailer: "biedronka-pl",  sanityRange: { minMajor: 2, maxMajor: 15 } },
  { slug: "milk_1l",     canonicalSize: 1000, unit: "ml",  country: "PL", currency: "PLN", retailer: "biedronka-pl",  sanityRange: { minMajor: 2.5, maxMajor: 10 } },
  { slug: "eggs_12",  canonicalSize: 12,   unit: "pcs", country: "PL", currency: "PLN", retailer: "biedronka-pl",  sanityRange: { minMajor: 6, maxMajor: 24 } },
  { slug: "butter_200g", canonicalSize: 200,  unit: "g",   country: "PL", currency: "PLN", retailer: "biedronka-pl",  sanityRange: { minMajor: 5, maxMajor: 15 } },
  { slug: "sugar_1kg",   canonicalSize: 1000, unit: "g",   country: "PL", currency: "PLN", retailer: "biedronka-pl",  sanityRange: { minMajor: 3, maxMajor: 12 } },
  { slug: "rice_1kg",    canonicalSize: 1000, unit: "g",   country: "PL", currency: "PLN", retailer: "biedronka-pl",  sanityRange: { minMajor: 4, maxMajor: 15 } },
  { slug: "tomatoes_1kg",canonicalSize: 1000, unit: "g",   country: "PL", currency: "PLN", retailer: "biedronka-pl",  sanityRange: { minMajor: 4, maxMajor: 18 } },
  { slug: "potatoes_1kg",canonicalSize: 1000, unit: "g",   country: "PL", currency: "PLN", retailer: "biedronka-pl",  sanityRange: { minMajor: 2, maxMajor: 10 } },
  { slug: "olive_oil_1l",canonicalSize: 1000, unit: "ml",  country: "PL", currency: "PLN", retailer: "biedronka-pl",  sanityRange: { minMajor: 12, maxMajor: 60 } },
  { slug: "water_bottled_1500ml",canonicalSize: 1500, unit: "ml", country: "PL", currency: "PLN", retailer: "biedronka-pl",  sanityRange: { minMajor: 1, maxMajor: 8 } },
  { slug: "bananas_1kg", canonicalSize: 1000, unit: "g",   country: "PL", currency: "PLN", retailer: "biedronka-pl",  sanityRange: { minMajor: 3, maxMajor: 12 } },
  { slug: "apples_1kg",  canonicalSize: 1000, unit: "g",   country: "PL", currency: "PLN", retailer: "biedronka-pl",  sanityRange: { minMajor: 3, maxMajor: 15 } },
  { slug: "chicken_breast_1kg",canonicalSize: 1000, unit: "g", country: "PL", currency: "PLN", retailer: "biedronka-pl",  sanityRange: { minMajor: 15, maxMajor: 60 } },
  { slug: "beef_ground_1kg",canonicalSize: 1000, unit: "g", country: "PL", currency: "PLN", retailer: "biedronka-pl",  sanityRange: { minMajor: 20, maxMajor: 90 } },
  { slug: "cheese_local_500g",canonicalSize: 500, unit: "g", country: "PL", currency: "PLN", retailer: "biedronka-pl",  sanityRange: { minMajor: 8, maxMajor: 45 } },
  { slug: "beer_imported_500ml",canonicalSize: 500, unit: "ml", country: "PL", currency: "PLN", retailer: "biedronka-pl",  sanityRange: { minMajor: 3, maxMajor: 20 } },

  // GERMANY, Rewe (scraper pending)
  { slug: "bread_500g",  canonicalSize: 500,  unit: "g",   country: "DE", currency: "EUR", retailer: "rewe-de",       sanityRange: { minMajor: 0.6, maxMajor: 3.5 } },
  { slug: "milk_1l",     canonicalSize: 1000, unit: "ml",  country: "DE", currency: "EUR", retailer: "rewe-de",       sanityRange: { minMajor: 0.8, maxMajor: 2.5 } },
  { slug: "eggs_12",  canonicalSize: 12,   unit: "pcs", country: "DE", currency: "EUR", retailer: "rewe-de",       sanityRange: { minMajor: 1.8, maxMajor: 6 } },
  { slug: "butter_200g", canonicalSize: 200,  unit: "g",   country: "DE", currency: "EUR", retailer: "rewe-de",       sanityRange: { minMajor: 1.5, maxMajor: 4 } },
  { slug: "sugar_1kg",   canonicalSize: 1000, unit: "g",   country: "DE", currency: "EUR", retailer: "rewe-de",       sanityRange: { minMajor: 0.7, maxMajor: 3 } },
  { slug: "rice_1kg",    canonicalSize: 1000, unit: "g",   country: "DE", currency: "EUR", retailer: "rewe-de",       sanityRange: { minMajor: 1, maxMajor: 5 } },
  { slug: "tomatoes_1kg",canonicalSize: 1000, unit: "g",   country: "DE", currency: "EUR", retailer: "rewe-de",       sanityRange: { minMajor: 1.5, maxMajor: 6 } },
  { slug: "potatoes_1kg",canonicalSize: 1000, unit: "g",   country: "DE", currency: "EUR", retailer: "rewe-de",       sanityRange: { minMajor: 0.8, maxMajor: 4 } },
  { slug: "olive_oil_1l",canonicalSize: 1000, unit: "ml",  country: "DE", currency: "EUR", retailer: "rewe-de",       sanityRange: { minMajor: 3, maxMajor: 15 } },
  { slug: "water_bottled_1500ml",canonicalSize: 1500, unit: "ml", country: "DE", currency: "EUR", retailer: "rewe-de",       sanityRange: { minMajor: 0.25, maxMajor: 2 } },
  { slug: "bananas_1kg", canonicalSize: 1000, unit: "g",   country: "DE", currency: "EUR", retailer: "rewe-de",       sanityRange: { minMajor: 1, maxMajor: 3.5 } },
  { slug: "apples_1kg",  canonicalSize: 1000, unit: "g",   country: "DE", currency: "EUR", retailer: "rewe-de",       sanityRange: { minMajor: 1.2, maxMajor: 5 } },
  { slug: "chicken_breast_1kg",canonicalSize: 1000, unit: "g", country: "DE", currency: "EUR", retailer: "rewe-de",       sanityRange: { minMajor: 5, maxMajor: 18 } },
  { slug: "beef_ground_1kg",canonicalSize: 1000, unit: "g", country: "DE", currency: "EUR", retailer: "rewe-de",       sanityRange: { minMajor: 6, maxMajor: 22 } },
  { slug: "cheese_local_500g",canonicalSize: 500, unit: "g", country: "DE", currency: "EUR", retailer: "rewe-de",       sanityRange: { minMajor: 2.5, maxMajor: 15 } },
  { slug: "beer_imported_500ml",canonicalSize: 500, unit: "ml", country: "DE", currency: "EUR", retailer: "rewe-de",       sanityRange: { minMajor: 0.6, maxMajor: 5 } },

  // FRANCE, Carrefour (scraper pending)
  { slug: "bread_500g",  canonicalSize: 500,  unit: "g",   country: "FR", currency: "EUR", retailer: "carrefour-fr",  sanityRange: { minMajor: 0.7, maxMajor: 4 } },
  { slug: "milk_1l",     canonicalSize: 1000, unit: "ml",  country: "FR", currency: "EUR", retailer: "carrefour-fr",  sanityRange: { minMajor: 0.8, maxMajor: 2 } },
  { slug: "eggs_12",  canonicalSize: 12,   unit: "pcs", country: "FR", currency: "EUR", retailer: "carrefour-fr",  sanityRange: { minMajor: 2.4, maxMajor: 8.4 } },
  { slug: "butter_200g", canonicalSize: 200,  unit: "g",   country: "FR", currency: "EUR", retailer: "carrefour-fr",  sanityRange: { minMajor: 1.2, maxMajor: 5 } },
  { slug: "sugar_1kg",   canonicalSize: 1000, unit: "g",   country: "FR", currency: "EUR", retailer: "carrefour-fr",  sanityRange: { minMajor: 0.8, maxMajor: 3 } },
  { slug: "rice_1kg",    canonicalSize: 1000, unit: "g",   country: "FR", currency: "EUR", retailer: "carrefour-fr",  sanityRange: { minMajor: 1, maxMajor: 5 } },
  { slug: "tomatoes_1kg",canonicalSize: 1000, unit: "g",   country: "FR", currency: "EUR", retailer: "carrefour-fr",  sanityRange: { minMajor: 1.5, maxMajor: 6 } },
  { slug: "potatoes_1kg",canonicalSize: 1000, unit: "g",   country: "FR", currency: "EUR", retailer: "carrefour-fr",  sanityRange: { minMajor: 0.8, maxMajor: 4 } },
  { slug: "olive_oil_1l",canonicalSize: 1000, unit: "ml",  country: "FR", currency: "EUR", retailer: "carrefour-fr",  sanityRange: { minMajor: 3, maxMajor: 15 } },
  { slug: "water_bottled_1500ml",canonicalSize: 1500, unit: "ml", country: "FR", currency: "EUR", retailer: "carrefour-fr",  sanityRange: { minMajor: 0.25, maxMajor: 2 } },
  { slug: "bananas_1kg", canonicalSize: 1000, unit: "g",   country: "FR", currency: "EUR", retailer: "carrefour-fr",  sanityRange: { minMajor: 1, maxMajor: 3.5 } },
  { slug: "apples_1kg",  canonicalSize: 1000, unit: "g",   country: "FR", currency: "EUR", retailer: "carrefour-fr",  sanityRange: { minMajor: 1.2, maxMajor: 5 } },
  { slug: "chicken_breast_1kg",canonicalSize: 1000, unit: "g", country: "FR", currency: "EUR", retailer: "carrefour-fr",  sanityRange: { minMajor: 5, maxMajor: 18 } },
  { slug: "beef_ground_1kg",canonicalSize: 1000, unit: "g", country: "FR", currency: "EUR", retailer: "carrefour-fr",  sanityRange: { minMajor: 6, maxMajor: 22 } },
  { slug: "cheese_local_500g",canonicalSize: 500, unit: "g", country: "FR", currency: "EUR", retailer: "carrefour-fr",  sanityRange: { minMajor: 3, maxMajor: 18 } },
  { slug: "beer_imported_500ml",canonicalSize: 500, unit: "ml", country: "FR", currency: "EUR", retailer: "carrefour-fr",  sanityRange: { minMajor: 0.8, maxMajor: 5 } },

  // ITALY, Esselunga (scraper pending)
  { slug: "bread_500g",  canonicalSize: 500,  unit: "g",   country: "IT", currency: "EUR", retailer: "conad-it"     ,  sanityRange: { minMajor: 0.6, maxMajor: 3 } },
  { slug: "milk_1l",     canonicalSize: 1000, unit: "ml",  country: "IT", currency: "EUR", retailer: "conad-it"     ,  sanityRange: { minMajor: 0.9, maxMajor: 2 } },
  { slug: "eggs_12",  canonicalSize: 12,   unit: "pcs", country: "IT", currency: "EUR", retailer: "conad-it"     ,  sanityRange: { minMajor: 2.4, maxMajor: 6 } },
  { slug: "butter_200g", canonicalSize: 200,  unit: "g",   country: "IT", currency: "EUR", retailer: "conad-it"     ,  sanityRange: { minMajor: 1.5, maxMajor: 5 } },
  { slug: "sugar_1kg",   canonicalSize: 1000, unit: "g",   country: "IT", currency: "EUR", retailer: "conad-it"     ,  sanityRange: { minMajor: 0.8, maxMajor: 3 } },
  { slug: "rice_1kg",    canonicalSize: 1000, unit: "g",   country: "IT", currency: "EUR", retailer: "conad-it"     ,  sanityRange: { minMajor: 1, maxMajor: 5 } },
  { slug: "tomatoes_1kg",canonicalSize: 1000, unit: "g",   country: "IT", currency: "EUR", retailer: "conad-it"     ,  sanityRange: { minMajor: 1.2, maxMajor: 5 } },
  { slug: "potatoes_1kg",canonicalSize: 1000, unit: "g",   country: "IT", currency: "EUR", retailer: "conad-it"     ,  sanityRange: { minMajor: 0.8, maxMajor: 4 } },
  { slug: "olive_oil_1l",canonicalSize: 1000, unit: "ml",  country: "IT", currency: "EUR", retailer: "conad-it"     ,  sanityRange: { minMajor: 3, maxMajor: 18 } },
  { slug: "water_bottled_1500ml",canonicalSize: 1500, unit: "ml", country: "IT", currency: "EUR", retailer: "conad-it"     ,  sanityRange: { minMajor: 0.25, maxMajor: 2.5 } },
  { slug: "bananas_1kg", canonicalSize: 1000, unit: "g",   country: "IT", currency: "EUR", retailer: "conad-it"     ,  sanityRange: { minMajor: 1, maxMajor: 3.5 } },
  { slug: "apples_1kg",  canonicalSize: 1000, unit: "g",   country: "IT", currency: "EUR", retailer: "conad-it"     ,  sanityRange: { minMajor: 1.2, maxMajor: 5 } },
  { slug: "chicken_breast_1kg",canonicalSize: 1000, unit: "g", country: "IT", currency: "EUR", retailer: "conad-it"     ,  sanityRange: { minMajor: 5, maxMajor: 20 } },
  { slug: "beef_ground_1kg",canonicalSize: 1000, unit: "g", country: "IT", currency: "EUR", retailer: "conad-it"     ,  sanityRange: { minMajor: 7, maxMajor: 25 } },
  { slug: "cheese_local_500g",canonicalSize: 500, unit: "g", country: "IT", currency: "EUR", retailer: "conad-it"     ,  sanityRange: { minMajor: 3, maxMajor: 20 } },
  { slug: "beer_imported_500ml",canonicalSize: 500, unit: "ml", country: "IT", currency: "EUR", retailer: "conad-it"     ,  sanityRange: { minMajor: 0.8, maxMajor: 5 } },

  // TURKEY, Migros via migros.com.tr public JSON API.
  // Prices in TRY (Türk lirası). Sanity ranges sit wide because the
  // Turkish lira is on a fast inflation curve, so the band is sized
  // for both shelf prices today AND drift over a 6 to 12 month
  // window before the catalog is retuned. Beer is officially listed
  // as not-sold-online by Migros TR (alcohol licensing) so the slug
  // will surface as a clean miss on every cron until that changes.
  { slug: "bread_500g",  canonicalSize: 500,  unit: "g",   country: "TR", currency: "TRY", retailer: "migros-tr",     sanityRange: { minMajor: 5, maxMajor: 80 } },
  { slug: "milk_1l",     canonicalSize: 1000, unit: "ml",  country: "TR", currency: "TRY", retailer: "migros-tr",     sanityRange: { minMajor: 20, maxMajor: 100 } },
  { slug: "eggs_12",  canonicalSize: 12,   unit: "pcs", country: "TR", currency: "TRY", retailer: "migros-tr",     sanityRange: { minMajor: 50, maxMajor: 300 } },
  { slug: "butter_200g", canonicalSize: 200,  unit: "g",   country: "TR", currency: "TRY", retailer: "migros-tr",     sanityRange: { minMajor: 50, maxMajor: 300 } },
  { slug: "sugar_1kg",   canonicalSize: 1000, unit: "g",   country: "TR", currency: "TRY", retailer: "migros-tr",     sanityRange: { minMajor: 20, maxMajor: 100 } },
  { slug: "rice_1kg",    canonicalSize: 1000, unit: "g",   country: "TR", currency: "TRY", retailer: "migros-tr",     sanityRange: { minMajor: 40, maxMajor: 250 } },
  { slug: "tomatoes_1kg",canonicalSize: 1000, unit: "g",   country: "TR", currency: "TRY", retailer: "migros-tr",     sanityRange: { minMajor: 25, maxMajor: 200 } },
  { slug: "potatoes_1kg",canonicalSize: 1000, unit: "g",   country: "TR", currency: "TRY", retailer: "migros-tr",     sanityRange: { minMajor: 10, maxMajor: 80 } },
  { slug: "olive_oil_1l",canonicalSize: 1000, unit: "ml",  country: "TR", currency: "TRY", retailer: "migros-tr",     sanityRange: { minMajor: 150, maxMajor: 900 } },
  { slug: "water_bottled_1500ml",canonicalSize: 1500, unit: "ml", country: "TR", currency: "TRY", retailer: "migros-tr",     sanityRange: { minMajor: 3, maxMajor: 40 } },
  { slug: "bananas_1kg", canonicalSize: 1000, unit: "g",   country: "TR", currency: "TRY", retailer: "migros-tr",     sanityRange: { minMajor: 40, maxMajor: 200 } },
  { slug: "apples_1kg",  canonicalSize: 1000, unit: "g",   country: "TR", currency: "TRY", retailer: "migros-tr",     sanityRange: { minMajor: 30, maxMajor: 250 } },
  { slug: "chicken_breast_1kg",canonicalSize: 1000, unit: "g", country: "TR", currency: "TRY", retailer: "migros-tr",     sanityRange: { minMajor: 100, maxMajor: 600 } },
  { slug: "beef_ground_1kg",canonicalSize: 1000, unit: "g", country: "TR", currency: "TRY", retailer: "migros-tr",     sanityRange: { minMajor: 250, maxMajor: 1500 } },
  { slug: "cheese_local_500g",canonicalSize: 500, unit: "g", country: "TR", currency: "TRY", retailer: "migros-tr",     sanityRange: { minMajor: 80, maxMajor: 500 } },
  { slug: "beer_imported_500ml",canonicalSize: 500, unit: "ml", country: "TR", currency: "TRY", retailer: "migros-tr",     sanityRange: { minMajor: 30, maxMajor: 250 } },
];

export function targetsForRetailer(retailer: Retailer): ProductTarget[] {
  return PRODUCT_TARGETS.filter((t) => t.retailer === retailer);
}
