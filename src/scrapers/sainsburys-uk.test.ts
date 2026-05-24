import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  parsePrice,
  parseProductsFromHtml,
  parseSize,
} from "./sainsburys-uk.js";

describe("parseSize", () => {
  it("parses grams", () => {
    assert.equal(parseSize("Sainsbury's White Bread, 800g"), 800);
  });

  it("parses kilograms to grams", () => {
    assert.equal(parseSize("Cheddar Block 1.5 kg"), 1500);
  });

  it("parses millilitres", () => {
    assert.equal(parseSize("Sparkling Water 500ml"), 500);
  });

  it("parses litres to millilitres", () => {
    assert.equal(parseSize("Whole Milk 2L"), 2000);
  });

  it("parses pints to millilitres (UK imperial)", () => {
    assert.equal(parseSize("Whole Milk 4 pints"), 4 * 568);
    assert.equal(parseSize("Whole Milk 2 pints"), 2 * 568);
  });

  it("handles a decimal litre amount", () => {
    assert.equal(parseSize("Whole Milk 1.13L"), 1130);
  });

  it("returns null when nothing matches", () => {
    assert.equal(parseSize("Just some text"), null);
  });
});

describe("parsePrice", () => {
  it("parses a GBP price with pound symbol", () => {
    assert.equal(parsePrice("Was £1.50, now £0.85"), 1.5);
  });

  it("parses an integer pounds amount", () => {
    assert.equal(parsePrice("£10"), 10);
  });

  it("returns null when no price symbol", () => {
    assert.equal(parsePrice("Bread 800g"), null);
  });
});

describe("parseProductsFromHtml (JSON-LD path)", () => {
  it("extracts product blocks embedded as application/ld+json", () => {
    const html = `
      <html>
        <head>
          <script type="application/ld+json">
            {
              "@context": "https://schema.org",
              "@type": "Product",
              "name": "Sainsbury's British Whole Milk 4 pints (2.272L)",
              "url": "/gol-ui/product/sainsburys-british-whole-milk-4pints",
              "offers": { "@type": "Offer", "price": "1.85", "priceCurrency": "GBP" }
            }
          </script>
        </head>
        <body></body>
      </html>
    `;
    const out = parseProductsFromHtml(html);
    assert.equal(out.length, 1);
    assert.equal(out[0]!.priceMajor, 1.85);
    assert.equal(out[0]!.packSize, 2272); // 4 pints * 568
    assert.match(out[0]!.title, /Whole Milk/);
    assert.match(out[0]!.sourceUrl, /sainsburys-british-whole-milk-4pints$/);
  });

  it("walks nested ItemList payloads to find Product nodes", () => {
    const html = `
      <script type="application/ld+json">
        {
          "@type": "ItemList",
          "itemListElement": [
            {
              "@type": "Product",
              "name": "Sainsbury's White Bread 800g",
              "url": "/gol-ui/product/loaf-x",
              "offers": { "price": "0.85" }
            },
            {
              "@type": "Product",
              "name": "Sainsbury's Wholemeal Bread 800g",
              "url": "/gol-ui/product/loaf-y",
              "offers": { "price": "0.95" }
            }
          ]
        }
      </script>
    `;
    const out = parseProductsFromHtml(html);
    assert.equal(out.length, 2);
    const titles = out.map((p) => p.title).sort();
    assert.deepEqual(titles, [
      "Sainsbury's White Bread 800g",
      "Sainsbury's Wholemeal Bread 800g",
    ]);
  });

  it("falls back to anchor scraping when no JSON-LD is present", () => {
    const html = `
      <body>
        <a href="/gol-ui/product/sainsburys-white-bread-800g">
          <span>Sainsbury's White Bread, 800g</span>
          <span>£0.85</span>
        </a>
      </body>
    `;
    const out = parseProductsFromHtml(html);
    assert.equal(out.length, 1);
    assert.equal(out[0]!.priceMajor, 0.85);
    assert.equal(out[0]!.packSize, 800);
  });

  it("skips Product blocks with no parseable size", () => {
    const html = `
      <script type="application/ld+json">
        {
          "@type": "Product",
          "name": "Sainsbury's Mystery Item",
          "url": "/gol-ui/product/mystery",
          "offers": { "price": "1.00" }
        }
      </script>
    `;
    const out = parseProductsFromHtml(html);
    assert.equal(out.length, 0);
  });

  it("ignores malformed JSON-LD blocks", () => {
    const html = `
      <script type="application/ld+json">{ this is not json }</script>
      <script type="application/ld+json">
        {
          "@type": "Product",
          "name": "OK Bread 500g",
          "offers": { "price": "1.20" }
        }
      </script>
    `;
    const out = parseProductsFromHtml(html);
    assert.equal(out.length, 1);
    assert.equal(out[0]!.priceMajor, 1.2);
  });
});
