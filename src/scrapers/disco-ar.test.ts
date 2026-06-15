import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  parseProduct,
  parseSizeFromName,
  type DiscoProduct,
} from "./disco-ar.js";

describe("parseSizeFromName (disco-ar)", () => {
  it("parses litres written as 1l to millilitres", () => {
    assert.deepEqual(parseSizeFromName("Leche La Serenisima Entera Bot 1l"), {
      value: 1000,
      unit: "ml",
    });
  });

  it("parses a comma-decimal litre amount in Lts", () => {
    assert.deepEqual(parseSizeFromName("Agua Mineral Sin Gas 1,5 Lts"), {
      value: 1500,
      unit: "ml",
    });
  });

  it("parses explicit millilitres", () => {
    assert.deepEqual(parseSizeFromName("Aceite de Oliva 250 Ml Cocinero"), {
      value: 250,
      unit: "ml",
    });
  });

  it("parses cc as millilitres", () => {
    assert.deepEqual(parseSizeFromName("Gaseosa Cola 591 Cc"), {
      value: 591,
      unit: "ml",
    });
  });

  it("parses kilograms to grams", () => {
    assert.deepEqual(parseSizeFromName("Arroz Doble Dos Hermanos 1kg"), {
      value: 1000,
      unit: "g",
    });
  });

  it("parses grams written as Grs", () => {
    assert.deepEqual(
      parseSizeFromName("Manteca Clasica 200 Grs La Serenisima"),
      { value: 200, unit: "g" },
    );
  });

  it("parses pieces written as Un", () => {
    assert.deepEqual(parseSizeFromName("Huevos Blancos 12 Un Cuisine & Co"), {
      value: 12,
      unit: "pcs",
    });
  });

  it("returns null when the name carries no parseable size", () => {
    assert.equal(parseSizeFromName("Banana Ecuatoriana Por Kg"), null);
  });
});

describe("parseProduct (disco-ar)", () => {
  function make(
    productName: string,
    item: Record<string, unknown>,
  ): DiscoProduct {
    return {
      productId: "p1",
      productName,
      items: [item],
    } as unknown as DiscoProduct;
  }
  const seller = (price: number) => ({ commertialOffer: { Price: price } });

  it("hardwires kg-measurement produce to 1000 g", () => {
    const out = parseProduct(
      make("Banana Por Kg", {
        itemId: "1",
        measurementUnit: "kg",
        unitMultiplier: 0.1,
        sellers: [seller(1999)],
      }),
    );
    assert.equal(out?.packSize, 1000);
    assert.equal(out?.packUnit, "g");
    assert.equal(out?.priceMajor, 1999);
  });

  it("parses the pack size from the name for un-measurement products", () => {
    const out = parseProduct(
      make("Leche Entera 1 L", {
        itemId: "2",
        measurementUnit: "un",
        unitMultiplier: 1,
        sellers: [seller(1500)],
      }),
    );
    assert.equal(out?.packSize, 1000);
    assert.equal(out?.packUnit, "ml");
  });

  it("returns null when an un-measurement product has no parseable size", () => {
    const out = parseProduct(
      make("Leche Entera Sachet", {
        itemId: "3",
        measurementUnit: "un",
        unitMultiplier: 1,
        sellers: [seller(1500)],
      }),
    );
    assert.equal(out, null);
  });

  it("returns null when the default seller price is zero", () => {
    const out = parseProduct(
      make("Leche Entera 1 L", {
        itemId: "4",
        measurementUnit: "un",
        unitMultiplier: 1,
        sellers: [seller(0)],
      }),
    );
    assert.equal(out, null);
  });
});
