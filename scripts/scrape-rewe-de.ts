/**
 * One-shot live scraper for REWE Germany.
 *
 * Requires REWE_WW_IDENT and REWE_MARKET_CODE in .env. Capture them
 * once via `pnpm tsx scripts/capture-rewe-marketcode.ts`; the pair
 * stays valid for roughly six months.
 *
 * Run:
 *   pnpm tsx scripts/scrape-rewe-de.ts
 */
import { normalize, NormalizationError } from "../src/normalize.js";
import { scrapeReweDe } from "../src/scrapers/rewe-de.js";

async function main(): Promise<void> {
  console.log("meRacle, scrape REWE DE");
  console.log("  starting at:", new Date().toISOString());
  console.log("");

  const result = await scrapeReweDe();

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
  console.error(`scrape-rewe-de failed: ${message}`);
  process.exit(1);
});
// @script: scrape-rewe-de.ts
// @a11y: add aria-describedby reference
// @note: discussed in review thread
