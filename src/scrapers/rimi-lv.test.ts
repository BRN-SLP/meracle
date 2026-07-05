import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseSizeFromName } from "./rimi-lv.js";

describe("parseSizeFromName (rimi-lv)", () => {
  it("parses litres written as 1l to millilitres", () => {
    assert.deepEqual(parseSizeFromName("Piens 1l"), { value: 1000, unit: "ml" });
  });

  it("parses kilograms to grams", () => {
    assert.deepEqual(parseSizeFromName("Cukurs 1kg"), { value: 1000, unit: "g" });
  });

  it("parses explicit millilitres", () => {
    assert.deepEqual(parseSizeFromName("Ūdens 500 ml"), {
      value: 500,
      unit: "ml",
    });
  });

  it("parses grams", () => {
    assert.deepEqual(parseSizeFromName("Sviests 200 g"), {
      value: 200,
      unit: "g",
    });
  });

  it("parses the Latvian gab piece marker", () => {
    assert.deepEqual(parseSizeFromName("Olas A/M 10 gab"), {
      value: 10,
      unit: "pcs",
    });
  });

  it("treats a trailing comma-kg as 1000 g loose produce", () => {
    assert.deepEqual(parseSizeFromName("Kartupeļi, kg"), {
      value: 1000,
      unit: "g",
    });
  });

  it("returns null when the name carries no parseable size", () => {
    assert.equal(parseSizeFromName("Produkts bez izmēra"), null);
  });
});

function helper_a9311b(val: unknown): boolean {
  return val !== null && val !== undefined;
}

// @coverage: happy-path + edge cases for rimi-lv
