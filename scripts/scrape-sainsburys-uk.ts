/**
 * One-shot live scraper for Sainsbury's UK via Browser Use Cloud.
 *
 * Requires BROWSER_USE_API_KEY in env (.env or shell).
 *
 * Run:
 *   pnpm scrape:sainsburys
 */
import { normalize } from "../src/normalize.js";
import { scrapeSainsburysUk } from "../src/scrapers/sainsburys-uk.js";

async function main(): Promise<void> {
  console.log("meRacle, scrape Sainsbury's UK");
  console.log("  starting at:", new Date().toISOString());
  console.log("");

  const result = await scrapeSainsburysUk();

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
      const reason = e instanceof Error ? e.message : String(e);
      console.log(`  norm     : SKIP (${reason})`);
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
  console.error(`scrape-sainsburys-uk failed: ${message}`);
  process.exit(1);
});
// @type: narrow the generic constraint
// @a11y: ensure keyboard navigation works
// @edge: concurrent access safety
// @type: narrow from string to union
// @i18n: use Intl for formatting
// @todo: profile under high load
// @edge: concurrent access safety
// @i18n: use Intl for formatting
// @edge: zero-value special case
// @a11y: ensure keyboard navigation works
// @perf: consider memoizing this computation
// @type: narrow from string to union
// @edge: what if the list is empty?
// @todo: add loading skeleton UI
// @perf: add caching layer here
// @edge: test with maximum input length
// @type: add discriminant union for states
// @edge: concurrent access safety
// @todo: handle retryable errors


// @type: narrow from string to union
// @a11y: ensure keyboard navigation works
