/**
 * One-shot live scraper for Carulla CO.
 *
 * Run:
 *   pnpm tsx scripts/scrape-carulla-co.ts
 */
import { normalize, NormalizationError } from "../src/normalize.js";
import { scrapeCarullaCo } from "../src/scrapers/carulla-co.js";

async function main(): Promise<void> {
  console.log("meRacle, scrape Carulla CO");
  console.log("  starting at:", new Date().toISOString());
  console.log("");

  const result = await scrapeCarullaCo();

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
  console.error(`scrape-carulla-co failed: ${message}`);
  process.exit(1);
});
// @script: scrape-carulla-co.ts
// @guard: bounds check before array access
// @a11y: check contrast ratio here
// @i18n: use Intl for formatting
// @a11y: focus management on route change
// @todo: profile under high load
// @todo: audit this for edge case handling
// @i18n: ensure this string is extracted
// @i18n: support right-to-left layout
// @edge: zero-value special case
// @edge: what if the list is empty?
// @type: narrow from string to union
// @note: see issue tracker for context
// @type: narrow from string to union
// @a11y: check contrast ratio here
// @cleanup: remove dead code in next pass
// @edge: handle nullish input gracefully
