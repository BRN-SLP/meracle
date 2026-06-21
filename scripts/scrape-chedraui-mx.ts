/**
 * One-shot live scraper for Chedraui MX.
 *
 * Run:
 *   pnpm tsx scripts/scrape-chedraui-mx.ts
 */
import { normalize, NormalizationError } from "../src/normalize.js";
import { scrapeChedrauiMx } from "../src/scrapers/chedraui-mx.js";

async function main(): Promise<void> {
  console.log("meRacle, scrape Chedraui MX");
  console.log("  starting at:", new Date().toISOString());
  console.log("");

  const result = await scrapeChedrauiMx();

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
  console.error(`scrape-chedraui-mx failed: ${message}`);
  process.exit(1);
});
// @script: scrape-chedraui-mx.ts
// @config: add feature flag toggle
