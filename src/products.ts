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
  | "auchan-pl"
  | "rewe-de"
  | "carrefour-fr"
  | "conad-it"
  | "migros-tr"
  | "disco-ar"
  | "wong-pe"
  | "olimpica-co"
  | "chedraui-mx";

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

export type CountryCode = "UA" | "GB" | "ES" | "PL" | "DE" | "FR" | "IT" | "TR" | "AR" | "PE" | "CO" | "MX";

export type CurrencyCode = "UAH" | "GBP" | "EUR" | "PLN" | "TRY" | "ARS" | "PEN" | "COP" | "MXN";

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

  // POLAND, Auchan via zakupy.auchan.pl SSR __INITIAL_STATE__
  // Ranges tuned against live Auchan prices (2026-05-28). Polish
  // staple grocery prices skew lower than expected: own-brand UHT
  // milk at 2.45 PLN, 1 kg sugar at 1.98 PLN, 1.5 L spring water at
  // ~1 PLN, 1 kg potatoes at 1.98 PLN — the previous floors based on
  // Biedronka public list prices were 20-50 percent too high.
  { slug: "bread_500g",  canonicalSize: 500,  unit: "g",   country: "PL", currency: "PLN", retailer: "auchan-pl",  sanityRange: { minMajor: 1.5, maxMajor: 15 } },
  { slug: "milk_1l",     canonicalSize: 1000, unit: "ml",  country: "PL", currency: "PLN", retailer: "auchan-pl",  sanityRange: { minMajor: 2, maxMajor: 10 } },
  { slug: "eggs_12",  canonicalSize: 12,   unit: "pcs", country: "PL", currency: "PLN", retailer: "auchan-pl",  sanityRange: { minMajor: 6, maxMajor: 24 } },
  { slug: "butter_200g", canonicalSize: 200,  unit: "g",   country: "PL", currency: "PLN", retailer: "auchan-pl",  sanityRange: { minMajor: 4, maxMajor: 15 } },
  { slug: "sugar_1kg",   canonicalSize: 1000, unit: "g",   country: "PL", currency: "PLN", retailer: "auchan-pl",  sanityRange: { minMajor: 1.5, maxMajor: 12 } },
  { slug: "rice_1kg",    canonicalSize: 1000, unit: "g",   country: "PL", currency: "PLN", retailer: "auchan-pl",  sanityRange: { minMajor: 3, maxMajor: 15 } },
  { slug: "tomatoes_1kg",canonicalSize: 1000, unit: "g",   country: "PL", currency: "PLN", retailer: "auchan-pl",  sanityRange: { minMajor: 4, maxMajor: 18 } },
  { slug: "potatoes_1kg",canonicalSize: 1000, unit: "g",   country: "PL", currency: "PLN", retailer: "auchan-pl",  sanityRange: { minMajor: 1.5, maxMajor: 10 } },
  { slug: "olive_oil_1l",canonicalSize: 1000, unit: "ml",  country: "PL", currency: "PLN", retailer: "auchan-pl",  sanityRange: { minMajor: 12, maxMajor: 60 } },
  { slug: "water_bottled_1500ml",canonicalSize: 1500, unit: "ml", country: "PL", currency: "PLN", retailer: "auchan-pl",  sanityRange: { minMajor: 0.5, maxMajor: 8 } },
  { slug: "bananas_1kg", canonicalSize: 1000, unit: "g",   country: "PL", currency: "PLN", retailer: "auchan-pl",  sanityRange: { minMajor: 3, maxMajor: 12 } },
  { slug: "apples_1kg",  canonicalSize: 1000, unit: "g",   country: "PL", currency: "PLN", retailer: "auchan-pl",  sanityRange: { minMajor: 2, maxMajor: 15 } },
  { slug: "chicken_breast_1kg",canonicalSize: 1000, unit: "g", country: "PL", currency: "PLN", retailer: "auchan-pl",  sanityRange: { minMajor: 15, maxMajor: 60 } },
  { slug: "beef_ground_1kg",canonicalSize: 1000, unit: "g", country: "PL", currency: "PLN", retailer: "auchan-pl",  sanityRange: { minMajor: 20, maxMajor: 90 } },
  { slug: "cheese_local_500g",canonicalSize: 500, unit: "g", country: "PL", currency: "PLN", retailer: "auchan-pl",  sanityRange: { minMajor: 8, maxMajor: 45 } },
  { slug: "beer_imported_500ml",canonicalSize: 500, unit: "ml", country: "PL", currency: "PLN", retailer: "auchan-pl",  sanityRange: { minMajor: 3, maxMajor: 20 } },

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
  { slug: "rice_1kg",    canonicalSize: 1000, unit: "g",   country: "TR", currency: "TRY", retailer: "migros-tr",     sanityRange: { minMajor: 30, maxMajor: 300 } },
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

  // Argentina via Disco (Cencosud, VTEX catalog API). Prices in ARS
  // whole pesos. Loose produce ("Por Kg") returns Price as the per-
  // kilo rate. Sanity ranges target post-2025 stabilised pricing
  // under the Milei administration; values that crater the floor or
  // rip the ceiling are flagged before they touch the chain.
  { slug: "bread_500g",  canonicalSize: 500,  unit: "g",   country: "AR", currency: "ARS", retailer: "disco-ar",      sanityRange: { minMajor: 1500, maxMajor: 8000 } },
  { slug: "milk_1l",     canonicalSize: 1000, unit: "ml",  country: "AR", currency: "ARS", retailer: "disco-ar",      sanityRange: { minMajor: 1000, maxMajor: 4500 } },
  { slug: "eggs_12",  canonicalSize: 12,   unit: "pcs", country: "AR", currency: "ARS", retailer: "disco-ar",      sanityRange: { minMajor: 2500, maxMajor: 9000 } },
  { slug: "butter_200g", canonicalSize: 200,  unit: "g",   country: "AR", currency: "ARS", retailer: "disco-ar",      sanityRange: { minMajor: 2500, maxMajor: 8000 } },
  { slug: "sugar_1kg",   canonicalSize: 1000, unit: "g",   country: "AR", currency: "ARS", retailer: "disco-ar",      sanityRange: { minMajor: 800, maxMajor: 4000 } },
  { slug: "rice_1kg",    canonicalSize: 1000, unit: "g",   country: "AR", currency: "ARS", retailer: "disco-ar",      sanityRange: { minMajor: 1500, maxMajor: 7000 } },
  { slug: "tomatoes_1kg",canonicalSize: 1000, unit: "g",   country: "AR", currency: "ARS", retailer: "disco-ar",      sanityRange: { minMajor: 1500, maxMajor: 8000 } },
  { slug: "potatoes_1kg",canonicalSize: 1000, unit: "g",   country: "AR", currency: "ARS", retailer: "disco-ar",      sanityRange: { minMajor: 800, maxMajor: 5000 } },
  { slug: "olive_oil_1l",canonicalSize: 1000, unit: "ml",  country: "AR", currency: "ARS", retailer: "disco-ar",      sanityRange: { minMajor: 10000, maxMajor: 50000 } },
  { slug: "water_bottled_1500ml",canonicalSize: 1500, unit: "ml", country: "AR", currency: "ARS", retailer: "disco-ar",      sanityRange: { minMajor: 800, maxMajor: 5000 } },
  { slug: "bananas_1kg", canonicalSize: 1000, unit: "g",   country: "AR", currency: "ARS", retailer: "disco-ar",      sanityRange: { minMajor: 1000, maxMajor: 4500 } },
  { slug: "apples_1kg",  canonicalSize: 1000, unit: "g",   country: "AR", currency: "ARS", retailer: "disco-ar",      sanityRange: { minMajor: 1500, maxMajor: 8000 } },
  { slug: "chicken_breast_1kg",canonicalSize: 1000, unit: "g", country: "AR", currency: "ARS", retailer: "disco-ar",      sanityRange: { minMajor: 3000, maxMajor: 25000 } },
  { slug: "beef_ground_1kg",canonicalSize: 1000, unit: "g", country: "AR", currency: "ARS", retailer: "disco-ar",      sanityRange: { minMajor: 4000, maxMajor: 30000 } },
  { slug: "cheese_local_500g",canonicalSize: 500, unit: "g", country: "AR", currency: "ARS", retailer: "disco-ar",      sanityRange: { minMajor: 3000, maxMajor: 25000 } },
  { slug: "beer_imported_500ml",canonicalSize: 500, unit: "ml", country: "AR", currency: "ARS", retailer: "disco-ar",      sanityRange: { minMajor: 1000, maxMajor: 8000 } },

  // Peru via Wong (Cencosud, VTEX catalog API). Prices in PEN
  // (Peruvian Sol) whole units, the wire format includes decimals
  // (e.g. 4.50 PEN). Sanity ranges target post-COVID Lima retail
  // basket rates; loose produce is per-kg under measurementUnit
  // "kg" with fractional unitMultiplier (same as Disco AR).
  { slug: "bread_500g",  canonicalSize: 500,  unit: "g",   country: "PE", currency: "PEN", retailer: "wong-pe",       sanityRange: { minMajor: 5, maxMajor: 30 } },
  { slug: "milk_1l",     canonicalSize: 1000, unit: "ml",  country: "PE", currency: "PEN", retailer: "wong-pe",       sanityRange: { minMajor: 3, maxMajor: 12 } },
  { slug: "eggs_12",  canonicalSize: 12,   unit: "pcs", country: "PE", currency: "PEN", retailer: "wong-pe",       sanityRange: { minMajor: 8, maxMajor: 30 } },
  { slug: "butter_200g", canonicalSize: 200,  unit: "g",   country: "PE", currency: "PEN", retailer: "wong-pe",       sanityRange: { minMajor: 8, maxMajor: 40 } },
  { slug: "sugar_1kg",   canonicalSize: 1000, unit: "g",   country: "PE", currency: "PEN", retailer: "wong-pe",       sanityRange: { minMajor: 2, maxMajor: 10 } },
  { slug: "rice_1kg",    canonicalSize: 1000, unit: "g",   country: "PE", currency: "PEN", retailer: "wong-pe",       sanityRange: { minMajor: 2, maxMajor: 15 } },
  { slug: "tomatoes_1kg",canonicalSize: 1000, unit: "g",   country: "PE", currency: "PEN", retailer: "wong-pe",       sanityRange: { minMajor: 3, maxMajor: 20 } },
  { slug: "potatoes_1kg",canonicalSize: 1000, unit: "g",   country: "PE", currency: "PEN", retailer: "wong-pe",       sanityRange: { minMajor: 1, maxMajor: 15 } },
  { slug: "olive_oil_1l",canonicalSize: 1000, unit: "ml",  country: "PE", currency: "PEN", retailer: "wong-pe",       sanityRange: { minMajor: 30, maxMajor: 250 } },
  { slug: "water_bottled_1500ml",canonicalSize: 1500, unit: "ml", country: "PE", currency: "PEN", retailer: "wong-pe",       sanityRange: { minMajor: 2, maxMajor: 20 } },
  { slug: "bananas_1kg", canonicalSize: 1000, unit: "g",   country: "PE", currency: "PEN", retailer: "wong-pe",       sanityRange: { minMajor: 2, maxMajor: 12 } },
  { slug: "apples_1kg",  canonicalSize: 1000, unit: "g",   country: "PE", currency: "PEN", retailer: "wong-pe",       sanityRange: { minMajor: 3, maxMajor: 25 } },
  { slug: "chicken_breast_1kg",canonicalSize: 1000, unit: "g", country: "PE", currency: "PEN", retailer: "wong-pe",       sanityRange: { minMajor: 10, maxMajor: 60 } },
  { slug: "beef_ground_1kg",canonicalSize: 1000, unit: "g", country: "PE", currency: "PEN", retailer: "wong-pe",       sanityRange: { minMajor: 15, maxMajor: 80 } },
  { slug: "cheese_local_500g",canonicalSize: 500, unit: "g", country: "PE", currency: "PEN", retailer: "wong-pe",       sanityRange: { minMajor: 10, maxMajor: 80 } },
  { slug: "beer_imported_500ml",canonicalSize: 500, unit: "ml", country: "PE", currency: "PEN", retailer: "wong-pe",       sanityRange: { minMajor: 4, maxMajor: 30 } },

  // Colombia via Olimpica (VTEX catalog API). Prices in COP whole
  // pesos. Olimpica is a department store, every product carries
  // measurementUnit "un" (no kg-measurement class), so loose
  // produce is tagged with "X Kg" or "Kg" in the title; the parser
  // treats that as a 1000 g pack (mirrors Migros TR's bare-Kg
  // branch). Sanity ranges sized for Bogota retail in COP.
  { slug: "bread_500g",  canonicalSize: 500,  unit: "g",   country: "CO", currency: "COP", retailer: "olimpica-co",   sanityRange: { minMajor: 4000, maxMajor: 20000 } },
  { slug: "milk_1l",     canonicalSize: 1000, unit: "ml",  country: "CO", currency: "COP", retailer: "olimpica-co",   sanityRange: { minMajor: 2500, maxMajor: 10000 } },
  { slug: "eggs_12",  canonicalSize: 12,   unit: "pcs", country: "CO", currency: "COP", retailer: "olimpica-co",   sanityRange: { minMajor: 4000, maxMajor: 18000 } },
  { slug: "butter_200g", canonicalSize: 200,  unit: "g",   country: "CO", currency: "COP", retailer: "olimpica-co",   sanityRange: { minMajor: 6000, maxMajor: 25000 } },
  { slug: "sugar_1kg",   canonicalSize: 1000, unit: "g",   country: "CO", currency: "COP", retailer: "olimpica-co",   sanityRange: { minMajor: 2500, maxMajor: 12000 } },
  { slug: "rice_1kg",    canonicalSize: 1000, unit: "g",   country: "CO", currency: "COP", retailer: "olimpica-co",   sanityRange: { minMajor: 2000, maxMajor: 12000 } },
  { slug: "tomatoes_1kg",canonicalSize: 1000, unit: "g",   country: "CO", currency: "COP", retailer: "olimpica-co",   sanityRange: { minMajor: 3500, maxMajor: 20000 } },
  { slug: "potatoes_1kg",canonicalSize: 1000, unit: "g",   country: "CO", currency: "COP", retailer: "olimpica-co",   sanityRange: { minMajor: 1500, maxMajor: 12000 } },
  { slug: "olive_oil_1l",canonicalSize: 1000, unit: "ml",  country: "CO", currency: "COP", retailer: "olimpica-co",   sanityRange: { minMajor: 25000, maxMajor: 150000 } },
  { slug: "water_bottled_1500ml",canonicalSize: 1500, unit: "ml", country: "CO", currency: "COP", retailer: "olimpica-co",   sanityRange: { minMajor: 1500, maxMajor: 15000 } },
  { slug: "bananas_1kg", canonicalSize: 1000, unit: "g",   country: "CO", currency: "COP", retailer: "olimpica-co",   sanityRange: { minMajor: 1500, maxMajor: 8000 } },
  { slug: "apples_1kg",  canonicalSize: 1000, unit: "g",   country: "CO", currency: "COP", retailer: "olimpica-co",   sanityRange: { minMajor: 5000, maxMajor: 25000 } },
  { slug: "chicken_breast_1kg",canonicalSize: 1000, unit: "g", country: "CO", currency: "COP", retailer: "olimpica-co",   sanityRange: { minMajor: 12000, maxMajor: 45000 } },
  { slug: "beef_ground_1kg",canonicalSize: 1000, unit: "g", country: "CO", currency: "COP", retailer: "olimpica-co",   sanityRange: { minMajor: 12000, maxMajor: 50000 } },
  { slug: "cheese_local_500g",canonicalSize: 500, unit: "g", country: "CO", currency: "COP", retailer: "olimpica-co",   sanityRange: { minMajor: 6000, maxMajor: 30000 } },
  { slug: "beer_imported_500ml",canonicalSize: 500, unit: "ml", country: "CO", currency: "COP", retailer: "olimpica-co",   sanityRange: { minMajor: 2500, maxMajor: 15000 } },

  // Mexico via Chedraui (Mexican retailer running on VTEX). Prices
  // in MXN whole pesos with decimals (USD 1 ~ 17 MXN). Loose produce
  // uses measurementUnit "kg" with fractional unitMultiplier
  // (same as Disco AR / Wong PE). Mexico-specific terminology in
  // the picker: "mantequilla" for butter (not manteca = lard),
  // "plátano" for banana, "frijoles" for beans (not used).
  { slug: "bread_500g",  canonicalSize: 500,  unit: "g",   country: "MX", currency: "MXN", retailer: "chedraui-mx",   sanityRange: { minMajor: 15, maxMajor: 80 } },
  { slug: "milk_1l",     canonicalSize: 1000, unit: "ml",  country: "MX", currency: "MXN", retailer: "chedraui-mx",   sanityRange: { minMajor: 20, maxMajor: 60 } },
  { slug: "eggs_12",  canonicalSize: 12,   unit: "pcs", country: "MX", currency: "MXN", retailer: "chedraui-mx",   sanityRange: { minMajor: 20, maxMajor: 80 } },
  { slug: "butter_200g", canonicalSize: 200,  unit: "g",   country: "MX", currency: "MXN", retailer: "chedraui-mx",   sanityRange: { minMajor: 20, maxMajor: 100 } },
  { slug: "sugar_1kg",   canonicalSize: 1000, unit: "g",   country: "MX", currency: "MXN", retailer: "chedraui-mx",   sanityRange: { minMajor: 15, maxMajor: 60 } },
  { slug: "rice_1kg",    canonicalSize: 1000, unit: "g",   country: "MX", currency: "MXN", retailer: "chedraui-mx",   sanityRange: { minMajor: 15, maxMajor: 80 } },
  { slug: "tomatoes_1kg",canonicalSize: 1000, unit: "g",   country: "MX", currency: "MXN", retailer: "chedraui-mx",   sanityRange: { minMajor: 20, maxMajor: 120 } },
  { slug: "potatoes_1kg",canonicalSize: 1000, unit: "g",   country: "MX", currency: "MXN", retailer: "chedraui-mx",   sanityRange: { minMajor: 10, maxMajor: 80 } },
  { slug: "olive_oil_1l",canonicalSize: 1000, unit: "ml",  country: "MX", currency: "MXN", retailer: "chedraui-mx",   sanityRange: { minMajor: 100, maxMajor: 800 } },
  { slug: "water_bottled_1500ml",canonicalSize: 1500, unit: "ml", country: "MX", currency: "MXN", retailer: "chedraui-mx",   sanityRange: { minMajor: 8, maxMajor: 50 } },
  { slug: "bananas_1kg", canonicalSize: 1000, unit: "g",   country: "MX", currency: "MXN", retailer: "chedraui-mx",   sanityRange: { minMajor: 10, maxMajor: 60 } },
  { slug: "apples_1kg",  canonicalSize: 1000, unit: "g",   country: "MX", currency: "MXN", retailer: "chedraui-mx",   sanityRange: { minMajor: 25, maxMajor: 150 } },
  { slug: "chicken_breast_1kg",canonicalSize: 1000, unit: "g", country: "MX", currency: "MXN", retailer: "chedraui-mx",   sanityRange: { minMajor: 80, maxMajor: 300 } },
  { slug: "beef_ground_1kg",canonicalSize: 1000, unit: "g", country: "MX", currency: "MXN", retailer: "chedraui-mx",   sanityRange: { minMajor: 100, maxMajor: 500 } },
  { slug: "cheese_local_500g",canonicalSize: 500, unit: "g", country: "MX", currency: "MXN", retailer: "chedraui-mx",   sanityRange: { minMajor: 40, maxMajor: 250 } },
  { slug: "beer_imported_500ml",canonicalSize: 500, unit: "ml", country: "MX", currency: "MXN", retailer: "chedraui-mx",   sanityRange: { minMajor: 20, maxMajor: 100 } },
];

export function targetsForRetailer(retailer: Retailer): ProductTarget[] {
  return PRODUCT_TARGETS.filter((t) => t.retailer === retailer);
}
