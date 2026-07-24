import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseSizeFromName } from "./dia-ar.js";

describe("parseSizeFromName (dia-ar)", () => {
  it("parses litres written as 1l to millilitres", () => {
    assert.deepEqual(parseSizeFromName("Leche Entera Bot 1l"), {
      value: 1000,
      unit: "ml",
    });
  });

  it("parses a comma-decimal litre amount in Lts", () => {
    assert.deepEqual(parseSizeFromName("Agua Sin Gas 1,5 Lts"), {
      value: 1500,
      unit: "ml",
    });
  });

  it("parses explicit millilitres", () => {
    assert.deepEqual(parseSizeFromName("Aceite 250 Ml"), {
      value: 250,
      unit: "ml",
    });
  });

  it("parses kilograms to grams", () => {
    assert.deepEqual(parseSizeFromName("Arroz 1kg"), { value: 1000, unit: "g" });
  });

  it("parses grams written as Grs", () => {
    assert.deepEqual(parseSizeFromName("Manteca 200 Grs"), {
      value: 200,
      unit: "g",
    });
  });

  it("parses pieces written as Un", () => {
    assert.deepEqual(parseSizeFromName("Huevos 12 Un"), {
      value: 12,
      unit: "pcs",
    });
  });

  it("returns null when the name carries no parseable size", () => {
    assert.equal(parseSizeFromName("Banana Por Kg"), null);
  });
});


// @coverage: happy-path + edge cases for dia-ar
