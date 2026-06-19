import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseSizeFromTitle } from "./auchan-ua.js";

describe("parseSizeFromTitle (auchan-ua)", () => {
  it("parses the pcs marker on egg cartons", () => {
    assert.equal(parseSizeFromTitle("Chicken Eggs C0 12pcs"), 12);
  });

  it("parses kilograms to grams", () => {
    assert.equal(parseSizeFromTitle("White Crystalline Sugar 1kg"), 1000);
  });

  it("parses grams without conversion", () => {
    assert.equal(parseSizeFromTitle("Sweet Cream Butter 82% 200g"), 200);
  });

  it("parses millilitres without conversion", () => {
    assert.equal(parseSizeFromTitle("Still Water 500ml"), 500);
  });

  it("parses litres to millilitres", () => {
    assert.equal(parseSizeFromTitle("Still Mineral Water 1.5 L"), 1500);
  });

  it("parses a comma-decimal litre", () => {
    assert.equal(parseSizeFromTitle("Olive Oil Extra Virgin 0,5 L"), 500);
  });

  it("returns null when the title carries no size", () => {
    assert.equal(parseSizeFromTitle("White Potatoes"), null);
  });
});
