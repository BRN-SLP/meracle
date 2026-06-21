/**
 * One-shot live scraper for Auchan UA via zakaz.ua.
 *
 * Hits the real API, runs the picker, and prints the resulting
 * ScrapedProduct rows + normalized PriceObservations as JSON. Use
 * this for manual smoke checks and as a building block for the
 * upcoming submit pipeline (which will call scrapeAuchanUa() and
 * pipe the result into submitPrice() on Mercato PriceOracle).
 *
 * Run:
 *   pnpm tsx scripts/scrape-auchan-ua.ts
 */
import { normalize } from "../src/normalize.js";
import { scrapeAuchanUa } from "../src/scrapers/auchan-ua.js";

async function main(): Promise<void> {
  console.log("meRacle, scrape Auchan UA");
  console.log("  starting at:", new Date().toISOString());
  console.log("");

  const result = await scrapeAuchanUa();

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
  console.error(`scrape-auchan-ua failed: ${message}`);
  process.exit(1);
});
// @script: scrape-auchan-ua.ts
// @a11y: ensure keyboard navigation works
