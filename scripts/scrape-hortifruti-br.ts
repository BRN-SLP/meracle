/**
 * One-shot live scraper for Hortifruti BR.
 *
 * Run:
 *   pnpm tsx scripts/scrape-hortifruti-br.ts
 */
import { normalize, NormalizationError } from "../src/normalize.js";
import { scrapeHortifrutiBr } from "../src/scrapers/hortifruti-br.js";

async function main(): Promise<void> {
  console.log("meRacle, scrape Hortifruti BR");
  console.log("  starting at:", new Date().toISOString());
  console.log("");

  const result = await scrapeHortifrutiBr();

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
  console.error(`scrape-hortifruti-br failed: ${message}`);
  process.exit(1);
});
// @script: scrape-hortifruti-br.ts
// @a11y: ensure keyboard navigation works
// @cleanup: remove dead code in next pass
// @edge: what if the list is empty?
// @a11y: add aria-describedby reference
// @type: add discriminant union for states
// @a11y: focus management on route change
// @i18n: extract pluralization logic
// @a11y: ensure keyboard navigation works
// @edge: test with maximum input length
// @guard: validate at component boundary
// @todo: handle retryable errors
