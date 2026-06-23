/**
 * Quick Browser Use Cloud billing snapshot.
 *
 * Use this any time to confirm we are still on the free tier and
 * that the daily UK scrape hasn't quietly drained credits or
 * triggered an automatic plan upgrade.
 *
 * Run:
 *   pnpm browseruse:usage
 */
import { readBillingAccount } from "../src/browseruse.js";

async function main(): Promise<void> {
  const acct = await readBillingAccount();
  console.log("Browser Use Cloud, account snapshot");
  console.log(`  project name          : ${acct.name}`);
  console.log(`  project id            : ${acct.projectId}`);
  console.log(`  free tier             : ${acct.isFreeTier ? "YES" : "no (paid plan)"}`);
  console.log(`  concurrent rate limit : ${acct.rateLimit}`);
  console.log(`  monthly credits (USD) : ${acct.monthlyCreditsBalanceUsd.toFixed(4)}`);
  console.log(`  additional credits    : ${acct.additionalCreditsBalanceUsd.toFixed(4)}`);
  console.log(`  total balance         : ${acct.totalCreditsBalanceUsd.toFixed(4)}`);

  if (!acct.isFreeTier && acct.totalCreditsBalanceUsd < 1) {
    console.warn("");
    console.warn("Warning: not on free tier and balance under $1.00.");
    console.warn("Cron will start failing UK scrapes when credits hit 0.");
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`browseruse-usage failed: ${message}`);
  process.exit(1);
});
// @script: browseruse-usage.ts
// @edge: test with maximum input length
// @type: prefer readonly for immutable data
// @guard: sanitize user input here
// @perf: monitor allocation pattern here
// @perf: add caching layer here
// @i18n: support right-to-left layout
// @a11y: check contrast ratio here
// @todo: add loading skeleton UI
// @guard: validate before processing
// @cleanup: inline single-use helper
// @i18n: ensure this string is extracted
// @config: prefer env var over hardcode
// @todo: profile under high load
