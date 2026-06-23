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
  | "tavriav-ua"
  | "auchan-ua"
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
  | "chedraui-mx"
  | "auchan-ro"
  | "rimi-ee"
  | "rimi-lv"
  | "rimi-lt"
  | "continente-pt"
  | "carulla-co"
  | "masxmenos-cr"
  | "plaza-vea-pe"
  | "mambo-br"
  | "exito-co"
  | "zona-sul-br"
  | "vea-ar"
  | "metro-pe"
  | "hortifruti-br"
  | "dia-ar"
  | "eldorado-uy";

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

export type CountryCode = "UA" | "GB" | "ES" | "PL" | "DE" | "FR" | "IT" | "TR" | "AR" | "PE" | "CO" | "MX" | "RO" | "EE" | "LV" | "LT" | "PT" | "CR" | "BR" | "UY";

export type CurrencyCode = "UAH" | "GBP" | "EUR" | "PLN" | "TRY" | "ARS" | "PEN" | "COP" | "MXN" | "RON" | "CRC" | "BRL" | "UYU";

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
  { slug: "bread_500g",  canonicalSize: 500,  unit: "g",   country: "UA", currency: "UAH", retailer: "auchan-ua",      sanityRange: { minMajor: 15, maxMajor: 90 } },
  { slug: "milk_1l",     canonicalSize: 1000, unit: "ml",  country: "UA", currency: "UAH", retailer: "auchan-ua",      sanityRange: { minMajor: 30, maxMajor: 90 } },
  { slug: "eggs_12",  canonicalSize: 12,   unit: "pcs", country: "UA", currency: "UAH", retailer: "auchan-ua",      sanityRange: { minMajor: 48, maxMajor: 180 } },
  { slug: "butter_200g", canonicalSize: 200,  unit: "g",   country: "UA", currency: "UAH", retailer: "auchan-ua",      sanityRange: { minMajor: 50, maxMajor: 200 } },
  { slug: "sugar_1kg",   canonicalSize: 1000, unit: "g",   country: "UA", currency: "UAH", retailer: "auchan-ua",      sanityRange: { minMajor: 20, maxMajor: 100 } },
  { slug: "rice_1kg",    canonicalSize: 1000, unit: "g",   country: "UA", currency: "UAH", retailer: "auchan-ua",      sanityRange: { minMajor: 40, maxMajor: 200 } },
  { slug: "tomatoes_1kg",canonicalSize: 1000, unit: "g",   country: "UA", currency: "UAH", retailer: "auchan-ua",      sanityRange: { minMajor: 30, maxMajor: 250 } },
  { slug: "potatoes_1kg",canonicalSize: 1000, unit: "g",   country: "UA", currency: "UAH", retailer: "auchan-ua",      sanityRange: { minMajor: 15, maxMajor: 80 } },
  { slug: "olive_oil_1l",canonicalSize: 1000, unit: "ml",  country: "UA", currency: "UAH", retailer: "auchan-ua",      sanityRange: { minMajor: 150, maxMajor: 900 } },
  { slug: "water_bottled_1500ml",canonicalSize: 1500, unit: "ml", country: "UA", currency: "UAH", retailer: "auchan-ua",      sanityRange: { minMajor: 15, maxMajor: 80 } },
  { slug: "bananas_1kg", canonicalSize: 1000, unit: "g",   country: "UA", currency: "UAH", retailer: "auchan-ua",      sanityRange: { minMajor: 30, maxMajor: 150 } },
  { slug: "apples_1kg",  canonicalSize: 1000, unit: "g",   country: "UA", currency: "UAH", retailer: "auchan-ua",      sanityRange: { minMajor: 20, maxMajor: 200 } },
  { slug: "chicken_breast_1kg",canonicalSize: 1000, unit: "g", country: "UA", currency: "UAH", retailer: "auchan-ua",      sanityRange: { minMajor: 100, maxMajor: 500 } },
  { slug: "beef_ground_1kg",canonicalSize: 1000, unit: "g", country: "UA", currency: "UAH", retailer: "auchan-ua",      sanityRange: { minMajor: 150, maxMajor: 700 } },
  { slug: "cheese_local_500g",canonicalSize: 500, unit: "g", country: "UA", currency: "UAH", retailer: "auchan-ua",      sanityRange: { minMajor: 100, maxMajor: 500 } },
  { slug: "beer_imported_500ml",canonicalSize: 500, unit: "ml", country: "UA", currency: "UAH", retailer: "auchan-ua",      sanityRange: { minMajor: 30, maxMajor: 200 } },
  { slug: "bread_500g",  canonicalSize: 500,  unit: "g",   country: "UA", currency: "UAH", retailer: "tavriav-ua",      sanityRange: { minMajor: 15, maxMajor: 90 } },
  { slug: "milk_1l",     canonicalSize: 1000, unit: "ml",  country: "UA", currency: "UAH", retailer: "tavriav-ua",      sanityRange: { minMajor: 30, maxMajor: 90 } },
  { slug: "eggs_12",  canonicalSize: 12,   unit: "pcs", country: "UA", currency: "UAH", retailer: "tavriav-ua",      sanityRange: { minMajor: 48, maxMajor: 180 } },
  { slug: "butter_200g", canonicalSize: 200,  unit: "g",   country: "UA", currency: "UAH", retailer: "tavriav-ua",      sanityRange: { minMajor: 50, maxMajor: 200 } },
  { slug: "sugar_1kg",   canonicalSize: 1000, unit: "g",   country: "UA", currency: "UAH", retailer: "tavriav-ua",      sanityRange: { minMajor: 20, maxMajor: 100 } },
  { slug: "rice_1kg",    canonicalSize: 1000, unit: "g",   country: "UA", currency: "UAH", retailer: "tavriav-ua",      sanityRange: { minMajor: 40, maxMajor: 200 } },
  { slug: "tomatoes_1kg",canonicalSize: 1000, unit: "g",   country: "UA", currency: "UAH", retailer: "tavriav-ua",      sanityRange: { minMajor: 30, maxMajor: 250 } },
  { slug: "potatoes_1kg",canonicalSize: 1000, unit: "g",   country: "UA", currency: "UAH", retailer: "tavriav-ua",      sanityRange: { minMajor: 15, maxMajor: 80 } },
  { slug: "olive_oil_1l",canonicalSize: 1000, unit: "ml",  country: "UA", currency: "UAH", retailer: "tavriav-ua",      sanityRange: { minMajor: 150, maxMajor: 900 } },
  { slug: "water_bottled_1500ml",canonicalSize: 1500, unit: "ml", country: "UA", currency: "UAH", retailer: "tavriav-ua",      sanityRange: { minMajor: 15, maxMajor: 80 } },
  { slug: "bananas_1kg", canonicalSize: 1000, unit: "g",   country: "UA", currency: "UAH", retailer: "tavriav-ua",      sanityRange: { minMajor: 30, maxMajor: 150 } },
  { slug: "apples_1kg",  canonicalSize: 1000, unit: "g",   country: "UA", currency: "UAH", retailer: "tavriav-ua",      sanityRange: { minMajor: 20, maxMajor: 200 } },
  { slug: "chicken_breast_1kg",canonicalSize: 1000, unit: "g", country: "UA", currency: "UAH", retailer: "tavriav-ua",      sanityRange: { minMajor: 100, maxMajor: 500 } },
  { slug: "beef_ground_1kg",canonicalSize: 1000, unit: "g", country: "UA", currency: "UAH", retailer: "tavriav-ua",      sanityRange: { minMajor: 150, maxMajor: 700 } },
  { slug: "cheese_local_500g",canonicalSize: 500, unit: "g", country: "UA", currency: "UAH", retailer: "tavriav-ua",      sanityRange: { minMajor: 100, maxMajor: 500 } },
  { slug: "beer_imported_500ml",canonicalSize: 500, unit: "ml", country: "UA", currency: "UAH", retailer: "tavriav-ua",      sanityRange: { minMajor: 30, maxMajor: 200 } },

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

  // Argentina 2nd retailer via Vea (Cencosud's tier-2 VTEX chain,
  // sister to Disco AR). Same currency, same VTEX engine, so the
  // Disco adapter library carries over. Sanity ranges mirror Disco
  // AR so the cross-check fails loudly if Vea drifts independently.
  { slug: "bread_500g",  canonicalSize: 500,  unit: "g",   country: "AR", currency: "ARS", retailer: "vea-ar",        sanityRange: { minMajor: 1500, maxMajor: 8000 } },
  { slug: "milk_1l",     canonicalSize: 1000, unit: "ml",  country: "AR", currency: "ARS", retailer: "vea-ar",        sanityRange: { minMajor: 1000, maxMajor: 4500 } },
  { slug: "eggs_12",  canonicalSize: 12,   unit: "pcs", country: "AR", currency: "ARS", retailer: "vea-ar",        sanityRange: { minMajor: 2500, maxMajor: 9000 } },
  { slug: "butter_200g", canonicalSize: 200,  unit: "g",   country: "AR", currency: "ARS", retailer: "vea-ar",        sanityRange: { minMajor: 2500, maxMajor: 8000 } },
  { slug: "sugar_1kg",   canonicalSize: 1000, unit: "g",   country: "AR", currency: "ARS", retailer: "vea-ar",        sanityRange: { minMajor: 800, maxMajor: 4000 } },
  { slug: "rice_1kg",    canonicalSize: 1000, unit: "g",   country: "AR", currency: "ARS", retailer: "vea-ar",        sanityRange: { minMajor: 1500, maxMajor: 7000 } },
  { slug: "tomatoes_1kg",canonicalSize: 1000, unit: "g",   country: "AR", currency: "ARS", retailer: "vea-ar",        sanityRange: { minMajor: 1500, maxMajor: 8000 } },
  { slug: "potatoes_1kg",canonicalSize: 1000, unit: "g",   country: "AR", currency: "ARS", retailer: "vea-ar",        sanityRange: { minMajor: 800, maxMajor: 5000 } },
  { slug: "olive_oil_1l",canonicalSize: 1000, unit: "ml",  country: "AR", currency: "ARS", retailer: "vea-ar",        sanityRange: { minMajor: 10000, maxMajor: 50000 } },
  { slug: "water_bottled_1500ml",canonicalSize: 1500, unit: "ml", country: "AR", currency: "ARS", retailer: "vea-ar",        sanityRange: { minMajor: 800, maxMajor: 5000 } },
  { slug: "bananas_1kg", canonicalSize: 1000, unit: "g",   country: "AR", currency: "ARS", retailer: "vea-ar",        sanityRange: { minMajor: 1000, maxMajor: 4500 } },
  { slug: "apples_1kg",  canonicalSize: 1000, unit: "g",   country: "AR", currency: "ARS", retailer: "vea-ar",        sanityRange: { minMajor: 1500, maxMajor: 8000 } },
  { slug: "chicken_breast_1kg",canonicalSize: 1000, unit: "g", country: "AR", currency: "ARS", retailer: "vea-ar",        sanityRange: { minMajor: 3000, maxMajor: 25000 } },
  { slug: "beef_ground_1kg",canonicalSize: 1000, unit: "g", country: "AR", currency: "ARS", retailer: "vea-ar",        sanityRange: { minMajor: 4000, maxMajor: 30000 } },
  { slug: "cheese_local_500g",canonicalSize: 500, unit: "g", country: "AR", currency: "ARS", retailer: "vea-ar",        sanityRange: { minMajor: 3000, maxMajor: 25000 } },
  { slug: "beer_imported_500ml",canonicalSize: 500, unit: "ml", country: "AR", currency: "ARS", retailer: "vea-ar",        sanityRange: { minMajor: 1000, maxMajor: 8000 } },

  // Argentina 3rd retailer via Dia (Spanish discount chain, not part
  // of Cencosud's Disco/Vea group). Same VTEX engine, same currency.
  // With Disco + Vea + Dia we get true AR triangulation across two
  // ownership groups (Cencosud x Distribuidora Internacional de
  // Alimentacion). Sanity ranges nudged lower because Dia targets
  // the discount tier (typically 10-15% below Disco shelf prices).
  { slug: "bread_500g",  canonicalSize: 500,  unit: "g",   country: "AR", currency: "ARS", retailer: "dia-ar",        sanityRange: { minMajor: 1200, maxMajor: 7000 } },
  { slug: "milk_1l",     canonicalSize: 1000, unit: "ml",  country: "AR", currency: "ARS", retailer: "dia-ar",        sanityRange: { minMajor: 900, maxMajor: 4000 } },
  { slug: "eggs_12",  canonicalSize: 12,   unit: "pcs", country: "AR", currency: "ARS", retailer: "dia-ar",        sanityRange: { minMajor: 2000, maxMajor: 8000 } },
  { slug: "butter_200g", canonicalSize: 200,  unit: "g",   country: "AR", currency: "ARS", retailer: "dia-ar",        sanityRange: { minMajor: 2000, maxMajor: 7000 } },
  { slug: "sugar_1kg",   canonicalSize: 1000, unit: "g",   country: "AR", currency: "ARS", retailer: "dia-ar",        sanityRange: { minMajor: 700, maxMajor: 3500 } },
  { slug: "rice_1kg",    canonicalSize: 1000, unit: "g",   country: "AR", currency: "ARS", retailer: "dia-ar",        sanityRange: { minMajor: 1200, maxMajor: 6000 } },
  { slug: "tomatoes_1kg",canonicalSize: 1000, unit: "g",   country: "AR", currency: "ARS", retailer: "dia-ar",        sanityRange: { minMajor: 1200, maxMajor: 7000 } },
  { slug: "potatoes_1kg",canonicalSize: 1000, unit: "g",   country: "AR", currency: "ARS", retailer: "dia-ar",        sanityRange: { minMajor: 700, maxMajor: 4500 } },
  { slug: "olive_oil_1l",canonicalSize: 1000, unit: "ml",  country: "AR", currency: "ARS", retailer: "dia-ar",        sanityRange: { minMajor: 8000, maxMajor: 45000 } },
  { slug: "water_bottled_1500ml",canonicalSize: 1500, unit: "ml", country: "AR", currency: "ARS", retailer: "dia-ar",        sanityRange: { minMajor: 700, maxMajor: 4500 } },
  { slug: "bananas_1kg", canonicalSize: 1000, unit: "g",   country: "AR", currency: "ARS", retailer: "dia-ar",        sanityRange: { minMajor: 800, maxMajor: 4000 } },
  { slug: "apples_1kg",  canonicalSize: 1000, unit: "g",   country: "AR", currency: "ARS", retailer: "dia-ar",        sanityRange: { minMajor: 1200, maxMajor: 7000 } },
  { slug: "chicken_breast_1kg",canonicalSize: 1000, unit: "g", country: "AR", currency: "ARS", retailer: "dia-ar",        sanityRange: { minMajor: 2500, maxMajor: 22000 } },
  { slug: "beef_ground_1kg",canonicalSize: 1000, unit: "g", country: "AR", currency: "ARS", retailer: "dia-ar",        sanityRange: { minMajor: 3500, maxMajor: 28000 } },
  { slug: "cheese_local_500g",canonicalSize: 500, unit: "g", country: "AR", currency: "ARS", retailer: "dia-ar",        sanityRange: { minMajor: 2500, maxMajor: 22000 } },
  { slug: "beer_imported_500ml",canonicalSize: 500, unit: "ml", country: "AR", currency: "ARS", retailer: "dia-ar",        sanityRange: { minMajor: 800, maxMajor: 7000 } },

  // Uruguay via El Dorado (VTEX catalog API). Prices in UYU (Uruguayan
  // Peso) whole units with up to two decimals. Sanity ranges target
  // Montevideo retail basket. Conaprole dominates dairy; local brands
  // for beer (Pilsen, Patricia, Norteña) instead of Heineken.
  { slug: "bread_500g",  canonicalSize: 500,  unit: "g",   country: "UY", currency: "UYU", retailer: "eldorado-uy",   sanityRange: { minMajor: 60, maxMajor: 300 } },
  { slug: "milk_1l",     canonicalSize: 1000, unit: "ml",  country: "UY", currency: "UYU", retailer: "eldorado-uy",   sanityRange: { minMajor: 40, maxMajor: 150 } },
  { slug: "eggs_12",  canonicalSize: 12,   unit: "pcs", country: "UY", currency: "UYU", retailer: "eldorado-uy",   sanityRange: { minMajor: 100, maxMajor: 400 } },
  { slug: "butter_200g", canonicalSize: 200,  unit: "g",   country: "UY", currency: "UYU", retailer: "eldorado-uy",   sanityRange: { minMajor: 100, maxMajor: 400 } },
  { slug: "sugar_1kg",   canonicalSize: 1000, unit: "g",   country: "UY", currency: "UYU", retailer: "eldorado-uy",   sanityRange: { minMajor: 50, maxMajor: 200 } },
  { slug: "rice_1kg",    canonicalSize: 1000, unit: "g",   country: "UY", currency: "UYU", retailer: "eldorado-uy",   sanityRange: { minMajor: 60, maxMajor: 250 } },
  { slug: "tomatoes_1kg",canonicalSize: 1000, unit: "g",   country: "UY", currency: "UYU", retailer: "eldorado-uy",   sanityRange: { minMajor: 60, maxMajor: 350 } },
  { slug: "potatoes_1kg",canonicalSize: 1000, unit: "g",   country: "UY", currency: "UYU", retailer: "eldorado-uy",   sanityRange: { minMajor: 30, maxMajor: 200 } },
  { slug: "olive_oil_1l",canonicalSize: 1000, unit: "ml",  country: "UY", currency: "UYU", retailer: "eldorado-uy",   sanityRange: { minMajor: 400, maxMajor: 2500 } },
  { slug: "water_bottled_1500ml",canonicalSize: 1500, unit: "ml", country: "UY", currency: "UYU", retailer: "eldorado-uy",   sanityRange: { minMajor: 30, maxMajor: 200 } },
  { slug: "bananas_1kg", canonicalSize: 1000, unit: "g",   country: "UY", currency: "UYU", retailer: "eldorado-uy",   sanityRange: { minMajor: 40, maxMajor: 200 } },
  { slug: "apples_1kg",  canonicalSize: 1000, unit: "g",   country: "UY", currency: "UYU", retailer: "eldorado-uy",   sanityRange: { minMajor: 60, maxMajor: 300 } },
  { slug: "chicken_breast_1kg",canonicalSize: 1000, unit: "g", country: "UY", currency: "UYU", retailer: "eldorado-uy",   sanityRange: { minMajor: 150, maxMajor: 800 } },
  { slug: "beef_ground_1kg",canonicalSize: 1000, unit: "g", country: "UY", currency: "UYU", retailer: "eldorado-uy",   sanityRange: { minMajor: 200, maxMajor: 1200 } },
  { slug: "cheese_local_500g",canonicalSize: 500, unit: "g", country: "UY", currency: "UYU", retailer: "eldorado-uy",   sanityRange: { minMajor: 150, maxMajor: 1000 } },
  { slug: "beer_imported_500ml",canonicalSize: 500, unit: "ml", country: "UY", currency: "UYU", retailer: "eldorado-uy",   sanityRange: { minMajor: 50, maxMajor: 400 } },

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

  // Peru 2nd retailer via Plaza Vea (large VTEX supermarket chain).
  // Same currency, same canonical sizes, same VTEX adapter as Wong,
  // so Plaza Vea unlocks a cross-check signal per PE slug. Sanity
  // ranges mirror wong-pe.
  { slug: "bread_500g",  canonicalSize: 500,  unit: "g",   country: "PE", currency: "PEN", retailer: "plaza-vea-pe",  sanityRange: { minMajor: 5, maxMajor: 30 } },
  { slug: "milk_1l",     canonicalSize: 1000, unit: "ml",  country: "PE", currency: "PEN", retailer: "plaza-vea-pe",  sanityRange: { minMajor: 3, maxMajor: 12 } },
  { slug: "eggs_12",  canonicalSize: 12,   unit: "pcs", country: "PE", currency: "PEN", retailer: "plaza-vea-pe",  sanityRange: { minMajor: 8, maxMajor: 30 } },
  { slug: "butter_200g", canonicalSize: 200,  unit: "g",   country: "PE", currency: "PEN", retailer: "plaza-vea-pe",  sanityRange: { minMajor: 8, maxMajor: 40 } },
  { slug: "sugar_1kg",   canonicalSize: 1000, unit: "g",   country: "PE", currency: "PEN", retailer: "plaza-vea-pe",  sanityRange: { minMajor: 2, maxMajor: 10 } },
  { slug: "rice_1kg",    canonicalSize: 1000, unit: "g",   country: "PE", currency: "PEN", retailer: "plaza-vea-pe",  sanityRange: { minMajor: 2, maxMajor: 15 } },
  { slug: "tomatoes_1kg",canonicalSize: 1000, unit: "g",   country: "PE", currency: "PEN", retailer: "plaza-vea-pe",  sanityRange: { minMajor: 3, maxMajor: 20 } },
  { slug: "potatoes_1kg",canonicalSize: 1000, unit: "g",   country: "PE", currency: "PEN", retailer: "plaza-vea-pe",  sanityRange: { minMajor: 1, maxMajor: 15 } },
  { slug: "olive_oil_1l",canonicalSize: 1000, unit: "ml",  country: "PE", currency: "PEN", retailer: "plaza-vea-pe",  sanityRange: { minMajor: 30, maxMajor: 250 } },
  { slug: "water_bottled_1500ml",canonicalSize: 1500, unit: "ml", country: "PE", currency: "PEN", retailer: "plaza-vea-pe",  sanityRange: { minMajor: 2, maxMajor: 20 } },
  { slug: "bananas_1kg", canonicalSize: 1000, unit: "g",   country: "PE", currency: "PEN", retailer: "plaza-vea-pe",  sanityRange: { minMajor: 2, maxMajor: 12 } },
  { slug: "apples_1kg",  canonicalSize: 1000, unit: "g",   country: "PE", currency: "PEN", retailer: "plaza-vea-pe",  sanityRange: { minMajor: 3, maxMajor: 25 } },
  { slug: "chicken_breast_1kg",canonicalSize: 1000, unit: "g", country: "PE", currency: "PEN", retailer: "plaza-vea-pe",  sanityRange: { minMajor: 10, maxMajor: 60 } },
  { slug: "beef_ground_1kg",canonicalSize: 1000, unit: "g", country: "PE", currency: "PEN", retailer: "plaza-vea-pe",  sanityRange: { minMajor: 15, maxMajor: 80 } },
  { slug: "cheese_local_500g",canonicalSize: 500, unit: "g", country: "PE", currency: "PEN", retailer: "plaza-vea-pe",  sanityRange: { minMajor: 10, maxMajor: 80 } },
  { slug: "beer_imported_500ml",canonicalSize: 500, unit: "ml", country: "PE", currency: "PEN", retailer: "plaza-vea-pe",  sanityRange: { minMajor: 4, maxMajor: 30 } },

  // Peru 3rd retailer via Metro PE (Cencosud's cash-and-carry banner,
  // sister to Wong). Same currency, same VTEX engine, so the Wong
  // adapter library carries over. With Wong + Plaza Vea + Metro we
  // get true triangulation for PE (3 independent retailers, two
  // ownership groups: Cencosud x Intercorp).
  { slug: "bread_500g",  canonicalSize: 500,  unit: "g",   country: "PE", currency: "PEN", retailer: "metro-pe",       sanityRange: { minMajor: 5, maxMajor: 30 } },
  { slug: "milk_1l",     canonicalSize: 1000, unit: "ml",  country: "PE", currency: "PEN", retailer: "metro-pe",       sanityRange: { minMajor: 3, maxMajor: 12 } },
  { slug: "eggs_12",  canonicalSize: 12,   unit: "pcs", country: "PE", currency: "PEN", retailer: "metro-pe",       sanityRange: { minMajor: 8, maxMajor: 30 } },
  { slug: "butter_200g", canonicalSize: 200,  unit: "g",   country: "PE", currency: "PEN", retailer: "metro-pe",       sanityRange: { minMajor: 8, maxMajor: 40 } },
  { slug: "sugar_1kg",   canonicalSize: 1000, unit: "g",   country: "PE", currency: "PEN", retailer: "metro-pe",       sanityRange: { minMajor: 2, maxMajor: 10 } },
  { slug: "rice_1kg",    canonicalSize: 1000, unit: "g",   country: "PE", currency: "PEN", retailer: "metro-pe",       sanityRange: { minMajor: 2, maxMajor: 15 } },
  { slug: "tomatoes_1kg",canonicalSize: 1000, unit: "g",   country: "PE", currency: "PEN", retailer: "metro-pe",       sanityRange: { minMajor: 3, maxMajor: 20 } },
  { slug: "potatoes_1kg",canonicalSize: 1000, unit: "g",   country: "PE", currency: "PEN", retailer: "metro-pe",       sanityRange: { minMajor: 1, maxMajor: 15 } },
  { slug: "olive_oil_1l",canonicalSize: 1000, unit: "ml",  country: "PE", currency: "PEN", retailer: "metro-pe",       sanityRange: { minMajor: 30, maxMajor: 250 } },
  { slug: "water_bottled_1500ml",canonicalSize: 1500, unit: "ml", country: "PE", currency: "PEN", retailer: "metro-pe",       sanityRange: { minMajor: 2, maxMajor: 20 } },
  { slug: "bananas_1kg", canonicalSize: 1000, unit: "g",   country: "PE", currency: "PEN", retailer: "metro-pe",       sanityRange: { minMajor: 2, maxMajor: 12 } },
  { slug: "apples_1kg",  canonicalSize: 1000, unit: "g",   country: "PE", currency: "PEN", retailer: "metro-pe",       sanityRange: { minMajor: 3, maxMajor: 25 } },
  { slug: "chicken_breast_1kg",canonicalSize: 1000, unit: "g", country: "PE", currency: "PEN", retailer: "metro-pe",       sanityRange: { minMajor: 10, maxMajor: 60 } },
  { slug: "beef_ground_1kg",canonicalSize: 1000, unit: "g", country: "PE", currency: "PEN", retailer: "metro-pe",       sanityRange: { minMajor: 15, maxMajor: 80 } },
  { slug: "cheese_local_500g",canonicalSize: 500, unit: "g", country: "PE", currency: "PEN", retailer: "metro-pe",       sanityRange: { minMajor: 10, maxMajor: 80 } },
  { slug: "beer_imported_500ml",canonicalSize: 500, unit: "ml", country: "PE", currency: "PEN", retailer: "metro-pe",       sanityRange: { minMajor: 4, maxMajor: 30 } },

  // Brazil via Mambo (mid-tier São Paulo VTEX storefront). Prices
  // in BRL with two decimals. Brazilian fresh meat / produce uses
  // VTEX measurementUnit "kg" with unitMultiplier 1, the bare-Kg
  // branch in the Wong-shaped parser handles them.
  { slug: "bread_500g",  canonicalSize: 500,  unit: "g",   country: "BR", currency: "BRL", retailer: "mambo-br",      sanityRange: { minMajor: 4, maxMajor: 25 } },
  { slug: "milk_1l",     canonicalSize: 1000, unit: "ml",  country: "BR", currency: "BRL", retailer: "mambo-br",      sanityRange: { minMajor: 4, maxMajor: 18 } },
  { slug: "eggs_12",  canonicalSize: 12,   unit: "pcs", country: "BR", currency: "BRL", retailer: "mambo-br",      sanityRange: { minMajor: 6, maxMajor: 30 } },
  { slug: "butter_200g", canonicalSize: 200,  unit: "g",   country: "BR", currency: "BRL", retailer: "mambo-br",      sanityRange: { minMajor: 6, maxMajor: 30 } },
  { slug: "sugar_1kg",   canonicalSize: 1000, unit: "g",   country: "BR", currency: "BRL", retailer: "mambo-br",      sanityRange: { minMajor: 3, maxMajor: 12 } },
  { slug: "rice_1kg",    canonicalSize: 1000, unit: "g",   country: "BR", currency: "BRL", retailer: "mambo-br",      sanityRange: { minMajor: 4, maxMajor: 25 } },
  { slug: "tomatoes_1kg",canonicalSize: 1000, unit: "g",   country: "BR", currency: "BRL", retailer: "mambo-br",      sanityRange: { minMajor: 5, maxMajor: 25 } },
  { slug: "potatoes_1kg",canonicalSize: 1000, unit: "g",   country: "BR", currency: "BRL", retailer: "mambo-br",      sanityRange: { minMajor: 3, maxMajor: 18 } },
  { slug: "olive_oil_1l",canonicalSize: 1000, unit: "ml",  country: "BR", currency: "BRL", retailer: "mambo-br",      sanityRange: { minMajor: 20, maxMajor: 120 } },
  { slug: "water_bottled_1500ml",canonicalSize: 1500, unit: "ml", country: "BR", currency: "BRL", retailer: "mambo-br",      sanityRange: { minMajor: 2, maxMajor: 15 } },
  { slug: "bananas_1kg", canonicalSize: 1000, unit: "g",   country: "BR", currency: "BRL", retailer: "mambo-br",      sanityRange: { minMajor: 3, maxMajor: 15 } },
  { slug: "apples_1kg",  canonicalSize: 1000, unit: "g",   country: "BR", currency: "BRL", retailer: "mambo-br",      sanityRange: { minMajor: 5, maxMajor: 25 } },
  { slug: "chicken_breast_1kg",canonicalSize: 1000, unit: "g", country: "BR", currency: "BRL", retailer: "mambo-br",      sanityRange: { minMajor: 15, maxMajor: 60 } },
  { slug: "beef_ground_1kg",canonicalSize: 1000, unit: "g", country: "BR", currency: "BRL", retailer: "mambo-br",      sanityRange: { minMajor: 20, maxMajor: 90 } },
  { slug: "cheese_local_500g",canonicalSize: 500, unit: "g", country: "BR", currency: "BRL", retailer: "mambo-br",      sanityRange: { minMajor: 8, maxMajor: 50 } },
  { slug: "beer_imported_500ml",canonicalSize: 500, unit: "ml", country: "BR", currency: "BRL", retailer: "mambo-br",      sanityRange: { minMajor: 4, maxMajor: 25 } },

  // Brazil 2nd retailer via Zona Sul (Rio de Janeiro VTEX hypermarket
  // chain, mid-tier premium). Cross-check for BR: Mambo (São Paulo)
  // + Zona Sul (Rio de Janeiro) covers the two largest BR metros and
  // catches regional pricing divergence.
  { slug: "bread_500g",  canonicalSize: 500,  unit: "g",   country: "BR", currency: "BRL", retailer: "zona-sul-br",   sanityRange: { minMajor: 4, maxMajor: 25 } },
  { slug: "milk_1l",     canonicalSize: 1000, unit: "ml",  country: "BR", currency: "BRL", retailer: "zona-sul-br",   sanityRange: { minMajor: 4, maxMajor: 18 } },
  { slug: "eggs_12",  canonicalSize: 12,   unit: "pcs", country: "BR", currency: "BRL", retailer: "zona-sul-br",   sanityRange: { minMajor: 6, maxMajor: 30 } },
  { slug: "butter_200g", canonicalSize: 200,  unit: "g",   country: "BR", currency: "BRL", retailer: "zona-sul-br",   sanityRange: { minMajor: 6, maxMajor: 30 } },
  { slug: "sugar_1kg",   canonicalSize: 1000, unit: "g",   country: "BR", currency: "BRL", retailer: "zona-sul-br",   sanityRange: { minMajor: 3, maxMajor: 12 } },
  { slug: "rice_1kg",    canonicalSize: 1000, unit: "g",   country: "BR", currency: "BRL", retailer: "zona-sul-br",   sanityRange: { minMajor: 4, maxMajor: 25 } },
  { slug: "tomatoes_1kg",canonicalSize: 1000, unit: "g",   country: "BR", currency: "BRL", retailer: "zona-sul-br",   sanityRange: { minMajor: 5, maxMajor: 25 } },
  { slug: "potatoes_1kg",canonicalSize: 1000, unit: "g",   country: "BR", currency: "BRL", retailer: "zona-sul-br",   sanityRange: { minMajor: 3, maxMajor: 18 } },
  { slug: "olive_oil_1l",canonicalSize: 1000, unit: "ml",  country: "BR", currency: "BRL", retailer: "zona-sul-br",   sanityRange: { minMajor: 20, maxMajor: 120 } },
  { slug: "water_bottled_1500ml",canonicalSize: 1500, unit: "ml", country: "BR", currency: "BRL", retailer: "zona-sul-br",   sanityRange: { minMajor: 2, maxMajor: 15 } },
  { slug: "bananas_1kg", canonicalSize: 1000, unit: "g",   country: "BR", currency: "BRL", retailer: "zona-sul-br",   sanityRange: { minMajor: 3, maxMajor: 15 } },
  { slug: "apples_1kg",  canonicalSize: 1000, unit: "g",   country: "BR", currency: "BRL", retailer: "zona-sul-br",   sanityRange: { minMajor: 5, maxMajor: 25 } },
  { slug: "chicken_breast_1kg",canonicalSize: 1000, unit: "g", country: "BR", currency: "BRL", retailer: "zona-sul-br",   sanityRange: { minMajor: 15, maxMajor: 60 } },
  { slug: "beef_ground_1kg",canonicalSize: 1000, unit: "g", country: "BR", currency: "BRL", retailer: "zona-sul-br",   sanityRange: { minMajor: 20, maxMajor: 90 } },
  { slug: "cheese_local_500g",canonicalSize: 500, unit: "g", country: "BR", currency: "BRL", retailer: "zona-sul-br",   sanityRange: { minMajor: 8, maxMajor: 50 } },
  { slug: "beer_imported_500ml",canonicalSize: 500, unit: "ml", country: "BR", currency: "BRL", retailer: "zona-sul-br",   sanityRange: { minMajor: 4, maxMajor: 25 } },

  // Brazil 3rd retailer via Hortifruti (national chain, fresh-produce
  // focused, VTEX catalog API). Cloudflare allows direct API access
  // when a browser User-Agent is sent. With Mambo (SP) + Zona Sul
  // (RJ) + Hortifruti (national footprint) we get full BR
  // triangulation across two metros + national.
  { slug: "bread_500g",  canonicalSize: 500,  unit: "g",   country: "BR", currency: "BRL", retailer: "hortifruti-br",  sanityRange: { minMajor: 4, maxMajor: 25 } },
  { slug: "milk_1l",     canonicalSize: 1000, unit: "ml",  country: "BR", currency: "BRL", retailer: "hortifruti-br",  sanityRange: { minMajor: 4, maxMajor: 18 } },
  { slug: "eggs_12",  canonicalSize: 12,   unit: "pcs", country: "BR", currency: "BRL", retailer: "hortifruti-br",  sanityRange: { minMajor: 6, maxMajor: 30 } },
  { slug: "butter_200g", canonicalSize: 200,  unit: "g",   country: "BR", currency: "BRL", retailer: "hortifruti-br",  sanityRange: { minMajor: 6, maxMajor: 30 } },
  { slug: "sugar_1kg",   canonicalSize: 1000, unit: "g",   country: "BR", currency: "BRL", retailer: "hortifruti-br",  sanityRange: { minMajor: 3, maxMajor: 12 } },
  { slug: "rice_1kg",    canonicalSize: 1000, unit: "g",   country: "BR", currency: "BRL", retailer: "hortifruti-br",  sanityRange: { minMajor: 4, maxMajor: 25 } },
  // tomatoes_1kg / potatoes_1kg / bananas_1kg / apples_1kg:
  // Hortifruti sells fresh produce by Unidade (single piece) with
  // unitMultiplier 1 and no weight in the title, so we cannot
  // reliably normalize to a 1 kg canonical price. Mambo + Zona Sul
  // still cover these slugs.
  { slug: "olive_oil_1l",canonicalSize: 1000, unit: "ml",  country: "BR", currency: "BRL", retailer: "hortifruti-br",  sanityRange: { minMajor: 20, maxMajor: 120 } },
  { slug: "water_bottled_1500ml",canonicalSize: 1500, unit: "ml", country: "BR", currency: "BRL", retailer: "hortifruti-br",  sanityRange: { minMajor: 2, maxMajor: 15 } },
  { slug: "chicken_breast_1kg",canonicalSize: 1000, unit: "g", country: "BR", currency: "BRL", retailer: "hortifruti-br",  sanityRange: { minMajor: 15, maxMajor: 60 } },
  { slug: "beef_ground_1kg",canonicalSize: 1000, unit: "g", country: "BR", currency: "BRL", retailer: "hortifruti-br",  sanityRange: { minMajor: 20, maxMajor: 90 } },
  { slug: "cheese_local_500g",canonicalSize: 500, unit: "g", country: "BR", currency: "BRL", retailer: "hortifruti-br",  sanityRange: { minMajor: 8, maxMajor: 50 } },
  { slug: "beer_imported_500ml",canonicalSize: 500, unit: "ml", country: "BR", currency: "BRL", retailer: "hortifruti-br",  sanityRange: { minMajor: 4, maxMajor: 25 } },

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

  // Colombia 2nd retailer via Carulla (Grupo Éxito's premium VTEX
  // store, sister to Éxito.com). Same currency, same canonical
  // sizes, same VTEX adapter as Olimpica, so Carulla unlocks a
  // cross-check signal per CO slug.
  { slug: "bread_500g",  canonicalSize: 500,  unit: "g",   country: "CO", currency: "COP", retailer: "carulla-co",    sanityRange: { minMajor: 4000, maxMajor: 20000 } },
  { slug: "milk_1l",     canonicalSize: 1000, unit: "ml",  country: "CO", currency: "COP", retailer: "carulla-co",    sanityRange: { minMajor: 2500, maxMajor: 10000 } },
  { slug: "eggs_12",  canonicalSize: 12,   unit: "pcs", country: "CO", currency: "COP", retailer: "carulla-co",    sanityRange: { minMajor: 4000, maxMajor: 18000 } },
  { slug: "butter_200g", canonicalSize: 200,  unit: "g",   country: "CO", currency: "COP", retailer: "carulla-co",    sanityRange: { minMajor: 6000, maxMajor: 25000 } },
  { slug: "sugar_1kg",   canonicalSize: 1000, unit: "g",   country: "CO", currency: "COP", retailer: "carulla-co",    sanityRange: { minMajor: 2500, maxMajor: 12000 } },
  { slug: "rice_1kg",    canonicalSize: 1000, unit: "g",   country: "CO", currency: "COP", retailer: "carulla-co",    sanityRange: { minMajor: 2000, maxMajor: 12000 } },
  { slug: "tomatoes_1kg",canonicalSize: 1000, unit: "g",   country: "CO", currency: "COP", retailer: "carulla-co",    sanityRange: { minMajor: 3500, maxMajor: 20000 } },
  { slug: "potatoes_1kg",canonicalSize: 1000, unit: "g",   country: "CO", currency: "COP", retailer: "carulla-co",    sanityRange: { minMajor: 1500, maxMajor: 12000 } },
  { slug: "olive_oil_1l",canonicalSize: 1000, unit: "ml",  country: "CO", currency: "COP", retailer: "carulla-co",    sanityRange: { minMajor: 25000, maxMajor: 150000 } },
  { slug: "water_bottled_1500ml",canonicalSize: 1500, unit: "ml", country: "CO", currency: "COP", retailer: "carulla-co",    sanityRange: { minMajor: 1500, maxMajor: 15000 } },
  { slug: "bananas_1kg", canonicalSize: 1000, unit: "g",   country: "CO", currency: "COP", retailer: "carulla-co",    sanityRange: { minMajor: 1500, maxMajor: 8000 } },
  { slug: "apples_1kg",  canonicalSize: 1000, unit: "g",   country: "CO", currency: "COP", retailer: "carulla-co",    sanityRange: { minMajor: 5000, maxMajor: 25000 } },
  { slug: "chicken_breast_1kg",canonicalSize: 1000, unit: "g", country: "CO", currency: "COP", retailer: "carulla-co",    sanityRange: { minMajor: 12000, maxMajor: 45000 } },
  { slug: "beef_ground_1kg",canonicalSize: 1000, unit: "g", country: "CO", currency: "COP", retailer: "carulla-co",    sanityRange: { minMajor: 12000, maxMajor: 50000 } },
  { slug: "cheese_local_500g",canonicalSize: 500, unit: "g", country: "CO", currency: "COP", retailer: "carulla-co",    sanityRange: { minMajor: 6000, maxMajor: 30000 } },
  { slug: "beer_imported_500ml",canonicalSize: 500, unit: "ml", country: "CO", currency: "COP", retailer: "carulla-co",    sanityRange: { minMajor: 2500, maxMajor: 15000 } },

  // Colombia 3rd retailer via Éxito (Grupo Éxito's flagship VTEX
  // hypermarket, parent of both Carulla and Olimpica-aligned
  // properties). Triangle cross-check for CO: Olimpica + Carulla +
  // Éxito = three independent reads per slug.
  { slug: "bread_500g",  canonicalSize: 500,  unit: "g",   country: "CO", currency: "COP", retailer: "exito-co",      sanityRange: { minMajor: 4000, maxMajor: 20000 } },
  { slug: "milk_1l",     canonicalSize: 1000, unit: "ml",  country: "CO", currency: "COP", retailer: "exito-co",      sanityRange: { minMajor: 2500, maxMajor: 10000 } },
  { slug: "eggs_12",  canonicalSize: 12,   unit: "pcs", country: "CO", currency: "COP", retailer: "exito-co",      sanityRange: { minMajor: 4000, maxMajor: 18000 } },
  { slug: "butter_200g", canonicalSize: 200,  unit: "g",   country: "CO", currency: "COP", retailer: "exito-co",      sanityRange: { minMajor: 6000, maxMajor: 25000 } },
  { slug: "sugar_1kg",   canonicalSize: 1000, unit: "g",   country: "CO", currency: "COP", retailer: "exito-co",      sanityRange: { minMajor: 2500, maxMajor: 12000 } },
  { slug: "rice_1kg",    canonicalSize: 1000, unit: "g",   country: "CO", currency: "COP", retailer: "exito-co",      sanityRange: { minMajor: 2000, maxMajor: 12000 } },
  { slug: "tomatoes_1kg",canonicalSize: 1000, unit: "g",   country: "CO", currency: "COP", retailer: "exito-co",      sanityRange: { minMajor: 3500, maxMajor: 20000 } },
  { slug: "potatoes_1kg",canonicalSize: 1000, unit: "g",   country: "CO", currency: "COP", retailer: "exito-co",      sanityRange: { minMajor: 1500, maxMajor: 12000 } },
  { slug: "olive_oil_1l",canonicalSize: 1000, unit: "ml",  country: "CO", currency: "COP", retailer: "exito-co",      sanityRange: { minMajor: 25000, maxMajor: 150000 } },
  { slug: "water_bottled_1500ml",canonicalSize: 1500, unit: "ml", country: "CO", currency: "COP", retailer: "exito-co",      sanityRange: { minMajor: 1500, maxMajor: 15000 } },
  { slug: "bananas_1kg", canonicalSize: 1000, unit: "g",   country: "CO", currency: "COP", retailer: "exito-co",      sanityRange: { minMajor: 1500, maxMajor: 8000 } },
  { slug: "apples_1kg",  canonicalSize: 1000, unit: "g",   country: "CO", currency: "COP", retailer: "exito-co",      sanityRange: { minMajor: 5000, maxMajor: 25000 } },
  { slug: "chicken_breast_1kg",canonicalSize: 1000, unit: "g", country: "CO", currency: "COP", retailer: "exito-co",      sanityRange: { minMajor: 12000, maxMajor: 45000 } },
  { slug: "beef_ground_1kg",canonicalSize: 1000, unit: "g", country: "CO", currency: "COP", retailer: "exito-co",      sanityRange: { minMajor: 12000, maxMajor: 50000 } },
  { slug: "cheese_local_500g",canonicalSize: 500, unit: "g", country: "CO", currency: "COP", retailer: "exito-co",      sanityRange: { minMajor: 6000, maxMajor: 30000 } },
  { slug: "beer_imported_500ml",canonicalSize: 500, unit: "ml", country: "CO", currency: "COP", retailer: "exito-co",      sanityRange: { minMajor: 2500, maxMajor: 15000 } },

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

  // ROMANIA via Auchan (VTEX catalog API). Prices in RON (Romanian
  // leu). Auchan RO exposes two bonus fields not present on other
  // VTEX retailers, `Nume unitate` (unit name: kg / l / buc) and
  // `Cantitate unitate` (quantity as string), but the scraper sticks
  // with title-regex parsing for consistency with the other VTEX
  // adapters; size is recoverable from the title for every product
  // worth picking. Eggs ship in cartons of 10 (not 12), so the
  // packSize=10 canonical=12 scale is handled by normalize.ts.
  { slug: "bread_500g",  canonicalSize: 500,  unit: "g",   country: "RO", currency: "RON", retailer: "auchan-ro",     sanityRange: { minMajor: 3, maxMajor: 15 } },
  { slug: "milk_1l",     canonicalSize: 1000, unit: "ml",  country: "RO", currency: "RON", retailer: "auchan-ro",     sanityRange: { minMajor: 3, maxMajor: 12 } },
  { slug: "eggs_12",  canonicalSize: 12,   unit: "pcs", country: "RO", currency: "RON", retailer: "auchan-ro",     sanityRange: { minMajor: 12, maxMajor: 36 } },
  { slug: "butter_200g", canonicalSize: 200,  unit: "g",   country: "RO", currency: "RON", retailer: "auchan-ro",     sanityRange: { minMajor: 8, maxMajor: 25 } },
  { slug: "sugar_1kg",   canonicalSize: 1000, unit: "g",   country: "RO", currency: "RON", retailer: "auchan-ro",     sanityRange: { minMajor: 3, maxMajor: 15 } },
  { slug: "rice_1kg",    canonicalSize: 1000, unit: "g",   country: "RO", currency: "RON", retailer: "auchan-ro",     sanityRange: { minMajor: 4, maxMajor: 25 } },
  { slug: "tomatoes_1kg",canonicalSize: 1000, unit: "g",   country: "RO", currency: "RON", retailer: "auchan-ro",     sanityRange: { minMajor: 5, maxMajor: 25 } },
  { slug: "potatoes_1kg",canonicalSize: 1000, unit: "g",   country: "RO", currency: "RON", retailer: "auchan-ro",     sanityRange: { minMajor: 2, maxMajor: 12 } },
  { slug: "olive_oil_1l",canonicalSize: 1000, unit: "ml",  country: "RO", currency: "RON", retailer: "auchan-ro",     sanityRange: { minMajor: 20, maxMajor: 100 } },
  { slug: "water_bottled_1500ml",canonicalSize: 1500, unit: "ml", country: "RO", currency: "RON", retailer: "auchan-ro",     sanityRange: { minMajor: 1.5, maxMajor: 15 } },
  { slug: "bananas_1kg", canonicalSize: 1000, unit: "g",   country: "RO", currency: "RON", retailer: "auchan-ro",     sanityRange: { minMajor: 4, maxMajor: 15 } },
  { slug: "apples_1kg",  canonicalSize: 1000, unit: "g",   country: "RO", currency: "RON", retailer: "auchan-ro",     sanityRange: { minMajor: 3, maxMajor: 20 } },
  { slug: "chicken_breast_1kg",canonicalSize: 1000, unit: "g", country: "RO", currency: "RON", retailer: "auchan-ro",     sanityRange: { minMajor: 20, maxMajor: 70 } },
  { slug: "beef_ground_1kg",canonicalSize: 1000, unit: "g", country: "RO", currency: "RON", retailer: "auchan-ro",     sanityRange: { minMajor: 30, maxMajor: 150 } },
  { slug: "cheese_local_500g",canonicalSize: 500, unit: "g", country: "RO", currency: "RON", retailer: "auchan-ro",     sanityRange: { minMajor: 10, maxMajor: 50 } },
  { slug: "beer_imported_500ml",canonicalSize: 500, unit: "ml", country: "RO", currency: "RON", retailer: "auchan-ro",     sanityRange: { minMajor: 3, maxMajor: 15 } },

  // ESTONIA via Rimi (SSR data-gtm-eec-product JSON extract). Prices
  // in EUR. Rimi e-store inlines a JSON envelope per product card
  // inside a `data-gtm-eec-product='{...}'` attribute, so a regex
  // sweep of the search HTML returns 40 candidates per query
  // without proxy, login, or Browser Use credit. Eggs sell as
  // 10-piece cartons (Baltic standard), the canonical eggs_12
  // scale is handled by normalize.ts. Pack-size units in Estonian
  // titles use both Estonian (tk = tükki = piece) and metric
  // shorthand (l, ml, kg, g).
  { slug: "bread_500g",  canonicalSize: 500,  unit: "g",   country: "EE", currency: "EUR", retailer: "rimi-ee",       sanityRange: { minMajor: 0.5, maxMajor: 3.5 } },
  { slug: "milk_1l",     canonicalSize: 1000, unit: "ml",  country: "EE", currency: "EUR", retailer: "rimi-ee",       sanityRange: { minMajor: 0.5, maxMajor: 2.5 } },
  { slug: "eggs_12",  canonicalSize: 12,   unit: "pcs", country: "EE", currency: "EUR", retailer: "rimi-ee",       sanityRange: { minMajor: 1.5, maxMajor: 6 } },
  { slug: "butter_200g", canonicalSize: 200,  unit: "g",   country: "EE", currency: "EUR", retailer: "rimi-ee",       sanityRange: { minMajor: 1.5, maxMajor: 5 } },
  { slug: "sugar_1kg",   canonicalSize: 1000, unit: "g",   country: "EE", currency: "EUR", retailer: "rimi-ee",       sanityRange: { minMajor: 0.5, maxMajor: 3 } },
  { slug: "rice_1kg",    canonicalSize: 1000, unit: "g",   country: "EE", currency: "EUR", retailer: "rimi-ee",       sanityRange: { minMajor: 1, maxMajor: 8 } },
  { slug: "tomatoes_1kg",canonicalSize: 1000, unit: "g",   country: "EE", currency: "EUR", retailer: "rimi-ee",       sanityRange: { minMajor: 0.7, maxMajor: 6 } },
  { slug: "potatoes_1kg",canonicalSize: 1000, unit: "g",   country: "EE", currency: "EUR", retailer: "rimi-ee",       sanityRange: { minMajor: 0.5, maxMajor: 4 } },
  { slug: "olive_oil_1l",canonicalSize: 1000, unit: "ml",  country: "EE", currency: "EUR", retailer: "rimi-ee",       sanityRange: { minMajor: 5, maxMajor: 25 } },
  { slug: "water_bottled_1500ml",canonicalSize: 1500, unit: "ml", country: "EE", currency: "EUR", retailer: "rimi-ee",       sanityRange: { minMajor: 0.4, maxMajor: 4 } },
  { slug: "bananas_1kg", canonicalSize: 1000, unit: "g",   country: "EE", currency: "EUR", retailer: "rimi-ee",       sanityRange: { minMajor: 0.7, maxMajor: 3 } },
  { slug: "apples_1kg",  canonicalSize: 1000, unit: "g",   country: "EE", currency: "EUR", retailer: "rimi-ee",       sanityRange: { minMajor: 0.4, maxMajor: 4 } },
  { slug: "chicken_breast_1kg",canonicalSize: 1000, unit: "g", country: "EE", currency: "EUR", retailer: "rimi-ee",       sanityRange: { minMajor: 3, maxMajor: 14 } },
  { slug: "beef_ground_1kg",canonicalSize: 1000, unit: "g", country: "EE", currency: "EUR", retailer: "rimi-ee",       sanityRange: { minMajor: 6, maxMajor: 22 } },
  { slug: "cheese_local_500g",canonicalSize: 500, unit: "g", country: "EE", currency: "EUR", retailer: "rimi-ee",       sanityRange: { minMajor: 2.5, maxMajor: 12 } },
  { slug: "beer_imported_500ml",canonicalSize: 500, unit: "ml", country: "EE", currency: "EUR", retailer: "rimi-ee",       sanityRange: { minMajor: 0.7, maxMajor: 4 } },

  // LATVIA via Rimi (same data-gtm-eec-product SSR shape as Rimi
  // EE, served from rimi.lv at /e-veikals/lv/meklesana). Prices in
  // EUR (Eurozone since 2014). Eggs ship as 10-piece cartons, same
  // canonical 12/10 scaling via normalize.ts. Latvian retail uses
  // its own set of diacritics (a-macron, e-macron, i-macron,
  // u-macron, c-caron, s-caron, z-caron, plus l-cedilla and
  // n-cedilla), so pickers needing leading-diacritic words wrap
  // their include patterns in a Unicode lookbehind (same trick as
  // EE apples/beer).
  { slug: "bread_500g",  canonicalSize: 500,  unit: "g",   country: "LV", currency: "EUR", retailer: "rimi-lv",       sanityRange: { minMajor: 0.5, maxMajor: 3.5 } },
  { slug: "milk_1l",     canonicalSize: 1000, unit: "ml",  country: "LV", currency: "EUR", retailer: "rimi-lv",       sanityRange: { minMajor: 0.5, maxMajor: 2.5 } },
  { slug: "eggs_12",  canonicalSize: 12,   unit: "pcs", country: "LV", currency: "EUR", retailer: "rimi-lv",       sanityRange: { minMajor: 1.5, maxMajor: 7 } },
  { slug: "butter_200g", canonicalSize: 200,  unit: "g",   country: "LV", currency: "EUR", retailer: "rimi-lv",       sanityRange: { minMajor: 0.8, maxMajor: 5 } },
  { slug: "sugar_1kg",   canonicalSize: 1000, unit: "g",   country: "LV", currency: "EUR", retailer: "rimi-lv",       sanityRange: { minMajor: 0.5, maxMajor: 3 } },
  { slug: "rice_1kg",    canonicalSize: 1000, unit: "g",   country: "LV", currency: "EUR", retailer: "rimi-lv",       sanityRange: { minMajor: 1, maxMajor: 8 } },
  { slug: "tomatoes_1kg",canonicalSize: 1000, unit: "g",   country: "LV", currency: "EUR", retailer: "rimi-lv",       sanityRange: { minMajor: 0.8, maxMajor: 6 } },
  { slug: "potatoes_1kg",canonicalSize: 1000, unit: "g",   country: "LV", currency: "EUR", retailer: "rimi-lv",       sanityRange: { minMajor: 0.5, maxMajor: 4 } },
  { slug: "olive_oil_1l",canonicalSize: 1000, unit: "ml",  country: "LV", currency: "EUR", retailer: "rimi-lv",       sanityRange: { minMajor: 4, maxMajor: 30 } },
  { slug: "water_bottled_1500ml",canonicalSize: 1500, unit: "ml", country: "LV", currency: "EUR", retailer: "rimi-lv",       sanityRange: { minMajor: 0.3, maxMajor: 3 } },
  { slug: "bananas_1kg", canonicalSize: 1000, unit: "g",   country: "LV", currency: "EUR", retailer: "rimi-lv",       sanityRange: { minMajor: 0.5, maxMajor: 3 } },
  { slug: "apples_1kg",  canonicalSize: 1000, unit: "g",   country: "LV", currency: "EUR", retailer: "rimi-lv",       sanityRange: { minMajor: 0.4, maxMajor: 4 } },
  { slug: "chicken_breast_1kg",canonicalSize: 1000, unit: "g", country: "LV", currency: "EUR", retailer: "rimi-lv",       sanityRange: { minMajor: 3, maxMajor: 15 } },
  { slug: "beef_ground_1kg",canonicalSize: 1000, unit: "g", country: "LV", currency: "EUR", retailer: "rimi-lv",       sanityRange: { minMajor: 5, maxMajor: 25 } },
  { slug: "cheese_local_500g",canonicalSize: 500, unit: "g", country: "LV", currency: "EUR", retailer: "rimi-lv",       sanityRange: { minMajor: 2.5, maxMajor: 12 } },
  { slug: "beer_imported_500ml",canonicalSize: 500, unit: "ml", country: "LV", currency: "EUR", retailer: "rimi-lv",       sanityRange: { minMajor: 0.6, maxMajor: 4 } },

  // LITHUANIA via Rimi (same data-gtm-eec-product SSR shape as
  // EE / LV, served from rimi.lt at /e-parduotuve/lt/paieska).
  // Prices in EUR (Eurozone since 2015). Eggs ship in 10-piece
  // cartons. Lithuanian retail does not stock 500 g hard cheese;
  // the canonical pick is the 200-300 g Tilsit / Dvaro tray and
  // normalize.ts scales the price by 500 / packSize, so the
  // sanityRange covers the scaled 500 g price (about 3-12 EUR).
  // Five SKUs lead with non-ASCII diacritic letters (ė, ž, č,
  // š, ū) and use Unicode lookbehind on the include pattern.
  { slug: "bread_500g",  canonicalSize: 500,  unit: "g",   country: "LT", currency: "EUR", retailer: "rimi-lt",       sanityRange: { minMajor: 0.8, maxMajor: 4 } },
  { slug: "milk_1l",     canonicalSize: 1000, unit: "ml",  country: "LT", currency: "EUR", retailer: "rimi-lt",       sanityRange: { minMajor: 0.8, maxMajor: 3 } },
  { slug: "eggs_12",  canonicalSize: 12,   unit: "pcs", country: "LT", currency: "EUR", retailer: "rimi-lt",       sanityRange: { minMajor: 2, maxMajor: 7 } },
  { slug: "butter_200g", canonicalSize: 200,  unit: "g",   country: "LT", currency: "EUR", retailer: "rimi-lt",       sanityRange: { minMajor: 2, maxMajor: 6 } },
  { slug: "sugar_1kg",   canonicalSize: 1000, unit: "g",   country: "LT", currency: "EUR", retailer: "rimi-lt",       sanityRange: { minMajor: 0.5, maxMajor: 3 } },
  { slug: "rice_1kg",    canonicalSize: 1000, unit: "g",   country: "LT", currency: "EUR", retailer: "rimi-lt",       sanityRange: { minMajor: 1, maxMajor: 8 } },
  { slug: "tomatoes_1kg",canonicalSize: 1000, unit: "g",   country: "LT", currency: "EUR", retailer: "rimi-lt",       sanityRange: { minMajor: 0.8, maxMajor: 6 } },
  { slug: "potatoes_1kg",canonicalSize: 1000, unit: "g",   country: "LT", currency: "EUR", retailer: "rimi-lt",       sanityRange: { minMajor: 0.2, maxMajor: 4 } },
  { slug: "olive_oil_1l",canonicalSize: 1000, unit: "ml",  country: "LT", currency: "EUR", retailer: "rimi-lt",       sanityRange: { minMajor: 5, maxMajor: 30 } },
  { slug: "water_bottled_1500ml",canonicalSize: 1500, unit: "ml", country: "LT", currency: "EUR", retailer: "rimi-lt",       sanityRange: { minMajor: 0.5, maxMajor: 3 } },
  { slug: "bananas_1kg", canonicalSize: 1000, unit: "g",   country: "LT", currency: "EUR", retailer: "rimi-lt",       sanityRange: { minMajor: 0.5, maxMajor: 3 } },
  { slug: "apples_1kg",  canonicalSize: 1000, unit: "g",   country: "LT", currency: "EUR", retailer: "rimi-lt",       sanityRange: { minMajor: 0.3, maxMajor: 4 } },
  { slug: "chicken_breast_1kg",canonicalSize: 1000, unit: "g", country: "LT", currency: "EUR", retailer: "rimi-lt",       sanityRange: { minMajor: 3, maxMajor: 15 } },
  { slug: "beef_ground_1kg",canonicalSize: 1000, unit: "g", country: "LT", currency: "EUR", retailer: "rimi-lt",       sanityRange: { minMajor: 3, maxMajor: 25 } },
  { slug: "cheese_local_500g",canonicalSize: 500, unit: "g", country: "LT", currency: "EUR", retailer: "rimi-lt",       sanityRange: { minMajor: 2.5, maxMajor: 14 } },
  { slug: "beer_imported_500ml",canonicalSize: 500, unit: "ml", country: "LT", currency: "EUR", retailer: "rimi-lt",       sanityRange: { minMajor: 0.8, maxMajor: 4 } },

  // PORTUGAL via Continente (SSR `data-product-tile-impression`
  // JSON envelope + `pwc-tile--quantity` text). Prices in EUR.
  // Eggs: Portuguese retail sells 6 / 10 / 12 / 18 / 30 piece
  // cartons, all common; pack-size parser accepts any. Loose
  // produce ships in 500 g / 1 kg / 2 kg bags (Continente
  // does not sell true loose per-kg fresh produce online), so
  // the produce slugs accept 500-2500 g packs and normalize.ts
  // scales the on-chain price to per-kg. Beer cans are 0.33 L
  // (Super Bock Sky) or 0.5 L (Heineken / Carlsberg / standard
  // Super Bock), so the sizeRange allows both with a 250-600 ml
  // window. Five SKUs lead with non-ASCII Portuguese diacritics
  // (acucar with a-acute, agua with a-acute, oleo with o-acute,
  // maca with c-cedilla, oleo) and the include regex uses a
  // Unicode lookbehind.
  { slug: "bread_500g",  canonicalSize: 500,  unit: "g",   country: "PT", currency: "EUR", retailer: "continente-pt", sanityRange: { minMajor: 0.6, maxMajor: 3.5 } },
  { slug: "milk_1l",     canonicalSize: 1000, unit: "ml",  country: "PT", currency: "EUR", retailer: "continente-pt", sanityRange: { minMajor: 0.7, maxMajor: 2.5 } },
  { slug: "eggs_12",  canonicalSize: 12,   unit: "pcs", country: "PT", currency: "EUR", retailer: "continente-pt", sanityRange: { minMajor: 1.8, maxMajor: 7 } },
  { slug: "butter_200g", canonicalSize: 200,  unit: "g",   country: "PT", currency: "EUR", retailer: "continente-pt", sanityRange: { minMajor: 1.2, maxMajor: 5 } },
  { slug: "sugar_1kg",   canonicalSize: 1000, unit: "g",   country: "PT", currency: "EUR", retailer: "continente-pt", sanityRange: { minMajor: 0.6, maxMajor: 3 } },
  { slug: "rice_1kg",    canonicalSize: 1000, unit: "g",   country: "PT", currency: "EUR", retailer: "continente-pt", sanityRange: { minMajor: 0.8, maxMajor: 5 } },
  { slug: "tomatoes_1kg",canonicalSize: 1000, unit: "g",   country: "PT", currency: "EUR", retailer: "continente-pt", sanityRange: { minMajor: 1, maxMajor: 6 } },
  { slug: "potatoes_1kg",canonicalSize: 1000, unit: "g",   country: "PT", currency: "EUR", retailer: "continente-pt", sanityRange: { minMajor: 0.5, maxMajor: 4 } },
  { slug: "olive_oil_1l",canonicalSize: 1000, unit: "ml",  country: "PT", currency: "EUR", retailer: "continente-pt", sanityRange: { minMajor: 3, maxMajor: 20 } },
  { slug: "water_bottled_1500ml",canonicalSize: 1500, unit: "ml", country: "PT", currency: "EUR", retailer: "continente-pt", sanityRange: { minMajor: 0.25, maxMajor: 3 } },
  { slug: "bananas_1kg", canonicalSize: 1000, unit: "g",   country: "PT", currency: "EUR", retailer: "continente-pt", sanityRange: { minMajor: 1, maxMajor: 4 } },
  { slug: "apples_1kg",  canonicalSize: 1000, unit: "g",   country: "PT", currency: "EUR", retailer: "continente-pt", sanityRange: { minMajor: 0.8, maxMajor: 4.5 } },
  { slug: "chicken_breast_1kg",canonicalSize: 1000, unit: "g", country: "PT", currency: "EUR", retailer: "continente-pt", sanityRange: { minMajor: 4, maxMajor: 15 } },
  { slug: "beef_ground_1kg",canonicalSize: 1000, unit: "g", country: "PT", currency: "EUR", retailer: "continente-pt", sanityRange: { minMajor: 5, maxMajor: 25 } },
  { slug: "cheese_local_500g",canonicalSize: 500, unit: "g", country: "PT", currency: "EUR", retailer: "continente-pt", sanityRange: { minMajor: 2.5, maxMajor: 15 } },
  { slug: "beer_imported_500ml",canonicalSize: 500, unit: "ml", country: "PT", currency: "EUR", retailer: "continente-pt", sanityRange: { minMajor: 0.4, maxMajor: 3 } },

  // Costa Rica via Más x Menos (Walmart-owned VTEX store). Prices in
  // Costa Rican Colón (CRC). USD-CRC ≈ 1:520 so bread 700-2150 CRC
  // ≈ 1.40-4.10 USD. The supermarket indexes butcher meats with
  // measurementUnit "kg" and unitMultiplier 0.5-0.6 like Olimpica CO
  // and Disco AR, so the bare-Kg branch in parseProduct will pick
  // them up unchanged.
  { slug: "bread_500g",  canonicalSize: 500,  unit: "g",   country: "CR", currency: "CRC", retailer: "masxmenos-cr",  sanityRange: { minMajor: 600, maxMajor: 4000 } },
  { slug: "milk_1l",     canonicalSize: 1000, unit: "ml",  country: "CR", currency: "CRC", retailer: "masxmenos-cr",  sanityRange: { minMajor: 700, maxMajor: 2500 } },
  { slug: "eggs_12",  canonicalSize: 12,   unit: "pcs", country: "CR", currency: "CRC", retailer: "masxmenos-cr",  sanityRange: { minMajor: 1500, maxMajor: 5000 } },
  { slug: "butter_200g", canonicalSize: 200,  unit: "g",   country: "CR", currency: "CRC", retailer: "masxmenos-cr",  sanityRange: { minMajor: 1500, maxMajor: 6000 } },
  { slug: "sugar_1kg",   canonicalSize: 1000, unit: "g",   country: "CR", currency: "CRC", retailer: "masxmenos-cr",  sanityRange: { minMajor: 600, maxMajor: 3000 } },
  { slug: "rice_1kg",    canonicalSize: 1000, unit: "g",   country: "CR", currency: "CRC", retailer: "masxmenos-cr",  sanityRange: { minMajor: 800, maxMajor: 4000 } },
  { slug: "tomatoes_1kg",canonicalSize: 1000, unit: "g",   country: "CR", currency: "CRC", retailer: "masxmenos-cr",  sanityRange: { minMajor: 800, maxMajor: 4000 } },
  { slug: "potatoes_1kg",canonicalSize: 1000, unit: "g",   country: "CR", currency: "CRC", retailer: "masxmenos-cr",  sanityRange: { minMajor: 600, maxMajor: 3500 } },
  { slug: "olive_oil_1l",canonicalSize: 1000, unit: "ml",  country: "CR", currency: "CRC", retailer: "masxmenos-cr",  sanityRange: { minMajor: 4000, maxMajor: 25000 } },
  { slug: "water_bottled_1500ml",canonicalSize: 1500, unit: "ml", country: "CR", currency: "CRC", retailer: "masxmenos-cr",  sanityRange: { minMajor: 400, maxMajor: 3000 } },
  { slug: "bananas_1kg", canonicalSize: 1000, unit: "g",   country: "CR", currency: "CRC", retailer: "masxmenos-cr",  sanityRange: { minMajor: 500, maxMajor: 3000 } },
  { slug: "apples_1kg",  canonicalSize: 1000, unit: "g",   country: "CR", currency: "CRC", retailer: "masxmenos-cr",  sanityRange: { minMajor: 1500, maxMajor: 7000 } },
  { slug: "chicken_breast_1kg",canonicalSize: 1000, unit: "g", country: "CR", currency: "CRC", retailer: "masxmenos-cr",  sanityRange: { minMajor: 2000, maxMajor: 10000 } },
  { slug: "beef_ground_1kg",canonicalSize: 1000, unit: "g", country: "CR", currency: "CRC", retailer: "masxmenos-cr",  sanityRange: { minMajor: 4000, maxMajor: 16000 } },
  { slug: "cheese_local_500g",canonicalSize: 500, unit: "g", country: "CR", currency: "CRC", retailer: "masxmenos-cr",  sanityRange: { minMajor: 1500, maxMajor: 8000 } },
  { slug: "beer_imported_500ml",canonicalSize: 500, unit: "ml", country: "CR", currency: "CRC", retailer: "masxmenos-cr",  sanityRange: { minMajor: 700, maxMajor: 3000 } },
];

export function targetsForRetailer(retailer: Retailer): ProductTarget[] {
  return PRODUCT_TARGETS.filter((t) => t.retailer === retailer);
}
// @group: dairy (milk, eggs, cheese, butter)
// @group: protein (chicken, beef, fish, pork)
// @group: produce (apples, bananas, tomatoes, potatoes)
// @group: beverages (water, coffee, beer, soda)
// @group: transport (gasoline, diesel, taxi, public transit)
// @group: housing (rent, utilities, internet)
// @group: services (gym, cinema, haircut, restaurant)
// @group: clothing (jeans, sneakers, t-shirt, jacket)
// @a11y: check contrast ratio here
// @edge: zero-value special case
// @type: add discriminant union for states
// @config: prefer env var over hardcode
// @guard: sanitize user input here
// @cleanup: remove unused import on refactor
// @perf: add caching layer here
// @note: coordinated with PR #87
// @perf: use index for O(1) lookup
// @note: discussed in review thread
// @guard: rate limit this operation
// @guard: sanitize user input here
// @todo: add loading skeleton UI
// @i18n: ensure this string is extracted
