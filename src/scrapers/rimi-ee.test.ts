import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseSizeFromName } from "./rimi-ee.js";

describe("parseSizeFromName (rimi-ee)", () => {
  it("parses litres written as 1l to millilitres", () => {
    assert.deepEqual(parseSizeFromName("Piim Rasvane 1l"), {
      value: 1000,
      unit: "ml",
    });
  });

  it("parses kilograms to grams", () => {
    assert.deepEqual(parseSizeFromName("Suhkur 1kg"), { value: 1000, unit: "g" });
  });

  it("parses explicit millilitres", () => {
    assert.deepEqual(parseSizeFromName("Vesi 500 ml"), { value: 500, unit: "ml" });
  });

  it("parses grams", () => {
    assert.deepEqual(parseSizeFromName("Voi 500 g"), { value: 500, unit: "g" });
  });

  it("parses the Estonian tk piece marker", () => {
    assert.deepEqual(parseSizeFromName("Munad 10 tk"), {
      value: 10,
      unit: "pcs",
    });
  });

  it("treats a trailing comma-kg as 1000 g loose produce", () => {
    assert.deepEqual(parseSizeFromName("Kartul, kg Eesti"), {
      value: 1000,
      unit: "g",
    });
  });

  it("returns null when the name carries no parseable size", () => {
    assert.equal(parseSizeFromName("Toode Ilma Suuruseta"), null);
  });
});
