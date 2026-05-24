import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, it } from "node:test";

import { normalize } from "../normalize.js";
import { scrapeFromFixture } from "./mercadona-es.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.resolve(__dirname, "../../tests/fixtures");

async function loadFixture(filename: string): Promise<unknown> {
  const raw = await readFile(path.join(FIXTURES_DIR, filename), "utf8");
  return JSON.parse(raw);
}

describe("Mercadona ES scraper, fixture path", async () => {
  const cat60 = (await loadFixture("mercadona-pan-de-molde-cat60.json")) as never;
  const cat72 = (await loadFixture("mercadona-leche-cat72.json")) as never;

  const result = scrapeFromFixture(
    { 60: cat60, 72: cat72 },
    "2026-05-24T12:00:00.000Z",
  );

  it("returns the mercadona-es retailer key", () => {
    assert.equal(result.retailer, "mercadona-es");
  });

  it("scrapes both bread_500g and milk_1l", () => {
    // Fixture only carries Phase 1 categories (60 + 72). Pickers for
    // eggs (77), butter (75), sugar (89), and rice (118) live in the
    // scraper but their categories aren't preloaded here, so they
    // surface as "category not loaded" misses. Test scope is just the
    // Phase 1 staples, live runs validate the rest until richer
    // fixtures land.
    const phase1Misses = result.misses.filter(
      (m) => m.target.slug === "bread_500g" || m.target.slug === "milk_1l",
    );
    assert.equal(phase1Misses.length, 0, JSON.stringify(phase1Misses));
    const phase1Slugs = result.scraped
      .map((s) => s.target.slug)
      .filter((s) => s === "bread_500g" || s === "milk_1l")
      .sort();
    assert.deepEqual(phase1Slugs, ["bread_500g", "milk_1l"]);
  });

  it("picks a Pan de molde blanco (white sliced bread) loaf", () => {
    const bread = result.scraped.find((s) => s.target.slug === "bread_500g");
    assert.ok(bread, "bread missing");
    assert.match(bread.retailerTitle, /Pan de molde blanco/i);
    assert.doesNotMatch(bread.retailerTitle, /integral|sin corteza|familiar/i);
    assert.ok(bread.packSize >= 300 && bread.packSize <= 700);
  });

  it("picks Leche entera (whole milk) in 800-1100 mL band", () => {
    const milk = result.scraped.find((s) => s.target.slug === "milk_1l");
    assert.ok(milk, "milk missing");
    assert.match(milk.retailerTitle, /Leche entera/i);
    assert.doesNotMatch(milk.retailerTitle, /sin lactosa|infantil|chocolate/i);
    assert.ok(milk.packSize >= 800 && milk.packSize <= 1100);
  });

  it("normalizes each scrape to an in-band priceCents", () => {
    for (const s of result.scraped) {
      const obs = normalize(s);
      assert.ok(obs.priceCents > 0);
      const major = obs.priceCents / 100;
      const { minMajor, maxMajor } = s.target.sanityRange;
      assert.ok(
        major >= minMajor && major <= maxMajor,
        `${s.target.slug} normalized to ${major}, out of band [${minMajor}, ${maxMajor}]`,
      );
    }
  });
});
