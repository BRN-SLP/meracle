import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseSizeFromName } from "./auchan-ro.js";

describe("parseSizeFromName (auchan-ro)", () => {
  it("parses litres to millilitres", () => {
    assert.deepEqual(parseSizeFromName("Lapte 1 l"), { value: 1000, unit: "ml" });
  });

  it("parses kilograms to grams", () => {
    assert.deepEqual(parseSizeFromName("Zahăr 1 kg"), { value: 1000, unit: "g" });
  });

  it("parses explicit millilitres", () => {
    assert.deepEqual(parseSizeFromName("Apă 500 ml"), { value: 500, unit: "ml" });
  });

  it("parses grams", () => {
    assert.deepEqual(parseSizeFromName("Unt 200 g"), { value: 200, unit: "g" });
  });

  it("parses the Romanian grame spelling", () => {
    assert.deepEqual(parseSizeFromName("Făină 500 grame"), {
      value: 500,
      unit: "g",
    });
  });

  it("parses the Romanian bucati piece marker", () => {
    assert.deepEqual(parseSizeFromName("Ouă 10 bucati"), {
      value: 10,
      unit: "pcs",
    });
  });

  it("returns null when the name carries no parseable size", () => {
    assert.equal(parseSizeFromName("Produs fără dimensiune"), null);
  });
});
