import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  parsePrice,
  parseProductsFromHtml,
  parseSize,
} from "./carrefour-fr.js";

describe("parseSize (carrefour-fr)", () => {
  it("parses grams", () => {
    assert.equal(parseSize("Beurre doux 250 g"), 250);
  });

  it("parses kilograms to grams", () => {
    assert.equal(parseSize("Riz long 1 kg"), 1000);
  });

  it("parses millilitres", () => {
    assert.equal(parseSize("Sauce 500 ml"), 500);
  });

  it("parses litres to millilitres", () => {
    assert.equal(parseSize("Lait entier 1 L"), 1000);
    assert.equal(parseSize("Eau 2L"), 2000);
  });

  it("parses centilitres (French beverage measure) to millilitres", () => {
    assert.equal(parseSize("Heineken 33 cl"), 330);
    assert.equal(parseSize("Bière 50cL"), 500);
  });

  it("handles a comma-decimal litre amount", () => {
    assert.equal(parseSize("Eau de source 1,5 L"), 1500);
  });

  it("parses Carrefour multi-pack 6x1l as the aggregate volume", () => {
    assert.equal(parseSize("Acheter 6x1l"), 6000);
  });

  it("parses multi-pack with whitespace and grams", () => {
    assert.equal(parseSize("Pack 4 x 500g"), 2000);
  });

  it("parses multi-pack centilitres", () => {
    assert.equal(parseSize("Cristaline 2x33cl"), 660);
  });

  it("recognises piece count with œ ligature (œufs)", () => {
    assert.equal(parseSize("CARREFOUR BIO 6 Œufs Plein Air"), 6);
    assert.equal(parseSize("12 œufs frais"), 12);
  });

  it("recognises piece count with ASCII oeufs", () => {
    assert.equal(parseSize("Acheter 6 oeufs"), 6);
    assert.equal(parseSize("12 oeufs"), 12);
  });

  it("parses Boîte de N for piece-counted goods", () => {
    assert.equal(parseSize("Boîte de 10"), 10);
    assert.equal(parseSize("Pack de 12"), 12);
  });

  it("returns null when nothing matches", () => {
    assert.equal(parseSize("Just some text"), null);
  });
});

describe("parsePrice (carrefour-fr)", () => {
  it("parses a French comma-decimal price", () => {
    assert.equal(parsePrice("1,99 €"), 1.99);
  });

  it("parses a dot-decimal price", () => {
    assert.equal(parsePrice("1.99 €"), 1.99);
  });

  it("parses a thin-space Carrefour DOM-textContent price", () => {
    // Carrefour renders `1,10 €` as four nodes joined by spaces:
    // "1" + " " + ",10" + " " + "€" -> "1 ,10 €" after textContent
    assert.equal(parsePrice("1 ,10 €"), 1.1);
    assert.equal(parsePrice("7 ,50 €"), 7.5);
    assert.equal(parsePrice("13 ,99 €"), 13.99);
  });

  it("parses an integer euro amount", () => {
    assert.equal(parsePrice("12 €"), 12);
  });

  it("returns null when no euro symbol is present", () => {
    assert.equal(parsePrice("Pain 800g"), null);
  });

  it("returns the first € match (pack price before unit price)", () => {
    // Live Carrefour card layout: pack price comes first, unit price
    // (per kg / per L) comes second. The picker wants the pack price.
    assert.equal(
      parsePrice("(35) 1 ,10 € 1.10 € / L Acheter 1l"),
      1.1,
    );
  });
});

describe("parseProductsFromHtml (carrefour-fr, JSON-LD path)", () => {
  it("extracts a Product block when present", () => {
    const html = `
      <html>
        <head>
          <script type="application/ld+json">
            {
              "@context": "https://schema.org",
              "@type": "Product",
              "name": "Carrefour Classic Lait Entier UHT 1 L",
              "url": "/p/lait-entier-uht-carrefour-classic-3560071457389",
              "offers": { "@type": "Offer", "price": "1.10", "priceCurrency": "EUR" }
            }
          </script>
        </head>
        <body></body>
      </html>
    `;
    const out = parseProductsFromHtml(html);
    assert.equal(out.length, 1);
    assert.equal(out[0]!.priceMajor, 1.1);
    assert.equal(out[0]!.packSize, 1000);
    assert.match(out[0]!.title, /Lait Entier/);
    assert.match(
      out[0]!.sourceUrl,
      /lait-entier-uht-carrefour-classic-3560071457389$/,
    );
  });

  it("returns an empty array when no JSON-LD is present (the live FR PLP case)", () => {
    // The live Carrefour PLP carries only WebSite + BreadcrumbList LD,
    // so this parser is expected to no-op for real search pages.
    // The DOM walk in scrapeOneSearch handles the actual extraction.
    const html = `<html><body><a href="/p/lait-1l">Carrefour 1 ,10 € Acheter 1l</a></body></html>`;
    assert.equal(parseProductsFromHtml(html).length, 0);
  });

  it("ignores malformed JSON-LD blocks", () => {
    const html = `
      <script type="application/ld+json">{ not valid json </script>
    `;
    assert.equal(parseProductsFromHtml(html).length, 0);
  });

  it("skips Product blocks with no parseable size in the name", () => {
    const html = `
      <script type="application/ld+json">
        {
          "@type": "Product",
          "name": "Carrefour Tartine Sans Mention de Taille",
          "url": "/p/no-size",
          "offers": { "price": "2.50" }
        }
      </script>
    `;
    assert.equal(parseProductsFromHtml(html).length, 0);
  });
});
// @coverage: happy-path + edge cases for carrefour-fr
