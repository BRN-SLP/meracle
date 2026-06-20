import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { decodeHtmlEntities, parseSizeFromEmb } from "./continente-pt.js";

describe("decodeHtmlEntities (continente-pt)", () => {
  it("decodes decimal numeric entities", () => {
    assert.equal(decodeHtmlEntities("caf&#233;"), "café");
  });

  it("decodes hex numeric entities (case-insensitive)", () => {
    assert.equal(decodeHtmlEntities("caf&#xe9;"), "café");
    assert.equal(decodeHtmlEntities("caf&#xE9;"), "café");
  });

  it("decodes the curated Portuguese named entities", () => {
    assert.equal(decodeHtmlEntities("p&atilde;o"), "pão");
    assert.equal(decodeHtmlEntities("a&ccedil;ucar"), "açucar");
    assert.equal(decodeHtmlEntities("&quot;leite&quot; &amp; ovos"), '"leite" & ovos');
  });

  it("passes unknown named entities through unchanged", () => {
    assert.equal(decodeHtmlEntities("a&unknown;b"), "a&unknown;b");
  });

  it("leaves plain text untouched", () => {
    assert.equal(decodeHtmlEntities("Leite UHT 1L"), "Leite UHT 1L");
  });
});

describe("parseSizeFromEmb (continente-pt)", () => {
  it("parses litres to millilitres", () => {
    assert.deepEqual(parseSizeFromEmb("emb. 1 Lt"), { value: 1000, unit: "ml" });
    assert.deepEqual(parseSizeFromEmb("emb. 1.5 Lt"), { value: 1500, unit: "ml" });
  });

  it("parses millilitres directly", () => {
    assert.deepEqual(parseSizeFromEmb("emb. 230 ml"), { value: 230, unit: "ml" });
  });

  it("parses centilitres to millilitres", () => {
    assert.deepEqual(parseSizeFromEmb("emb. 33 cl"), { value: 330, unit: "ml" });
  });

  it("parses kilograms and grams to grams", () => {
    assert.deepEqual(parseSizeFromEmb("emb. 1 Kg"), { value: 1000, unit: "g" });
    assert.deepEqual(parseSizeFromEmb("emb. 500 g"), { value: 500, unit: "g" });
  });

  it("parses unit counts to pieces", () => {
    assert.deepEqual(parseSizeFromEmb("emb. 12 Un"), { value: 12, unit: "pcs" });
  });

  it("expands a multi-pack by multiplying the factors", () => {
    assert.deepEqual(parseSizeFromEmb("emb. 4 x 200 ml"), { value: 800, unit: "ml" });
    assert.deepEqual(parseSizeFromEmb("emb. 6 x 33 cl"), { value: 1980, unit: "ml" });
  });

  it("accepts comma decimals", () => {
    assert.deepEqual(parseSizeFromEmb("1,5 Lt"), { value: 1500, unit: "ml" });
  });

  it("returns null for free-text or empty labels", () => {
    assert.equal(parseSizeFromEmb("a granel"), null);
    assert.equal(parseSizeFromEmb(""), null);
  });
});
// @coverage: happy-path + edge cases for continente-pt
