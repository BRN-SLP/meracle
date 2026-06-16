import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  extractInitialState,
  parseProduct,
  parseSize,
  type AuchanProduct,
} from "./auchan-pl.js";

describe("parseSize (auchan-pl)", () => {
  it("parses kilograms to grams", () => {
    assert.deepEqual(parseSize("1kg"), { value: 1000, unit: "g" });
    assert.deepEqual(parseSize("0.4kg"), { value: 400, unit: "g" });
    assert.deepEqual(parseSize("1,5kg"), { value: 1500, unit: "g" });
  });

  it("parses grams", () => {
    assert.deepEqual(parseSize("500g"), { value: 500, unit: "g" });
  });

  it("parses litres and millilitres", () => {
    assert.deepEqual(parseSize("1l"), { value: 1000, unit: "ml" });
    assert.deepEqual(parseSize("1.5L"), { value: 1500, unit: "ml" });
    assert.deepEqual(parseSize("330ml"), { value: 330, unit: "ml" });
  });

  it("parses piece counts including the na paczke egg encoding", () => {
    assert.deepEqual(parseSize("12szt"), { value: 12, unit: "pcs" });
    assert.deepEqual(parseSize("10 na paczkę"), { value: 10, unit: "pcs" });
  });

  it("rejects loose-produce ranges and junk", () => {
    assert.equal(parseSize("450g - 99999g"), null);
    assert.equal(parseSize("abc"), null);
    assert.equal(parseSize(""), null);
  });
});

const baseProduct: AuchanProduct = {
  productId: "p1",
  retailerProductId: "r1",
  brand: "Auchan",
  name: "Mleko UHT 3.2% 1 l",
  size: { value: "1l" },
  price: { current: { amount: "2.98", currency: "PLN" } },
  available: true,
  alcohol: false,
};

describe("parseProduct (auchan-pl)", () => {
  it("maps a valid entity to the working shape", () => {
    const out = parseProduct(baseProduct);
    assert.ok(out);
    assert.equal(out.packSize, 1000);
    assert.equal(out.packUnit, "ml");
    assert.equal(out.priceMajor, 2.98);
  });

  it("rejects an out-of-stock zero-price entity", () => {
    const out = parseProduct({
      ...baseProduct,
      price: { current: { amount: "0.00", currency: "PLN" } },
    });
    assert.equal(out, null);
  });

  it("rejects an entity with no parseable size", () => {
    assert.equal(parseProduct({ ...baseProduct, size: undefined }), null);
  });

  it("promotes a bare-number size via the per-kg unit label", () => {
    const out = parseProduct({
      ...baseProduct,
      name: "Banany luz",
      size: { value: "1.2" },
      price: {
        current: { amount: "5.98", currency: "PLN" },
        unit: {
          label: "fop.price.per.kg",
          current: { amount: "4.98", currency: "PLN" },
        },
      },
    });
    assert.ok(out);
    assert.equal(out.packSize, 1200);
    assert.equal(out.packUnit, "g");
  });
});

describe("extractInitialState (auchan-pl)", () => {
  it("extracts the SSR blob with string-aware balanced braces", () => {
    const html = `<script>window.__INITIAL_STATE__ = {"data":{"x":1,"s":"}{"}};</script>`;
    const state = extractInitialState(html) as { data?: { x?: number } };
    assert.equal(state?.data?.x, 1);
  });

  it("returns null when the marker is absent", () => {
    assert.equal(extractInitialState("<html>no blob</html>"), null);
  });

  it("returns null on malformed json", () => {
    assert.equal(extractInitialState("window.__INITIAL_STATE__ = {bad"), null);
  });
});
