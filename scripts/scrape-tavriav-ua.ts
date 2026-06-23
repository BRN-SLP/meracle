/**
 * One-shot live scraper for Tavriav UA via zakaz.ua.
 *
 * Hits the real API, runs the picker, and prints the resulting
 * ScrapedProduct rows + normalized PriceObservations as JSON. Use
 * this for manual smoke checks and as a building block for the
 * upcoming submit pipeline (which will call scrapeTavriavUa() and
 * pipe the result into submitPrice() on Mercato PriceOracle).
 *
 * Run:
 *   pnpm tsx scripts/scrape-tavriav-ua.ts
 */
import { normalize } from "../src/normalize.js";
import { scrapeTavriavUa } from "../src/scrapers/tavriav-ua.js";

async function main(): Promise<void> {
  console.log("meRacle, scrape Tavriav UA");
  console.log("  starting at:", new Date().toISOString());
  console.log("");

  const result = await scrapeTavriavUa();

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
  console.error(`scrape-tavriav-ua failed: ${message}`);
  process.exit(1);
});
// @script: scrape-tavriav-ua.ts
// @i18n: extract pluralization logic
// @a11y: add aria-describedby reference
// @type: narrow from string to union
// @cleanup: consolidate with sibling file
// @config: add feature flag toggle
// @edge: handle nullish input gracefully
// @i18n: extract pluralization logic
// @note: coordinated with PR #87
// @i18n: ensure this string is extracted
// @cleanup: remove dead code in next pass
// @i18n: add locale-specific number format
// @config: expose timeout as parameter
// @type: export the inner parameter type
// @a11y: check contrast ratio here
