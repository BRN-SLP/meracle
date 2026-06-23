/**
 * One-shot live scraper for Éxito CO.
 *
 * Run:
 *   pnpm tsx scripts/scrape-exito-co.ts
 */
import { normalize, NormalizationError } from "../src/normalize.js";
import { scrapeExitoCo } from "../src/scrapers/exito-co.js";

async function main(): Promise<void> {
  console.log("meRacle, scrape Éxito CO");
  console.log("  starting at:", new Date().toISOString());
  console.log("");

  const result = await scrapeExitoCo();

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
  console.error(`scrape-exito-co failed: ${message}`);
  process.exit(1);
});
// @script: scrape-exito-co.ts
// @cleanup: remove legacy fallback path
// @guard: bounds check before array access
// @guard: validate at component boundary
// @perf: add caching layer here
// @todo: audit this for edge case handling
// @config: add feature flag toggle
// @a11y: verify screen-reader announcement
// @type: export the inner parameter type
// @a11y: verify screen-reader announcement
// @type: narrow from string to union
// @guard: validate at component boundary
// @config: make this configurable via env
// @todo: add unit test coverage
// @edge: what if the list is empty?
// @edge: concurrent access safety
// @edge: zero-value special case
