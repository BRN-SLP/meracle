/**
 * Daily submit batch.
 *
 *   1. Run every scraper Phase 1 ships (Novus UA, Mercadona ES,
 *      optionally Sainsbury's UK when BROWSER_USE_API_KEY is set)
 *   2. Normalize each scraped row to a PriceObservation
 *   3. Print a dry-run preview by default
 *   4. With --live, submit each observation on-chain one at a time
 *
 * One failed observation does NOT block the rest. Each result row
 * reports either { ok, submissionId, txHash } or { error }.
 *
 * Run:
 *   pnpm submit:batch              # dry-run preview, no tx
 *   pnpm submit:batch --live       # real submitPrice() txs
 */
import { env } from "../src/env.js";
import { normalize, NormalizationError } from "../src/normalize.js";
import { scrapeCarrefourFr } from "../src/scrapers/carrefour-fr.js";
import { scrapeConadIt } from "../src/scrapers/conad-it.js";
import { scrapeMercadonaEs } from "../src/scrapers/mercadona-es.js";
import { scrapeMigrosTr } from "../src/scrapers/migros-tr.js";
import { scrapeNovusUa } from "../src/scrapers/novus-ua.js";
import { scrapeReweDe } from "../src/scrapers/rewe-de.js";
import { scrapeSainsburysUk } from "../src/scrapers/sainsburys-uk.js";
import { agentAddress, readNextId, submitObservation } from "../src/submit.js";
import type { PriceObservation, ScraperResult, ScrapedProduct } from "../src/types.js";

const LIVE = process.argv.includes("--live");

interface BatchRow {
  scraped: ScrapedProduct;
  observation?: PriceObservation;
  error?: string;
}

interface SubmitOutcome {
  row: BatchRow;
  txHash?: string;
  submissionId?: bigint;
  error?: string;
}

function printHeader(): void {
  console.log("meRacle, daily submit batch");
  console.log(`  mode         : ${LIVE ? "LIVE (real tx)" : "DRY-RUN"}`);
  console.log(`  agent address: ${agentAddress}`);
  console.log(`  started at   : ${new Date().toISOString()}`);
  console.log("");
}

function normalizeBatch(scrapes: ScrapedProduct[]): BatchRow[] {
  const rows: BatchRow[] = [];
  for (const scraped of scrapes) {
    try {
      const observation = normalize(scraped);
      rows.push({ scraped, observation });
    } catch (e: unknown) {
      const error =
        e instanceof NormalizationError
          ? e.message
          : e instanceof Error
            ? e.message
            : String(e);
      rows.push({ scraped, error });
    }
  }
  return rows;
}

function printPreview(rows: BatchRow[]): void {
  console.log("PREVIEW (normalized observations):");
  console.log("");
  for (const row of rows) {
    const t = row.scraped.target;
    console.log(`  [${t.country}/${t.slug}]  ${row.scraped.retailerTitle}`);
    if (row.observation) {
      console.log(
        `    -> priceCents=${row.observation.priceCents} (${t.currency} ${(row.observation.priceCents / 100).toFixed(2)})`,
      );
      console.log(`    -> source     ${row.observation.sourceUrl}`);
    } else {
      console.log(`    -> SKIP (${row.error})`);
    }
  }
  console.log("");
}

async function submitAll(rows: BatchRow[]): Promise<SubmitOutcome[]> {
  const outcomes: SubmitOutcome[] = [];
  for (const row of rows) {
    if (!row.observation) {
      outcomes.push({ row, error: row.error ?? "no observation" });
      continue;
    }
    const t = row.scraped.target;
    process.stdout.write(`  submitting [${t.country}/${t.slug}] ... `);
    try {
      const r = await submitObservation(row.observation);
      console.log(`ok id=${r.submissionId} tx=${r.txHash}`);
      outcomes.push({
        row,
        txHash: r.txHash,
        submissionId: r.submissionId,
      });
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : String(e);
      console.log(`FAIL ${error}`);
      outcomes.push({ row, error });
    }
  }
  return outcomes;
}

function summarize(outcomes: SubmitOutcome[]): void {
  const ok = outcomes.filter((o) => o.submissionId !== undefined).length;
  const failed = outcomes.filter((o) => o.error !== undefined).length;
  console.log("");
  console.log(`Batch done: ${ok} submitted, ${failed} failed.`);
  if (failed > 0) {
    console.log("Failures:");
    for (const o of outcomes) {
      if (o.error) {
        const t = o.row.scraped.target;
        console.log(`  [${t.country}/${t.slug}] ${o.error}`);
      }
    }
  }
}

async function main(): Promise<void> {
  printHeader();

  console.log("Scraping retailers ...");
  // Novus UA, Mercadona ES, Conad IT, and Rewe DE run over plain
  // HTTP, no Browser Use Cloud needed. Sainsbury's UK and Carrefour
  // FR sit behind Akamai Bot Manager and require BROWSER_USE_API_KEY
  // (a residential proxy). Skip those silently if the key is unset
  // so the batch still works with the four HTTP retailers.
  const sainsburysPromise: Promise<ScraperResult | null> = env.BROWSER_USE_API_KEY
    ? scrapeSainsburysUk().catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`  sainsburys-uk: scrape threw, skipping ($${msg})`);
        return null;
      })
    : Promise.resolve(null);
  const conadPromise: Promise<ScraperResult | null> = scrapeConadIt().catch(
    (e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`  conad-it: scrape threw, skipping ($${msg})`);
      return null;
    },
  );
  const carrefourPromise: Promise<ScraperResult | null> = env.BROWSER_USE_API_KEY
    ? scrapeCarrefourFr().catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`  carrefour-fr: scrape threw, skipping ($${msg})`);
        return null;
      })
    : Promise.resolve(null);

  // REWE Germany runs over plain HTTP and ignores BROWSER_USE_API_KEY.
  // The scraper itself reports clean misses when REWE_WW_IDENT and
  // REWE_MARKET_CODE are not configured (see docs/deferred-retailers.md).
  const rewePromise: Promise<ScraperResult | null> = scrapeReweDe().catch(
    (e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`  rewe-de: scrape threw, skipping ($${msg})`);
      return null;
    },
  );

  // Migros Turkey runs over plain HTTP, public unauthenticated API.
  const migrosPromise: Promise<ScraperResult | null> = scrapeMigrosTr().catch(
    (e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`  migros-tr: scrape threw, skipping ($${msg})`);
      return null;
    },
  );

  const [novus, mercadona, sainsburys, conad, carrefour, rewe, migros] = await Promise.all([
    scrapeNovusUa(),
    scrapeMercadonaEs(),
    sainsburysPromise,
    conadPromise,
    carrefourPromise,
    rewePromise,
    migrosPromise,
  ]);
  console.log(`  novus-ua     : ${novus.scraped.length} scraped, ${novus.misses.length} miss`);
  console.log(`  mercadona-es : ${mercadona.scraped.length} scraped, ${mercadona.misses.length} miss`);
  if (sainsburys) {
    console.log(`  sainsburys-uk: ${sainsburys.scraped.length} scraped, ${sainsburys.misses.length} miss`);
  } else {
    console.log("  sainsburys-uk: SKIPPED (BROWSER_USE_API_KEY not set)");
  }
  if (conad) {
    console.log(`  conad-it     : ${conad.scraped.length} scraped, ${conad.misses.length} miss`);
  } else {
    console.log("  conad-it     : SKIPPED (scraper threw)");
  }
  if (carrefour) {
    console.log(`  carrefour-fr : ${carrefour.scraped.length} scraped, ${carrefour.misses.length} miss`);
  } else {
    console.log("  carrefour-fr : SKIPPED (BROWSER_USE_API_KEY not set)");
  }
  if (rewe) {
    console.log(`  rewe-de      : ${rewe.scraped.length} scraped, ${rewe.misses.length} miss`);
  } else {
    console.log("  rewe-de      : SKIPPED (scraper threw)");
  }
  if (migros) {
    console.log(`  migros-tr    : ${migros.scraped.length} scraped, ${migros.misses.length} miss`);
  } else {
    console.log("  migros-tr    : SKIPPED (scraper threw)");
  }
  console.log("");

  const allScrapes = [
    ...novus.scraped,
    ...mercadona.scraped,
    ...(sainsburys?.scraped ?? []),
    ...(conad?.scraped ?? []),
    ...(carrefour?.scraped ?? []),
    ...(rewe?.scraped ?? []),
    ...(migros?.scraped ?? []),
  ];
  const rows = normalizeBatch(allScrapes);
  printPreview(rows);

  if (!LIVE) {
    console.log("Dry-run only. Re-run with --live to submit on-chain.");
    return;
  }

  const before = await readNextId();
  console.log(`nextId before batch: ${before}`);
  console.log("");

  const outcomes = await submitAll(rows);
  const after = await readNextId();
  console.log("");
  console.log(`nextId after batch:  ${after} (advanced by ${after - before})`);

  summarize(outcomes);
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`submit-batch failed: ${message}`);
  process.exit(1);
});
