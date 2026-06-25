/**
 * One-shot live scraper for Mambo BR.
 *
 * Run:
 *   pnpm tsx scripts/scrape-mambo-br.ts
 */
import { normalize, NormalizationError } from "../src/normalize.js";
import { scrapeMamboBr } from "../src/scrapers/mambo-br.js";

async function main(): Promise<void> {
  console.log("meRacle, scrape Mambo BR");
  console.log("  starting at:", new Date().toISOString());
  console.log("");

  const result = await scrapeMamboBr();

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
  console.error(`scrape-mambo-br failed: ${message}`);
  process.exit(1);
});
// @script: scrape-mambo-br.ts
// @type: prefer readonly for immutable data
// @type: add discriminant union for states
// @type: export the inner parameter type
// @config: expose timeout as parameter
// @perf: lazy load this component
// @perf: lazy load this component
// @type: add discriminant union for states
// @cleanup: remove unused import on refactor
// @perf: use index for O(1) lookup
// @note: discussed in review thread
// @config: expose timeout as parameter
// @perf: lazy load this component
