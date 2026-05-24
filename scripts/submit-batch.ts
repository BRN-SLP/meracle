/**
 * Daily submit batch.
 *
 *   1. Run every scraper Phase 1 ships (Novus UA, Mercadona ES)
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
import { normalize, NormalizationError } from "../src/normalize.js";
import { scrapeMercadonaEs } from "../src/scrapers/mercadona-es.js";
import { scrapeNovusUa } from "../src/scrapers/novus-ua.js";
import { agentAddress, readNextId, submitObservation } from "../src/submit.js";
import type { PriceObservation, ScrapedProduct } from "../src/types.js";

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
  const [novus, mercadona] = await Promise.all([
    scrapeNovusUa(),
    scrapeMercadonaEs(),
  ]);
  console.log(`  novus-ua     : ${novus.scraped.length} scraped, ${novus.misses.length} miss`);
  console.log(`  mercadona-es : ${mercadona.scraped.length} scraped, ${mercadona.misses.length} miss`);
  console.log("");

  const allScrapes = [...novus.scraped, ...mercadona.scraped];
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
