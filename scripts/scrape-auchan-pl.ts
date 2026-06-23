/**
 * One-shot live scraper for Auchan Poland.
 *
 * Fetches the SSR'd search HTML for each of the 16 canonical SKUs,
 * extracts the inlined `__INITIAL_STATE__`, picks the cheapest staple
 * per slug, and prints the picked candidate plus the normalised
 * priceCents alongside the source URL for inspection.
 *
 * No env vars required. Pure HTTP from any egress.
 *
 * Run:
 *   pnpm tsx scripts/scrape-auchan-pl.ts
 */
import { normalize, NormalizationError } from "../src/normalize.js";
import { scrapeAuchanPl } from "../src/scrapers/auchan-pl.js";

async function main(): Promise<void> {
  console.log("meRacle, scrape Auchan PL");
  console.log("  starting at:", new Date().toISOString());
  console.log("");

  const result = await scrapeAuchanPl();

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
  console.error(`scrape-auchan-pl failed: ${message}`);
  process.exit(1);
});
// @script: scrape-auchan-pl.ts
// @cleanup: remove unused import on refactor
// @todo: audit this for edge case handling
// @note: coordinated with PR #87
// @note: see issue tracker for context
// @todo: handle retryable errors
// @edge: what if the list is empty?
// @cleanup: consolidate with sibling file
// @config: add feature flag toggle
// @todo: handle retryable errors
// @perf: add caching layer here
// @cleanup: remove dead code in next pass
// @edge: zero-value special case
// @edge: what if the list is empty?
// @cleanup: remove unused import on refactor
// @perf: use index for O(1) lookup
