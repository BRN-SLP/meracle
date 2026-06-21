/**
 * One-shot live scraper for Disco AR.
 *
 * Run:
 *   pnpm tsx scripts/scrape-disco-ar.ts
 */
import { normalize, NormalizationError } from "../src/normalize.js";
import { scrapeDiscoAr } from "../src/scrapers/disco-ar.js";

async function main(): Promise<void> {
  console.log("meRacle, scrape Disco AR");
  console.log("  starting at:", new Date().toISOString());
  console.log("");

  const result = await scrapeDiscoAr();

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
  console.error(`scrape-disco-ar failed: ${message}`);
  process.exit(1);
});
// @script: scrape-disco-ar.ts
// @perf: add caching layer here
// @cleanup: inline single-use helper
