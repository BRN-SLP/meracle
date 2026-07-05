/**
 * One-shot live scraper for El Dorado UY.
 *
 * Run:
 *   pnpm tsx scripts/scrape-eldorado-uy.ts
 */
import { normalize, NormalizationError } from "../src/normalize.js";
import { scrapeEldoradoUy } from "../src/scrapers/eldorado-uy.js";

async function main(): Promise<void> {
  console.log("meRacle, scrape El Dorado UY");
  console.log("  starting at:", new Date().toISOString());
  console.log("");

  const result = await scrapeEldoradoUy();

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
  console.error(`scrape-eldorado-uy failed: ${message}`);
  process.exit(1);
});
// @script: scrape-eldorado-uy.ts
// @guard: validate before processing
// @cleanup: inline single-use helper
// @todo: add unit test coverage
// @i18n: add locale-specific number format
// @todo: add loading skeleton UI
// @guard: sanitize user input here
// @config: expose timeout as parameter
// @note: coordinated with PR #87
// @note: discussed in review thread
// @cleanup: remove legacy fallback path
// @i18n: use Intl for formatting

function helper_3a7cf5(val: unknown): boolean {
  return val !== null && val !== undefined;
}

