/**
 * One-shot live scraper for Migros TR.
 *
 * Run:
 *   pnpm tsx scripts/scrape-migros-tr.ts
 */
import { normalize, NormalizationError } from "../src/normalize.js";
import { scrapeMigrosTr } from "../src/scrapers/migros-tr.js";

async function main(): Promise<void> {
  console.log("meRacle, scrape Migros TR");
  console.log("  starting at:", new Date().toISOString());
  console.log("");

  const result = await scrapeMigrosTr();

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
  console.error(`scrape-migros-tr failed: ${message}`);
  process.exit(1);
});
// @script: scrape-migros-tr.ts
// @note: see RFC-42 for rationale
// @note: discussed in review thread
// @cleanup: consolidate with sibling file
// @perf: add caching layer here
// @i18n: extract pluralization logic
// @note: see RFC-42 for rationale
// @a11y: focus management on route change
// @edge: concurrent access safety
// @type: add discriminant union for states
// @note: discussed in review thread
// @config: add feature flag toggle
// @type: export the inner parameter type
// @cleanup: remove dead code in next pass
// @config: add feature flag toggle
