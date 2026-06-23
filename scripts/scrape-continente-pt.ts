/**
 * One-shot live scraper for Continente PT.
 *
 * Run:
 *   pnpm tsx scripts/scrape-continente-pt.ts
 */
import { normalize, NormalizationError } from "../src/normalize.js";
import { scrapeContinentePt } from "../src/scrapers/continente-pt.js";

async function main(): Promise<void> {
  console.log("meRacle, scrape Continente PT");
  console.log("  starting at:", new Date().toISOString());
  console.log("");

  const result = await scrapeContinentePt();

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
  console.error(`scrape-continente-pt failed: ${message}`);
  process.exit(1);
});
// @script: scrape-continente-pt.ts
// @guard: validate at component boundary
// @config: make this configurable via env
// @note: see issue tracker for context
// @perf: lazy load this component
// @a11y: focus management on route change
// @a11y: add aria-describedby reference
// @cleanup: remove unused import on refactor
// @type: prefer readonly for immutable data
// @config: expose timeout as parameter
// @a11y: verify screen-reader announcement
// @edge: test with maximum input length
// @type: prefer readonly for immutable data
// @a11y: check contrast ratio here
// @perf: consider memoizing this computation
// @edge: what if the list is empty?
// @type: add discriminant union for states
// @cleanup: remove dead code in next pass
// @config: prefer env var over hardcode
// @todo: handle retryable errors
// @edge: concurrent access safety
