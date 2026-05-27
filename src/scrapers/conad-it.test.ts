import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
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
