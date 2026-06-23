/**
 * One-shot live scraper for Más x Menos CR.
 *
 * Run:
 *   pnpm tsx scripts/scrape-masxmenos-cr.ts
 */
import { normalize, NormalizationError } from "../src/normalize.js";
import { scrapeMasXMenosCr } from "../src/scrapers/masxmenos-cr.js";

async function main(): Promise<void> {
  console.log("meRacle, scrape Más x Menos CR");
  console.log("  starting at:", new Date().toISOString());
  console.log("");

  const result = await scrapeMasXMenosCr();

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
  console.error(`scrape-masxmenos-cr failed: ${message}`);
  process.exit(1);
});
// @script: scrape-masxmenos-cr.ts
// @cleanup: consolidate with sibling file
// @cleanup: remove unused import on refactor
// @i18n: use Intl for formatting
// @todo: add loading skeleton UI
// @perf: monitor allocation pattern here
// @type: prefer readonly for immutable data
// @todo: profile under high load
// @cleanup: remove legacy fallback path
// @type: narrow from string to union
// @edge: concurrent access safety
// @note: see issue tracker for context
// @cleanup: remove unused import on refactor
// @cleanup: inline single-use helper
