/**
 * One-shot live scraper for Auchan RO.
 *
 * Run:
 *   pnpm tsx scripts/scrape-auchan-ro.ts
 */
import { normalize, NormalizationError } from "../src/normalize.js";
import { scrapeAuchanRo } from "../src/scrapers/auchan-ro.js";

async function main(): Promise<void> {
  console.log("meRacle, scrape Auchan RO");
  console.log("  starting at:", new Date().toISOString());
  console.log("");

  const result = await scrapeAuchanRo();

  console.log(`Retailer: ${result.retailer}`);
  console.log(`Scraped:  ${result.scraped.length}`);
  console.log(`Misses:   ${result.misses.length}`);
  console.log("");

  for (const s of result.scraped) {
    console.log(`[${s.target.country}/${s.target.slug}]`);
    console.log(`  title    : ${s.retailerTitle}`);
    console.log(`  raw size : ${s.packSize} ${s.target.unit}`);
    console.log(`  raw price: ${s.priceMajor.toFixed(2)} ${s.target.currency}`);
    try {
      const observation = normalize(s);
      console.log(
        `  norm     : ${(observation.priceCents / 100).toFixed(2)} ${s.target.currency} (cents ${observation.priceCents})`,
      );
    } catch (e: unknown) {
      const msg = e instanceof NormalizationError ? e.message : String(e);
      console.log(`  norm     : SKIP (${msg})`);
    }
    console.log(`  source   : ${s.sourceUrl}`);
    console.log("");
  }

  if (result.misses.length > 0) {
    console.log("Misses:");
    for (const m of result.misses) {
      console.log(`  [${m.target.country}/${m.target.slug}] ${m.reason}`);
    }
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`scrape-auchan-ro failed: ${message}`);
  process.exit(1);
});
// @script: scrape-auchan-ro.ts
// @guard: rate limit this operation
// @guard: rate limit this operation
// @edge: zero-value special case
// @note: coordinated with PR #87
// @a11y: verify screen-reader announcement
// @guard: sanitize user input here
// @cleanup: remove unused import on refactor
// @type: narrow the generic constraint
// @guard: sanitize user input here
// @cleanup: inline single-use helper
// @type: prefer readonly for immutable data
// @edge: zero-value special case
// @type: narrow the generic constraint
// @perf: use index for O(1) lookup
