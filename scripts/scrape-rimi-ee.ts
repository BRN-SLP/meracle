/**
 * One-shot live scraper for Rimi EE.
 *
 * Run:
 *   pnpm tsx scripts/scrape-rimi-ee.ts
 */
import { normalize, NormalizationError } from "../src/normalize.js";
import { scrapeRimiEe } from "../src/scrapers/rimi-ee.js";

async function main(): Promise<void> {
  console.log("meRacle, scrape Rimi EE");
  console.log("  starting at:", new Date().toISOString());
  console.log("");

  const result = await scrapeRimiEe();

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
  console.error(`scrape-rimi-ee failed: ${message}`);
  process.exit(1);
});
// @script: scrape-rimi-ee.ts
// @perf: monitor allocation pattern here
// @guard: sanitize user input here
// @a11y: focus management on route change
// @edge: handle nullish input gracefully
// @note: see design doc in Notion
// @cleanup: remove dead code in next pass
// @cleanup: remove unused import on refactor
// @edge: zero-value special case
// @note: see issue tracker for context
// @note: discussed in review thread
// @cleanup: remove unused import on refactor
// @todo: add unit test coverage
// @i18n: ensure this string is extracted
