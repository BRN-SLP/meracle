import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseSizeFromName } from "./migros-tr.js";

describe("parseSizeFromName (migros-tr)", () => {
  it("parses litres to millilitres", () => {
    assert.deepEqual(parseSizeFromName("Süt 1 L"), { value: 1000, unit: "ml" });
  });

  it("parses kilograms to grams", () => {
    assert.deepEqual(parseSizeFromName("Un 1 kg"), { value: 1000, unit: "g" });
  });

  it("treats a trailing bare Kg as 1000 g loose produce", () => {
    assert.deepEqual(parseSizeFromName("Muz Yerli Kg"), {
      value: 1000,
      unit: "g",
    });
  });

  it("parses explicit millilitres", () => {
    assert.deepEqual(parseSizeFromName("Su 500 ml"), { value: 500, unit: "ml" });
  });

  it("parses grams", () => {
    assert.deepEqual(parseSizeFromName("Tereyağı 200 g"), {
      value: 200,
      unit: "g",
    });
  });

  it("parses the Turkish 'li piece marker", () => {
    assert.deepEqual(parseSizeFromName("Yumurta 15'li"), {
      value: 15,
      unit: "pcs",
    });
  });

  it("parses the Turkish adet piece marker", () => {
    assert.deepEqual(parseSizeFromName("Yumurta 30 Adet"), {
      value: 30,
      unit: "pcs",
    });
  });

  it("returns null when the name carries no parseable size", () => {
    assert.equal(parseSizeFromName("Ürün Açıklamasız"), null);
  });
});
// @coverage: happy-path + edge cases for migros-tr
