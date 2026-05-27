import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  decodeDataProductValue,
  extractCardsFromHtml,
  parseProductsFromCards,
  type ConadProductRaw,
} from "./conad-it.js";

/** Convenience: minimal valid card. */
function card(over: Partial<ConadProductRaw> = {}): ConadProductRaw {
  return {
    code: "12345",
    nome: "Conad Latte Intero UHT 1 L",
    netQuantity: 1,
    netQuantityUm: "LT",
    basePrice: 1.49,
    ...over,
  };
}

describe("parseProductsFromCards (unit conversion)", () => {
  it("converts LT (litres) to millilitres", () => {
    const out = parseProductsFromCards([card({ netQuantity: 1, netQuantityUm: "LT" })]);
    assert.equal(out.length, 1);
    assert.equal(out[0]!.packSize, 1000);
  });

  it("converts KG to grams", () => {
    const out = parseProductsFromCards([
      card({ netQuantity: 0.5, netQuantityUm: "KG", nome: "Burro 500 g" }),
    ]);
    assert.equal(out[0]!.packSize, 500);
  });

  it("keeps PZ (pieces) as-is", () => {
    const out = parseProductsFromCards([
      card({ netQuantity: 6, netQuantityUm: "PZ", nome: "6 Uova Fresche" }),
    ]);
    assert.equal(out[0]!.packSize, 6);
  });

  it("treats unknown units as pieces (pass-through fallback)", () => {
    const out = parseProductsFromCards([
      card({ netQuantity: 12, netQuantityUm: "CT", nome: "Confezione 12" }),
    ]);
    assert.equal(out[0]!.packSize, 12);
  });

  it("handles netQuantityUm with mixed case", () => {
    const out = parseProductsFromCards([
      card({ netQuantity: 1, netQuantityUm: "lt", nome: "Acqua 1L" }),
    ]);
    assert.equal(out[0]!.packSize, 1000);
  });

  it("handles fractional kilograms", () => {
    const out = parseProductsFromCards([
      card({ netQuantity: 1.5, netQuantityUm: "KG", nome: "Pomodori 1.5 kg" }),
    ]);
    assert.equal(out[0]!.packSize, 1500);
  });
});

describe("parseProductsFromCards (filtering)", () => {
  it("drops cards with basePrice === 0 (variable / ask-in-store)", () => {
    const out = parseProductsFromCards([card({ basePrice: 0 })]);
    assert.equal(out.length, 0);
  });

  it("drops cards with negative basePrice", () => {
    const out = parseProductsFromCards([card({ basePrice: -1 })]);
    assert.equal(out.length, 0);
  });

  it("drops cards with NaN basePrice", () => {
    const out = parseProductsFromCards([card({ basePrice: Number.NaN })]);
    assert.equal(out.length, 0);
  });

  it("drops cards with netQuantity === 0", () => {
    const out = parseProductsFromCards([card({ netQuantity: 0 })]);
    assert.equal(out.length, 0);
  });

  it("drops cards with NaN netQuantity", () => {
    const out = parseProductsFromCards([card({ netQuantity: Number.NaN })]);
    assert.equal(out.length, 0);
  });

  it("drops cards with empty code", () => {
    const out = parseProductsFromCards([card({ code: "" })]);
    assert.equal(out.length, 0);
  });

  it("drops cards with empty nome", () => {
    const out = parseProductsFromCards([card({ nome: "" })]);
    assert.equal(out.length, 0);
  });

  it("keeps cards with priceMajor > 0 and size > 0", () => {
    const out = parseProductsFromCards([
      card({ basePrice: 0.99, netQuantity: 1, netQuantityUm: "KG" }),
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0]!.priceMajor, 0.99);
    assert.equal(out[0]!.packSize, 1000);
  });
});

describe("parseProductsFromCards (sourceUrl construction)", () => {
  it("builds /prodotto/{slug}--{code} URL using BASE", () => {
    const out = parseProductsFromCards([
      card({ code: "98765", nome: "Conad Olio Extra Vergine Oliva 1 L" }),
    ]);
    assert.match(
      out[0]!.sourceUrl,
      /^https:\/\/spesaonline\.conad\.it\/prodotto\//,
    );
    assert.match(out[0]!.sourceUrl, /--98765$/);
  });

  it("slugifies nome (lowercase, hyphens, no special chars)", () => {
    const out = parseProductsFromCards([
      card({ code: "1", nome: "Pane d'Altamura 500 g & co." }),
    ]);
    const url = out[0]!.sourceUrl;
    // Slug should not contain apostrophes, ampersands, or uppercase
    assert.doesNotMatch(url, /['&A-Z]/);
    assert.match(url, /pane-d-altamura/);
  });

  it("respects custom baseUrl override", () => {
    const out = parseProductsFromCards(
      [card({ code: "777" })],
      "https://staging.example.com",
    );
    assert.match(out[0]!.sourceUrl, /^https:\/\/staging\.example\.com\//);
  });

  it("strips leading and trailing hyphens from the slug", () => {
    const out = parseProductsFromCards([
      card({ code: "1", nome: "  -- Special Edition --  " }),
    ]);
    // No `//` or `/-` adjacent to the code separator
    assert.doesNotMatch(out[0]!.sourceUrl, /\/-|--$/);
    assert.match(out[0]!.sourceUrl, /special-edition--1$/);
  });
});

describe("parseProductsFromCards (batch behaviour)", () => {
  it("returns an empty array on empty input", () => {
    assert.deepEqual(parseProductsFromCards([]), []);
  });

  it("preserves the order of valid cards", () => {
    const out = parseProductsFromCards([
      card({ code: "A", nome: "Latte A" }),
      card({ code: "B", nome: "Latte B" }),
      card({ code: "C", nome: "Latte C" }),
    ]);
    assert.deepEqual(
      out.map((p) => p.code),
      ["A", "B", "C"],
    );
  });

  it("skips invalid cards mid-batch without dropping valid ones", () => {
    const out = parseProductsFromCards([
      card({ code: "A" }),
      card({ code: "B", basePrice: 0 }), // dropped
      card({ code: "C" }),
    ]);
    assert.deepEqual(
      out.map((p) => p.code),
      ["A", "C"],
    );
  });
});

describe("decodeDataProductValue (HTML entity decoding)", () => {
  it("decodes the canonical Conad payload with &#34; entities", () => {
    const raw =
      "{&#34;code&#34;:&#34;365221&#34;,&#34;nome&#34;:&#34;Acqua Conad&#34;,&#34;netQuantity&#34;:1.5,&#34;netQuantityUm&#34;:&#34;LT&#34;,&#34;basePrice&#34;:0.29}";
    const out = decodeDataProductValue(raw);
    assert.ok(out);
    assert.equal(out.code, "365221");
    assert.equal(out.nome, "Acqua Conad");
    assert.equal(out.netQuantity, 1.5);
    assert.equal(out.netQuantityUm, "LT");
    assert.equal(out.basePrice, 0.29);
  });

  it("decodes &quot; entities (alternate encoding)", () => {
    const raw =
      "{&quot;code&quot;:&quot;1&quot;,&quot;nome&quot;:&quot;Test&quot;,&quot;netQuantity&quot;:1,&quot;netQuantityUm&quot;:&quot;KG&quot;,&quot;basePrice&quot;:1}";
    const out = decodeDataProductValue(raw);
    assert.ok(out);
    assert.equal(out.code, "1");
  });

  it("decodes &#39; and &amp; entities inside the payload", () => {
    const raw =
      "{&#34;code&#34;:&#34;1&#34;,&#34;nome&#34;:&#34;Pane d&#39;Altamura &amp; co.&#34;,&#34;netQuantity&#34;:1,&#34;netQuantityUm&#34;:&#34;KG&#34;,&#34;basePrice&#34;:2}";
    const out = decodeDataProductValue(raw);
    assert.ok(out);
    assert.equal(out.nome, "Pane d'Altamura & co.");
  });

  it("returns null on malformed JSON", () => {
    const out = decodeDataProductValue("not json");
    assert.equal(out, null);
  });

  it("returns null when required fields are missing", () => {
    // missing basePrice
    const raw =
      "{&#34;code&#34;:&#34;1&#34;,&#34;nome&#34;:&#34;X&#34;,&#34;netQuantity&#34;:1,&#34;netQuantityUm&#34;:&#34;KG&#34;}";
    assert.equal(decodeDataProductValue(raw), null);
  });

  it("returns null when basePrice is a string instead of number", () => {
    const raw =
      "{&#34;code&#34;:&#34;1&#34;,&#34;nome&#34;:&#34;X&#34;,&#34;netQuantity&#34;:1,&#34;netQuantityUm&#34;:&#34;KG&#34;,&#34;basePrice&#34;:&#34;1&#34;}";
    assert.equal(decodeDataProductValue(raw), null);
  });
});

describe("extractCardsFromHtml (HTML scanning)", () => {
  it("pulls multiple data-product attributes out of a single document", () => {
    const html = `<html><body>
      <div data-product="{&#34;code&#34;:&#34;A&#34;,&#34;nome&#34;:&#34;Latte&#34;,&#34;netQuantity&#34;:1,&#34;netQuantityUm&#34;:&#34;LT&#34;,&#34;basePrice&#34;:0.99}">x</div>
      <div data-product="{&#34;code&#34;:&#34;B&#34;,&#34;nome&#34;:&#34;Burro&#34;,&#34;netQuantity&#34;:0.25,&#34;netQuantityUm&#34;:&#34;KG&#34;,&#34;basePrice&#34;:2.49}">y</div>
    </body></html>`;
    const out = extractCardsFromHtml(html);
    assert.equal(out.length, 2);
    assert.equal(out[0]!.code, "A");
    assert.equal(out[1]!.code, "B");
  });

  it("returns an empty array when the document has no cards", () => {
    assert.deepEqual(extractCardsFromHtml("<html><body>nothing</body></html>"), []);
  });

  it("silently drops cards that fail to decode", () => {
    const html = `<div data-product="not-json"></div>
      <div data-product="{&#34;code&#34;:&#34;A&#34;,&#34;nome&#34;:&#34;Latte&#34;,&#34;netQuantity&#34;:1,&#34;netQuantityUm&#34;:&#34;LT&#34;,&#34;basePrice&#34;:1}"></div>`;
    const out = extractCardsFromHtml(html);
    assert.equal(out.length, 1);
    assert.equal(out[0]!.code, "A");
  });

  it("captures cards with basePrice 0 (parseProductsFromCards drops them)", () => {
    // The extractor stays faithful to the raw HTML; basePrice filtering
    // is the parser's job. Validates that the seam is clean.
    const html = `<div data-product="{&#34;code&#34;:&#34;A&#34;,&#34;nome&#34;:&#34;X&#34;,&#34;netQuantity&#34;:1,&#34;netQuantityUm&#34;:&#34;KG&#34;,&#34;basePrice&#34;:0}"></div>`;
    const out = extractCardsFromHtml(html);
    assert.equal(out.length, 1);
    assert.equal(out[0]!.basePrice, 0);
  });
});
