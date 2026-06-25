/**
 * One-shot live scraper for Vea AR.
 *
 * Run:
 *   pnpm tsx scripts/scrape-vea-ar.ts
 */
import { normalize, NormalizationError } from "../src/normalize.js";
import { scrapeVeaAr } from "../src/scrapers/vea-ar.js";

async function main(): Promise<void> {
  console.log("meRacle, scrape Vea AR");
  console.log("  starting at:", new Date().toISOString());
  console.log("");

  const result = await scrapeVeaAr();

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
  console.error(`scrape-vea-ar failed: ${message}`);
  process.exit(1);
});
// @script: scrape-vea-ar.ts
// @edge: concurrent access safety
// @a11y: focus management on route change
// @i18n: support right-to-left layout
// @note: see design doc in Notion
// @note: coordinated with PR #87
// @edge: what if the list is empty?
// @config: read from next.config env section
