import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseSizeFromName } from "./masxmenos-cr.js";

describe("parseSizeFromName (masxmenos-cr)", () => {
  it("parses litres to millilitres", () => {
    assert.deepEqual(parseSizeFromName("Leche Dos Pinos 1 L"), {
      value: 1000,
      unit: "ml",
    });
  });

  it("parses kilograms to grams", () => {
    assert.deepEqual(parseSizeFromName("Arroz Tio Pelon 1 Kg"), {
      value: 1000,
      unit: "g",
    });
  });

  it("treats a trailing bare X Kg as 1000 g loose produce", () => {
    assert.deepEqual(parseSizeFromName("Tomate Chonto X Kg"), {
      value: 1000,
      unit: "g",
    });
  });

  it("parses the egg carton piece count before the kilo phrase", () => {
    assert.deepEqual(parseSizeFromName("Huevo Gallina Cartón de 15 Uds"), {
      value: 15,
      unit: "pcs",
    });
  });

  it("treats a por kilo phrase as 1000 g", () => {
    assert.deepEqual(parseSizeFromName("Carne Molida De Res Por Kilo"), {
      value: 1000,
      unit: "g",
    });
  });

  it("parses grams", () => {
    assert.deepEqual(parseSizeFromName("Mantequilla Sin Sal 500 g"), {
      value: 500,
      unit: "g",
    });
  });

  it("parses the Unds piece marker", () => {
    assert.deepEqual(parseSizeFromName("Tortillas 12 Unds"), {
      value: 12,
      unit: "pcs",
    });
  });

  it("returns null when the name carries no parseable size", () => {
    assert.equal(parseSizeFromName("Producto Sin Tamaño"), null);
  });
});
// @coverage: happy-path + edge cases for masxmenos-cr
