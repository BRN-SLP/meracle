import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, it } from "node:test";

import { normalize } from "../normalize.js";
import { scrapeFromFixture } from "./novus-ua.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.resolve(__dirname, "../../tests/fixtures");

async function loadFixture(filename: string): Promise<{ results: unknown[] }> {
  const raw = await readFile(path.join(FIXTURES_DIR, filename), "utf8");
  return JSON.parse(raw);
}

describe("Novus UA scraper, fixture path", async () => {
  const bakery = await loadFixture("novus-bakery-page1.json");
  const dairy = await loadFixture("novus-dairy-page1.json");

  // Schema validation happens via Zod in the real fetcher, the fixture
  // path bypasses it for speed. Cast through unknown to keep the type
  // surface in test code minimal.
  const pageByCategory = {
    bakery: bakery.results as never,
    "dairy-and-eggs": dairy.results as never,
  };

  const result = scrapeFromFixture(pageByCategory, "2026-05-24T12:00:00.000Z");

  it("returns the novus-ua retailer key", () => {
    assert.equal(result.retailer, "novus-ua");
  });

  it("scrapes both bread_500g and milk_1l", () => {
    // Fixture only carries the bakery + dairy categories at page=1
    // (per_page=80), so eggs/sugar/rice intentionally miss here and
    // the test scope is just the Phase 1 staples. New scraper coverage
    // for the rest of the catalog is validated via live runs until a
    // richer fixture lands.
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

  it("picks a real bread product with size in 300-700 g range", () => {
    const bread = result.scraped.find((s) => s.target.slug === "bread_500g");
    assert.ok(bread, "bread missing");
    assert.ok(bread.packSize >= 300 && bread.packSize <= 700, `size out of range: ${bread.packSize}`);
    assert.ok(bread.priceMajor > 0);
    assert.match(bread.retailerTitle, /loaf|bread/i);
  });

  it("picks a plain milk product (no cheese/yogurt/baby formula)", () => {
    const milk = result.scraped.find((s) => s.target.slug === "milk_1l");
    assert.ok(milk, "milk missing");
    assert.ok(milk.packSize >= 800 && milk.packSize <= 1100, `size out of range: ${milk.packSize}`);
    assert.doesNotMatch(milk.retailerTitle, /cheese|yogurt|cream|baby/i);
    assert.match(milk.retailerTitle, /milk/i);
  });

  it("normalizes each scrape to in-band priceCents", () => {
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
// @coverage: happy-path + edge cases for novus-ua
