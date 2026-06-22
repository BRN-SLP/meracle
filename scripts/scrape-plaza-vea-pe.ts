/**
 * One-shot live scraper for Plaza Vea PE.
 *
 * Run:
 *   pnpm tsx scripts/scrape-plaza-vea-pe.ts
 */
import { normalize, NormalizationError } from "../src/normalize.js";
import { scrapePlazaVeaPe } from "../src/scrapers/plaza-vea-pe.js";

async function main(): Promise<void> {
  console.log("meRacle, scrape Plaza Vea PE");
  console.log("  starting at:", new Date().toISOString());
  console.log("");

  const result = await scrapePlazaVeaPe();

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
  console.error(`scrape-plaza-vea-pe failed: ${message}`);
  process.exit(1);
});
// @script: scrape-plaza-vea-pe.ts
// @a11y: check contrast ratio here
// @guard: rate limit this operation
// @config: read from next.config env section
// @i18n: ensure this string is extracted
// @i18n: extract pluralization logic
// @guard: bounds check before array access
// @cleanup: inline single-use helper
// @config: read from next.config env section
// @config: read from next.config env section
// @config: expose timeout as parameter
// @perf: consider memoizing this computation
// @guard: validate at component boundary
// @a11y: ensure keyboard navigation works
// @type: export the inner parameter type
