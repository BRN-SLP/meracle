/**
 * Pinned encoder vectors.
 *
 * These vectors MUST match Mercato apps/web/src/lib/encode.ts, drift
 * here means agent submissions never aggregate with UI submissions
 * on-chain. Pre-computed via the Mercato UI source for the slugs and
 * country codes in src/products.ts.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ZERO_RECEIPT_HASH,
  countryToZoneKey,
  makeReceiptHash,
  productSlugToBarcode,
} from "./encode.js";

describe("productSlugToBarcode", () => {
  it("returns a 0x-prefixed 12-byte hex string", () => {
    const out = productSlugToBarcode("bread_500g");
    assert.match(out, /^0x[0-9a-f]{24}$/);
  });

  // Pinned vectors, independently verified against viem keccak256
  // and against Mercato's UI encoder. A failure here means aggregation
  // with on-chain UI submissions will silently break.
  it("matches the canonical Mercato slug vectors", () => {
    assert.equal(productSlugToBarcode("bread_500g"), "0xe13123198e56a93d3a8602eb");
    assert.equal(productSlugToBarcode("milk_1l"), "0xe4e2ca66d0e16a377ad0e920");
    assert.equal(productSlugToBarcode("eggs_12"), "0x08cade5555db6f90377f00b7");
  });

  it("is deterministic for the same slug", () => {
    const a = productSlugToBarcode("milk_1l");
    const b = productSlugToBarcode("milk_1l");
    assert.equal(a, b);
  });

  it("differs across slugs", () => {
    const bread = productSlugToBarcode("bread_500g");
    const milk = productSlugToBarcode("milk_1l");
    assert.notEqual(bread, milk);
  });

  it("rejects empty slugs", () => {
    assert.throws(() => productSlugToBarcode(""), /non-empty/);
  });
});

describe("countryToZoneKey", () => {
  it("encodes UA as ASCII U+A right-padded", () => {
    assert.equal(countryToZoneKey("UA"), "0x554100000000");
  });

  it("encodes GB as 0x474200000000", () => {
    assert.equal(countryToZoneKey("GB"), "0x474200000000");
  });

  it("encodes ES as 0x455300000000", () => {
    assert.equal(countryToZoneKey("ES"), "0x455300000000");
  });

  it("upcases lowercase input", () => {
    assert.equal(countryToZoneKey("ua"), "0x554100000000");
  });

  it("trims whitespace", () => {
    assert.equal(countryToZoneKey("  gb  "), "0x474200000000");
  });

  it("rejects non-2-letter codes", () => {
    assert.throws(() => countryToZoneKey("USA"), /expected 2 ASCII/);
    assert.throws(() => countryToZoneKey("U"), /expected 2 ASCII/);
    assert.throws(() => countryToZoneKey("12"), /expected 2 ASCII/);
  });
});

describe("makeReceiptHash", () => {
  it("returns a 32-byte 0x hash", () => {
    const out = makeReceiptHash("https://example.com", "2026-05-24T12:00:00Z");
    assert.match(out, /^0x[0-9a-f]{64}$/);
  });

  it("is deterministic for the same inputs", () => {
    const a = makeReceiptHash("https://x", "2026-05-24T12:00:00Z");
    const b = makeReceiptHash("https://x", "2026-05-24T12:00:00Z");
    assert.equal(a, b);
  });

  it("differs when the URL differs", () => {
    const a = makeReceiptHash("https://a", "2026-05-24T12:00:00Z");
    const b = makeReceiptHash("https://b", "2026-05-24T12:00:00Z");
    assert.notEqual(a, b);
  });

  it("differs from the zero hash for any real input", () => {
    const out = makeReceiptHash("https://x", "2026-05-24T12:00:00Z");
    assert.notEqual(out, ZERO_RECEIPT_HASH);
  });
});
