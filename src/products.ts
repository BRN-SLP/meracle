/**
 * meRacle Phase 1 product catalog.
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
 * local-currency cents (UAH cents, GBP pence, EUR cents). Cross-country
 * comparison happens in the Mercato UI via offchain FX, NOT in the
 * scraper.
 *
 * `canonicalSize` is the size baked into the slug (`bread_500g` = 500 g,
 * `milk_1l` = 1000 mL). When a retailer sells a different size we
 * normalise math-wise in src/normalize.ts (price-per-unit * canonical).
 *
 * Phase 1 scope, 2 products * 3 countries = 6 observations per daily
 * cron. Expansion happens by appending entries here, the rest of the
 * pipeline is product-agnostic.
 */

export type Retailer = "novus-ua" | "sainsburys-uk" | "mercadona-es";

export type Unit = "g" | "ml";

export interface ProductTarget {
  /** Mercato canonical slug, hashed to bytes12 barcode. */
  slug: "bread_500g" | "milk_1l";
  /** Canonical size baked into the slug. */
  canonicalSize: number;
  /** Unit the canonical size is measured in. */
  unit: Unit;
  /** ISO-3166-1 alpha-2 country code. */
  country: "UA" | "GB" | "ES";
  /** ISO-4217 currency code, informational. */
  currency: "UAH" | "GBP" | "EUR";
  /** Which scraper module fetches this target. */
  retailer: Retailer;
  /**
   * Sanity range in local currency major units. Observations falling
   * outside the range are flagged before submission, prevents bad
   * scrapes from polluting the on-chain dataset.
   */
  sanityRange: { minMajor: number; maxMajor: number };
}

export const PHASE_1_TARGETS: readonly ProductTarget[] = [
  // UKRAINE, Novus Kyiv via zakaz.ua API
  {
    slug: "bread_500g",
    canonicalSize: 500,
    unit: "g",
    country: "UA",
    currency: "UAH",
    retailer: "novus-ua",
    sanityRange: { minMajor: 15, maxMajor: 90 },
  },
  {
    slug: "milk_1l",
    canonicalSize: 1000,
    unit: "ml",
    country: "UA",
    currency: "UAH",
    retailer: "novus-ua",
    sanityRange: { minMajor: 30, maxMajor: 90 },
  },

  // UNITED KINGDOM, Sainsbury's
  {
    slug: "bread_500g",
    canonicalSize: 500,
    unit: "g",
    country: "GB",
    currency: "GBP",
    retailer: "sainsburys-uk",
    sanityRange: { minMajor: 0.5, maxMajor: 3 },
  },
  {
    slug: "milk_1l",
    canonicalSize: 1000,
    unit: "ml",
    country: "GB",
    currency: "GBP",
    retailer: "sainsburys-uk",
    sanityRange: { minMajor: 0.9, maxMajor: 2 },
  },

  // SPAIN, Mercadona (Madrid postal 28001)
  {
    slug: "bread_500g",
    canonicalSize: 500,
    unit: "g",
    country: "ES",
    currency: "EUR",
    retailer: "mercadona-es",
    sanityRange: { minMajor: 0.6, maxMajor: 3 },
  },
  {
    slug: "milk_1l",
    canonicalSize: 1000,
    unit: "ml",
    country: "ES",
    currency: "EUR",
    retailer: "mercadona-es",
    sanityRange: { minMajor: 0.8, maxMajor: 2 },
  },
];

export function targetsForRetailer(retailer: Retailer): ProductTarget[] {
  return PHASE_1_TARGETS.filter((t) => t.retailer === retailer);
}
