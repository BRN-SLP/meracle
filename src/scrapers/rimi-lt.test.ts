import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseSizeFromName } from "./rimi-lt.js";

describe("parseSizeFromName (rimi-lt)", () => {
  it("parses litres written as 1l to millilitres", () => {
    assert.deepEqual(parseSizeFromName("Pienas Dvaro 1l"), {
      value: 1000,
      unit: "ml",
    });
  });

  it("parses comma-decimal litres common in Lithuanian titles", () => {
    assert.deepEqual(parseSizeFromName("Vanduo Akvile negaz. 1,5l"), {
      value: 1500,
      unit: "ml",
    });
  });

  it("parses kilograms to grams", () => {
    assert.deepEqual(parseSizeFromName("Cukrus baltas 1kg"), {
      value: 1000,
      unit: "g",
    });
  });

  it("parses explicit millilitres", () => {
    assert.deepEqual(parseSizeFromName("Vanduo Neptunas 500 ml"), {
      value: 500,
      unit: "ml",
    });
  });

  it("parses the gr gram variant", () => {
    assert.deepEqual(parseSizeFromName("Suris Tilzes 250gr"), {
      value: 250,
      unit: "g",
    });
  });

  it("parses the Lithuanian vnt piece marker", () => {
    assert.deepEqual(parseSizeFromName("Kiausiniai M/L 10 vnt."), {
      value: 10,
      unit: "pcs",
    });
  });

  it("treats a comma-kg produce trailer as 1000 g loose produce", () => {
    assert.deepEqual(parseSizeFromName("Lietuviskos bulves Gala, kg"), {
      value: 1000,
      unit: "g",
    });
  });

  it("treats a trailing word-kg as 1000 g loose produce", () => {
    assert.deepEqual(parseSizeFromName("Smulkinta jautiena RIMI kg"), {
      value: 1000,
      unit: "g",
    });
  });

  it("treats the 1kl,1kg shelf marker as 1000 g loose produce", () => {
    assert.deepEqual(parseSizeFromName("Raudonieji pomidorai 1kl,1kg"), {
      value: 1000,
      unit: "g",
    });
  });

  it("returns null when the name carries no parseable size", () => {
    assert.equal(parseSizeFromName("Preke be dydzio"), null);
  });
});
