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
import { scrapeAuchanPl } from "../src/scrapers/auchan-pl.js";
import { scrapeAuchanRo } from "../src/scrapers/auchan-ro.js";
import { scrapeRimiEe } from "../src/scrapers/rimi-ee.js";
import { scrapeRimiLv } from "../src/scrapers/rimi-lv.js";
import { scrapeRimiLt } from "../src/scrapers/rimi-lt.js";
import { scrapeContinentePt } from "../src/scrapers/continente-pt.js";
import { scrapeCarullaCo } from "../src/scrapers/carulla-co.js";
import { scrapeMasXMenosCr } from "../src/scrapers/masxmenos-cr.js";
import { scrapePlazaVeaPe } from "../src/scrapers/plaza-vea-pe.js";
import { scrapeMamboBr } from "../src/scrapers/mambo-br.js";
import { scrapeExitoCo } from "../src/scrapers/exito-co.js";
import { scrapeZonaSulBr } from "../src/scrapers/zona-sul-br.js";
import { scrapeVeaAr } from "../src/scrapers/vea-ar.js";
import { scrapeMetroPe } from "../src/scrapers/metro-pe.js";
import { scrapeHortifrutiBr } from "../src/scrapers/hortifruti-br.js";
import { scrapeDiaAr } from "../src/scrapers/dia-ar.js";
import { scrapeEldoradoUy } from "../src/scrapers/eldorado-uy.js";
import { scrapeCarrefourFr } from "../src/scrapers/carrefour-fr.js";
import { scrapeChedrauiMx } from "../src/scrapers/chedraui-mx.js";
import { scrapeConadIt } from "../src/scrapers/conad-it.js";
import { scrapeDiscoAr } from "../src/scrapers/disco-ar.js";
import { scrapeMercadonaEs } from "../src/scrapers/mercadona-es.js";
import { scrapeMigrosTr } from "../src/scrapers/migros-tr.js";
import { scrapeOlimpicaCo } from "../src/scrapers/olimpica-co.js";
import { scrapeWongPe } from "../src/scrapers/wong-pe.js";
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

  // Disco Argentina runs over plain HTTP, public VTEX catalog API.
  const discoPromise: Promise<ScraperResult | null> = scrapeDiscoAr().catch(
    (e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`  disco-ar: scrape threw, skipping ($${msg})`);
      return null;
    },
  );

  // Wong Peru runs over plain HTTP, public VTEX catalog API.
  const wongPromise: Promise<ScraperResult | null> = scrapeWongPe().catch(
    (e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`  wong-pe: scrape threw, skipping ($${msg})`);
      return null;
    },
  );

  // Olimpica Colombia runs over plain HTTP, public VTEX catalog API.
  const olimpicaPromise: Promise<ScraperResult | null> = scrapeOlimpicaCo().catch(
    (e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`  olimpica-co: scrape threw, skipping ($${msg})`);
      return null;
    },
  );

  // Chedraui Mexico runs over plain HTTP, public VTEX catalog API.
  const chedrauiPromise: Promise<ScraperResult | null> = scrapeChedrauiMx().catch(
    (e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`  chedraui-mx: scrape threw, skipping ($${msg})`);
      return null;
    },
  );

  // Auchan Poland runs over plain HTTP, SSR __INITIAL_STATE__ extract.
  const auchanPromise: Promise<ScraperResult | null> = scrapeAuchanPl().catch(
    (e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`  auchan-pl: scrape threw, skipping ($${msg})`);
      return null;
    },
  );

  // Auchan Romania runs over the plain VTEX catalog API.
  const auchanRoPromise: Promise<ScraperResult | null> = scrapeAuchanRo().catch(
    (e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`  auchan-ro: scrape threw, skipping ($${msg})`);
      return null;
    },
  );

  // Rimi Estonia, plain SSR HTML scrape via data-gtm-eec-product
  // JSON extraction on the public search page.
  const rimiEePromise: Promise<ScraperResult | null> = scrapeRimiEe().catch(
    (e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`  rimi-ee: scrape threw, skipping ($${msg})`);
      return null;
    },
  );

  // Rimi Latvia, identical SSR extract pattern as rimi-ee.
  const rimiLvPromise: Promise<ScraperResult | null> = scrapeRimiLv().catch(
    (e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`  rimi-lv: scrape threw, skipping ($${msg})`);
      return null;
    },
  );

  // Rimi Lithuania, identical SSR extract pattern as rimi-ee / rimi-lv.
  const rimiLtPromise: Promise<ScraperResult | null> = scrapeRimiLt().catch(
    (e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`  rimi-lt: scrape threw, skipping ($${msg})`);
      return null;
    },
  );

  // Continente Portugal, Salesforce Commerce Cloud SSR with separate
  // data-product-tile-impression JSON and pwc-tile--quantity emb. label.
  const continentePromise: Promise<ScraperResult | null> =
    scrapeContinentePt().catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`  continente-pt: scrape threw, skipping ($${msg})`);
      return null;
    });

  // Carulla Colombia, 2nd CO retailer for per-slug cross-check.
  // Shares the VTEX engine with Olimpica.
  const carullaPromise: Promise<ScraperResult | null> =
    scrapeCarullaCo().catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`  carulla-co: scrape threw, skipping ($${msg})`);
      return null;
    });

  // Más x Menos Costa Rica, Walmart-owned VTEX storefront.
  // 17th country (CR) on the oracle.
  const masxmenosPromise: Promise<ScraperResult | null> =
    scrapeMasXMenosCr().catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`  masxmenos-cr: scrape threw, skipping ($${msg})`);
      return null;
    });

  // Plaza Vea Peru, 2nd PE retailer for per-slug cross-check.
  // Same VTEX engine as Wong PE.
  const plazaVeaPromise: Promise<ScraperResult | null> =
    scrapePlazaVeaPe().catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`  plaza-vea-pe: scrape threw, skipping ($${msg})`);
      return null;
    });

  // Mambo Brazil, mid-tier São Paulo VTEX storefront, 19th country.
  const mamboPromise: Promise<ScraperResult | null> =
    scrapeMamboBr().catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`  mambo-br: scrape threw, skipping ($${msg})`);
      return null;
    });

  // Éxito Colombia, 3rd CO retailer for triangle cross-check.
  // Shares the VTEX engine with Olimpica + Carulla.
  const exitoPromise: Promise<ScraperResult | null> =
    scrapeExitoCo().catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`  exito-co: scrape threw, skipping ($${msg})`);
      return null;
    });

  // Zona Sul Brazil, RJ VTEX hypermarket. 2nd BR retailer; pairs
  // with Mambo (SP) for cross-metro cross-check.
  const zonaSulPromise: Promise<ScraperResult | null> =
    scrapeZonaSulBr().catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`  zona-sul-br: scrape threw, skipping ($${msg})`);
      return null;
    });

  // Vea Argentina, Cencosud's tier-2 VTEX chain. 2nd AR retailer;
  // pairs with Disco AR for cross-chain cross-check.
  const veaPromise: Promise<ScraperResult | null> =
    scrapeVeaAr().catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`  vea-ar: scrape threw, skipping ($${msg})`);
      return null;
    });

  // Metro Peru, Cencosud's cash-and-carry banner. 3rd PE retailer;
  // gives Peru full triangulation (Wong + Plaza Vea + Metro).
  const metroPromise: Promise<ScraperResult | null> =
    scrapeMetroPe().catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`  metro-pe: scrape threw, skipping ($${msg})`);
      return null;
    });

  // Hortifruti Brazil, national produce-focused VTEX chain. 3rd BR
  // retailer; pairs with Mambo (SP) and Zona Sul (RJ) for BR
  // triangulation. Catalog skips fresh produce slugs sold per
  // Unidade (potatoes / bananas / apples / tomatoes); the other 12
  // slugs participate in the cross-check.
  const hortifrutiPromise: Promise<ScraperResult | null> =
    scrapeHortifrutiBr().catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`  hortifruti-br: scrape threw, skipping ($${msg})`);
      return null;
    });

  // Dia Argentina, Spanish discount chain (not Cencosud). 3rd AR
  // retailer; gives Argentina full triangulation (Disco + Vea + Dia).
  const diaPromise: Promise<ScraperResult | null> =
    scrapeDiaAr().catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`  dia-ar: scrape threw, skipping ($${msg})`);
      return null;
    });

  // El Dorado Uruguay (VTEX). 20th country, first UY adapter, new
  // UYU currency. Conaprole dominates dairy; locals carry beer.
  const eldoradoPromise: Promise<ScraperResult | null> =
    scrapeEldoradoUy().catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`  eldorado-uy: scrape threw, skipping ($${msg})`);
      return null;
    });

  const [novus, mercadona, sainsburys, conad, carrefour, rewe, migros, disco, wong, olimpica, chedraui, auchan, auchanRo, rimiEe, rimiLv, rimiLt, continente, carulla, masxmenos, plazaVea, mambo, exito, zonaSul, vea, metro, hortifruti, dia, eldorado] = await Promise.all([
    scrapeNovusUa(),
    scrapeMercadonaEs(),
    sainsburysPromise,
    conadPromise,
    carrefourPromise,
    rewePromise,
    migrosPromise,
    discoPromise,
    wongPromise,
    olimpicaPromise,
    chedrauiPromise,
    auchanPromise,
    auchanRoPromise,
    rimiEePromise,
    rimiLvPromise,
    rimiLtPromise,
    continentePromise,
    carullaPromise,
    masxmenosPromise,
    plazaVeaPromise,
    mamboPromise,
    exitoPromise,
    zonaSulPromise,
    veaPromise,
    metroPromise,
    hortifrutiPromise,
    diaPromise,
    eldoradoPromise,
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
  if (disco) {
    console.log(`  disco-ar     : ${disco.scraped.length} scraped, ${disco.misses.length} miss`);
  } else {
    console.log("  disco-ar     : SKIPPED (scraper threw)");
  }
  if (wong) {
    console.log(`  wong-pe      : ${wong.scraped.length} scraped, ${wong.misses.length} miss`);
  } else {
    console.log("  wong-pe      : SKIPPED (scraper threw)");
  }
  if (olimpica) {
    console.log(`  olimpica-co  : ${olimpica.scraped.length} scraped, ${olimpica.misses.length} miss`);
  } else {
    console.log("  olimpica-co  : SKIPPED (scraper threw)");
  }
  if (chedraui) {
    console.log(`  chedraui-mx  : ${chedraui.scraped.length} scraped, ${chedraui.misses.length} miss`);
  } else {
    console.log("  chedraui-mx  : SKIPPED (scraper threw)");
  }
  if (auchan) {
    console.log(`  auchan-pl    : ${auchan.scraped.length} scraped, ${auchan.misses.length} miss`);
  } else {
    console.log("  auchan-pl    : SKIPPED (scraper threw)");
  }
  if (auchanRo) {
    console.log(`  auchan-ro    : ${auchanRo.scraped.length} scraped, ${auchanRo.misses.length} miss`);
  } else {
    console.log("  auchan-ro    : SKIPPED (scraper threw)");
  }
  if (rimiEe) {
    console.log(`  rimi-ee      : ${rimiEe.scraped.length} scraped, ${rimiEe.misses.length} miss`);
  } else {
    console.log("  rimi-ee      : SKIPPED (scraper threw)");
  }
  if (rimiLv) {
    console.log(`  rimi-lv      : ${rimiLv.scraped.length} scraped, ${rimiLv.misses.length} miss`);
  } else {
    console.log("  rimi-lv      : SKIPPED (scraper threw)");
  }
  if (rimiLt) {
    console.log(`  rimi-lt      : ${rimiLt.scraped.length} scraped, ${rimiLt.misses.length} miss`);
  } else {
    console.log("  rimi-lt      : SKIPPED (scraper threw)");
  }
  if (continente) {
    console.log(`  continente-pt: ${continente.scraped.length} scraped, ${continente.misses.length} miss`);
  } else {
    console.log("  continente-pt: SKIPPED (scraper threw)");
  }
  if (carulla) {
    console.log(`  carulla-co   : ${carulla.scraped.length} scraped, ${carulla.misses.length} miss`);
  } else {
    console.log("  carulla-co   : SKIPPED (scraper threw)");
  }
  if (masxmenos) {
    console.log(`  masxmenos-cr : ${masxmenos.scraped.length} scraped, ${masxmenos.misses.length} miss`);
  } else {
    console.log("  masxmenos-cr : SKIPPED (scraper threw)");
  }
  if (plazaVea) {
    console.log(`  plaza-vea-pe : ${plazaVea.scraped.length} scraped, ${plazaVea.misses.length} miss`);
  } else {
    console.log("  plaza-vea-pe : SKIPPED (scraper threw)");
  }
  if (mambo) {
    console.log(`  mambo-br     : ${mambo.scraped.length} scraped, ${mambo.misses.length} miss`);
  } else {
    console.log("  mambo-br     : SKIPPED (scraper threw)");
  }
  if (exito) {
    console.log(`  exito-co     : ${exito.scraped.length} scraped, ${exito.misses.length} miss`);
  } else {
    console.log("  exito-co     : SKIPPED (scraper threw)");
  }
  if (zonaSul) {
    console.log(`  zona-sul-br  : ${zonaSul.scraped.length} scraped, ${zonaSul.misses.length} miss`);
  } else {
    console.log("  zona-sul-br  : SKIPPED (scraper threw)");
  }
  if (vea) {
    console.log(`  vea-ar       : ${vea.scraped.length} scraped, ${vea.misses.length} miss`);
  } else {
    console.log("  vea-ar       : SKIPPED (scraper threw)");
  }
  if (metro) {
    console.log(`  metro-pe     : ${metro.scraped.length} scraped, ${metro.misses.length} miss`);
  } else {
    console.log("  metro-pe     : SKIPPED (scraper threw)");
  }
  if (hortifruti) {
    console.log(`  hortifruti-br: ${hortifruti.scraped.length} scraped, ${hortifruti.misses.length} miss`);
  } else {
    console.log("  hortifruti-br: SKIPPED (scraper threw)");
  }
  if (dia) {
    console.log(`  dia-ar       : ${dia.scraped.length} scraped, ${dia.misses.length} miss`);
  } else {
    console.log("  dia-ar       : SKIPPED (scraper threw)");
  }
  if (eldorado) {
    console.log(`  eldorado-uy  : ${eldorado.scraped.length} scraped, ${eldorado.misses.length} miss`);
  } else {
    console.log("  eldorado-uy  : SKIPPED (scraper threw)");
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
    ...(disco?.scraped ?? []),
    ...(wong?.scraped ?? []),
    ...(olimpica?.scraped ?? []),
    ...(chedraui?.scraped ?? []),
    ...(auchan?.scraped ?? []),
    ...(auchanRo?.scraped ?? []),
    ...(rimiEe?.scraped ?? []),
    ...(rimiLv?.scraped ?? []),
    ...(rimiLt?.scraped ?? []),
    ...(continente?.scraped ?? []),
    ...(carulla?.scraped ?? []),
    ...(masxmenos?.scraped ?? []),
    ...(plazaVea?.scraped ?? []),
    ...(mambo?.scraped ?? []),
    ...(exito?.scraped ?? []),
    ...(zonaSul?.scraped ?? []),
    ...(vea?.scraped ?? []),
    ...(metro?.scraped ?? []),
    ...(hortifruti?.scraped ?? []),
    ...(dia?.scraped ?? []),
    ...(eldorado?.scraped ?? []),
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
// @script: submit-batch.ts
// @perf: consider memoizing this computation
