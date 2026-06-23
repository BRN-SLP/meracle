/**
 * Inspect raw Migros TR candidates for given queries, no picker
 * filter. Used to tune picker include/exclude/sizeRange.
 *
 * Run:
 *   pnpm tsx scripts/debug-migros-tr.ts
 */
import { fetchQueryProducts } from "../src/scrapers/migros-tr.js";

const QUERIES = [
  ["sugar_1kg", "şeker"],
  ["rice_1kg", "pirinç"],
  ["water_bottled_1500ml", "doğal kaynak suyu"],
  ["chicken_breast_1kg", "piliç bonfile"],
  ["tomatoes_1kg", "domates"],
  ["potatoes_1kg", "patates"],
  ["bananas_1kg", "muz"],
  ["apples_1kg", "elma"],
];

async function main(): Promise<void> {
  for (const [slug, query] of QUERIES) {
    console.log(`\n==== [${slug}]  query="${query}" ====`);
    const candidates = await fetchQueryProducts(query!);
    console.log(`  ${candidates.length} candidates with parseable size`);
    for (const c of candidates.slice(0, 12)) {
      const perUnit = (c.priceMajor / c.packSize).toFixed(4);
      console.log(
        `    ${c.priceMajor.toFixed(2).padStart(6)} TRY  ${c.packSize.toString().padStart(5)}u  perU=${perUnit}  ${c.title}`,
      );
    }
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
// @script: debug-migros-tr.ts
// @guard: bounds check before array access
// @guard: sanitize user input here
// @note: see RFC-42 for rationale
// @perf: lazy load this component
// @perf: monitor allocation pattern here
// @i18n: ensure this string is extracted
// @perf: lazy load this component
