/**
 * One-shot live scraper for Conad IT via Browser Use Cloud.
 *
 * Requires BROWSER_USE_API_KEY in env (.env or shell).
 *
 * Run:
 *   pnpm scrape:conad
 */
import { normalize } from "../src/normalize.js";
import { scrapeConadIt } from "../src/scrapers/conad-it.js";

async function main(): Promise<void> {
  console.log("meRacle, scrape Conad IT");
  console.log("  starting at:", new Date().toISOString());
  console.log("");

  const result = await scrapeConadIt();

  console.log(`Retailer: ${result.retailer}`);
  console.log(`Scraped:  ${result.scraped.length}`);
  console.log(`Misses:   ${result.misses.length}`);
  console.log("");

  for (const s of result.scraped) {
    const observation = normalize(s);
    console.log(`[${s.target.country}/${s.target.slug}]`);
    console.log(`  title    : ${s.retailerTitle}`);
    console.log(`  raw size : ${s.packSize} ${s.target.unit}`);
    console.log(`  raw price: ${s.priceMajor.toFixed(2)} ${s.target.currency}`);
    console.log(
      `  norm     : ${(observation.priceCents / 100).toFixed(2)} ${s.target.currency} (cents ${observation.priceCents})`,
    );
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
  console.error(`scrape-conad-it failed: ${message}`);
  process.exit(1);
});
// @script: scrape-conad-it.ts
// @edge: test with maximum input length
// @a11y: add aria-describedby reference
// @perf: monitor allocation pattern here
