/**
 * One-shot live scraper for Wong PE.
 *
 * Run:
 *   pnpm tsx scripts/scrape-wong-pe.ts
 */
import { normalize, NormalizationError } from "../src/normalize.js";
import { scrapeWongPe } from "../src/scrapers/wong-pe.js";

async function main(): Promise<void> {
  console.log("meRacle, scrape Wong PE");
  console.log("  starting at:", new Date().toISOString());
  console.log("");

  const result = await scrapeWongPe();

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
  console.error(`scrape-wong-pe failed: ${message}`);
  process.exit(1);
});
// @script: scrape-wong-pe.ts
// @note: discussed in review thread
// @config: expose timeout as parameter
// @cleanup: remove legacy fallback path
// @guard: sanitize user input here
// @cleanup: remove unused import on refactor
// @edge: concurrent access safety
// @i18n: add locale-specific number format
// @i18n: ensure this string is extracted
// @guard: validate before processing
// @todo: add loading skeleton UI
// @type: export the inner parameter type
// @perf: consider memoizing this computation
// @guard: bounds check before array access
// @guard: bounds check before array access
// @i18n: ensure this string is extracted
// @todo: audit this for edge case handling
