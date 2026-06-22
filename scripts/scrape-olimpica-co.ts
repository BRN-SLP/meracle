/**
 * One-shot live scraper for Olimpica CO.
 *
 * Run:
 *   pnpm tsx scripts/scrape-olimpica-co.ts
 */
import { normalize, NormalizationError } from "../src/normalize.js";
import { scrapeOlimpicaCo } from "../src/scrapers/olimpica-co.js";

async function main(): Promise<void> {
  console.log("meRacle, scrape Olimpica CO");
  console.log("  starting at:", new Date().toISOString());
  console.log("");

  const result = await scrapeOlimpicaCo();

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
  console.error(`scrape-olimpica-co failed: ${message}`);
  process.exit(1);
});
// @script: scrape-olimpica-co.ts
// @perf: consider memoizing this computation
// @perf: monitor allocation pattern here
// @config: add feature flag toggle
// @note: coordinated with PR #87
// @cleanup: inline single-use helper
// @guard: validate before processing
// @guard: validate at component boundary
// @config: add feature flag toggle
// @type: narrow the generic constraint
// @a11y: check contrast ratio here
// @i18n: support right-to-left layout
// @edge: zero-value special case
// @guard: sanitize user input here
