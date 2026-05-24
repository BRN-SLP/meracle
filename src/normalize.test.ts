import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { NormalizationError, normalize } from "./normalize.js";
import type { ProductTarget } from "./products.js";
import type { ScrapedProduct } from "./types.js";

const breadGB: ProductTarget = {
  slug: "bread_500g",
  canonicalSize: 500,
  unit: "g",
  country: "GB",
  currency: "GBP",
  retailer: "sainsburys-uk",
  sanityRange: { minMajor: 0.5, maxMajor: 3 },
};

const milkUA: ProductTarget = {
  slug: "milk_1l",
  canonicalSize: 1000,
  unit: "ml",
  country: "UA",
  currency: "UAH",
  retailer: "novus-ua",
  sanityRange: { minMajor: 30, maxMajor: 90 },
};

function scrape(target: ProductTarget, overrides: Partial<ScrapedProduct>): ScrapedProduct {
  return {
    target,
    retailerSku: "sku-x",
    retailerTitle: "Test product",
    priceMajor: 1,
    packSize: target.canonicalSize,
    scrapedAt: "2026-05-24T12:00:00.000Z",
    sourceUrl: "https://example.com/p/x",
    ...overrides,
  };
}

describe("normalize", () => {
  it("passes through canonical-size scrapes 1:1", () => {
    const obs = normalize(scrape(breadGB, { priceMajor: 1.2, packSize: 500 }));
    assert.equal(obs.priceCents, 120);
    assert.equal(obs.slug, "bread_500g");
    assert.equal(obs.country, "GB");
  });

  it("normalises an 800 g loaf down to 500 g", () => {
    // 800 g @ £1.20 -> £0.0015/g -> 500 g = £0.75 -> 75p
    const obs = normalize(scrape(breadGB, { priceMajor: 1.2, packSize: 800 }));
    assert.equal(obs.priceCents, 75);
  });

  it("normalises a 2-pint (1136 mL) milk up to 1 L", () => {
    // 1136 mL @ £1.45 -> £0.001276/mL -> 1000 mL = £1.276 -> 128p (round-half-up)
    const target = { ...milkUA, country: "GB" as const, currency: "GBP" as const, sanityRange: { minMajor: 0.5, maxMajor: 3 } };
    const obs = normalize(scrape(target, { priceMajor: 1.45, packSize: 1136 }));
    assert.equal(obs.priceCents, 128);
  });

  it("rounds half-cent values away from zero", () => {
    // 1000 g @ £2.55 -> price-per-g = £0.00255 -> 500 g canonical = £1.275
    // 127.5 cents -> rounded up to 128. In-band for GBP bread [0.5, 3].
    const obs = normalize(scrape(breadGB, { priceMajor: 2.55, packSize: 1000 }));
    assert.equal(obs.priceCents, 128);
  });

  it("propagates the source URL into the observation", () => {
    const obs = normalize(
      scrape(milkUA, {
        priceMajor: 35,
        packSize: 1000,
        sourceUrl: "https://stores-api.zakaz.ua/stores/.../milk",
      }),
    );
    assert.equal(obs.sourceUrl, "https://stores-api.zakaz.ua/stores/.../milk");
  });

  it("rejects out-of-band low prices", () => {
    // 100 g @ £0.05 -> normalised 500g = £0.25, below GBP bread band [0.5, 3]
    assert.throws(
      () => normalize(scrape(breadGB, { priceMajor: 0.05, packSize: 100 })),
      NormalizationError,
    );
  });

  it("rejects out-of-band high prices", () => {
    // 500 g @ £10 -> above GBP bread band
    assert.throws(
      () => normalize(scrape(breadGB, { priceMajor: 10, packSize: 500 })),
      NormalizationError,
    );
  });

  it("rejects zero priceMajor", () => {
    assert.throws(
      () => normalize(scrape(breadGB, { priceMajor: 0, packSize: 500 })),
      /priceMajor invalid/,
    );
  });

  it("rejects zero packSize", () => {
    assert.throws(
      () => normalize(scrape(breadGB, { priceMajor: 1, packSize: 0 })),
      /packSize invalid/,
    );
  });

  it("rejects NaN priceMajor", () => {
    assert.throws(
      () => normalize(scrape(breadGB, { priceMajor: Number.NaN, packSize: 500 })),
      /priceMajor invalid/,
    );
  });
});
