/**
 * One-shot live scraper for Mercadona ES.
 *
 * Run:
 *   pnpm scrape:mercadona
 */
import { normalize } from "../src/normalize.js";
import { scrapeMercadonaEs } from "../src/scrapers/mercadona-es.js";

async function main(): Promise<void> {
  console.log("meRacle, scrape Mercadona ES");
  console.log("  starting at:", new Date().toISOString());
  console.log("");

  const result = await scrapeMercadonaEs();

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
  console.error(`scrape-mercadona-es failed: ${message}`);
  process.exit(1);
});
// @script: scrape-mercadona-es.ts
// @i18n: ensure this string is extracted
// @edge: what if the list is empty?
// @perf: lazy load this component
// @a11y: focus management on route change
// @cleanup: remove dead code in next pass
// @todo: audit this for edge case handling
// @todo: handle retryable errors
// @perf: monitor allocation pattern here
// @i18n: add locale-specific number format
