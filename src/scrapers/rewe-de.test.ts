import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseProduct, parseSizeFromName } from "./rewe-de.js";

describe("parseSizeFromName (German grammage)", () => {
  it("parses ' 1l' as 1000 mL", () => {
    assert.equal(parseSizeFromName("Hemme Frische Vollmilch 3,7% 1l"), 1000);
  });

  it("parses ' 1L' uppercase as 1000 mL", () => {
    assert.equal(parseSizeFromName("REWE Bio Vollmilch 1L"), 1000);
  });

  it("parses ' 1,5l' (German decimal comma) as 1500 mL", () => {
    assert.equal(parseSizeFromName("Vio Mineralwasser Naturelle 1,5l"), 1500);
  });

  it("parses ' 1.5l' (decimal dot) as 1500 mL", () => {
    assert.equal(parseSizeFromName("Volvic Naturelle 1.5l"), 1500);
  });

  it("parses ' 500ml' as 500 mL", () => {
    assert.equal(parseSizeFromName("Heineken 500ml Dose"), 500);
  });

  it("parses ' 1kg' as 1000 g", () => {
    assert.equal(parseSizeFromName("Diamant Zucker 1kg"), 1000);
  });

  it("parses ' 500g' as 500 g", () => {
    assert.equal(parseSizeFromName("REWE Beste Wahl Goudablock 500g"), 500);
  });

  it("parses ' 0,5 kg' (German comma plus space) as 500 g", () => {
    assert.equal(parseSizeFromName("Reis Spitzen 0,5 kg Conad"), 500);
  });

  it("parses ' 12er' as 12 pieces", () => {
    assert.equal(parseSizeFromName("Eier Bio 12er Pack"), 12);
  });

  it("parses ' 12 Stück' as 12 pieces", () => {
    assert.equal(parseSizeFromName("Frische Eier 12 Stück"), 12);
  });

  it("returns null when no size token present", () => {
    assert.equal(parseSizeFromName("Some product name"), null);
  });

  it("prefers litre token over gram token when both present", () => {
    // German label conventions: percentage comes before size; e.g.
    // "3,7% 1l" should resolve to 1000 mL, not 0.7 grams.
    assert.equal(parseSizeFromName("Vollmilch 3,7% 1l"), 1000);
  });
});

describe("parseProduct (REWE API article shape)", () => {
  it("returns null when articles is missing or empty", () => {
    assert.equal(
      parseProduct({ id: "1", productName: "X 1l", _embedded: { articles: [] } }),
      null,
    );
    assert.equal(parseProduct({ id: "1", productName: "X 1l" }), null);
  });

  it("returns null when pricing is missing on the first article", () => {
    assert.equal(
      parseProduct({
        id: "1",
        productName: "X 1l",
        _embedded: { articles: [{}] },
      }),
      null,
    );
  });

  it("uses currentRetailPrice when present", () => {
    const p = parseProduct({
      id: "1042422",
      productName: "Hemme Frische Vollmilch 3,7% 1l",
      _embedded: {
        articles: [{ pricing: { currentRetailPrice: 1.49 } }],
      },
      _links: { detail: { href: "/p/hemme-milch/1042422" } },
    });
    assert.ok(p);
    assert.equal(p.priceMajor, 1.49);
    assert.equal(p.packSize, 1000);
    assert.equal(p.title, "Hemme Frische Vollmilch 3,7% 1l");
    assert.equal(p.sourceUrl, "https://shop.rewe.de/p/hemme-milch/1042422");
  });

  it("falls back to integer cents price/100 when currentRetailPrice missing", () => {
    const p = parseProduct({
      id: "1",
      productName: "REWE Beste Wahl Goudablock 500g",
      _embedded: { articles: [{ pricing: { price: 299 } }] },
    });
    assert.ok(p);
    assert.equal(p.priceMajor, 2.99);
    assert.equal(p.packSize, 500);
  });

  it("falls back to constructed /p/<id> link when detail href absent", () => {
    const p = parseProduct({
      id: "555",
      productName: "Test 1l",
      _embedded: {
        articles: [{ pricing: { currentRetailPrice: 1 } }],
      },
    });
    assert.ok(p);
    assert.equal(p.sourceUrl, "https://shop.rewe.de/p/555");
  });

  it("returns null when title cannot be parsed for a size", () => {
    const p = parseProduct({
      id: "1",
      productName: "No size in name",
      _embedded: {
        articles: [{ pricing: { currentRetailPrice: 1 } }],
      },
    });
    assert.equal(p, null);
  });
});
// @coverage: happy-path + edge cases for rewe-de
