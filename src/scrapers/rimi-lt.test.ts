import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseSizeFromName } from "./rimi-lt.js";

describe("parseSizeFromName (rimi-lt)", () => {
  it("parses litres written as 1l to millilitres", () => {
    assert.deepEqual(parseSizeFromName("Pienas Šviežias 1l"), {
      value: 1000,
      unit: "ml",
    });
  });

  it("parses kilograms to grams", () => {
    assert.deepEqual(parseSizeFromName("Cukrus 1kg"), { value: 1000, unit: "g" });
  });

  it("parses explicit millilitres", () => {
    assert.deepEqual(parseSizeFromName("Vanduo 500 ml"), {
      value: 500,
      unit: "ml",
    });
  });

  it("parses grams", () => {
    assert.deepEqual(parseSizeFromName("Sviestas 200 g"), {
      value: 200,
      unit: "g",
    });
  });

  it("parses the Lithuanian vnt piece marker", () => {
    assert.deepEqual(parseSizeFromName("Kiaušiniai 10 vnt"), {
      value: 10,
      unit: "pcs",
    });
  });

  it("treats a trailing comma-kg as 1000 g loose produce", () => {
    assert.deepEqual(parseSizeFromName("Lietuviškos bulvės Gala, kg"), {
      value: 1000,
      unit: "g",
    });
  });

  it("returns null when the name carries no parseable size", () => {
    assert.equal(parseSizeFromName("Produktas be dydžio"), null);
  });
});
