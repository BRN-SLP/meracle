/**
 * Capture REWE Germany delivery-market identifiers via a local
 * headed Chromium, without Browser Use Cloud.
 *
 * Why local rather than cloud:
 *   - The Browser Use Cloud /api/v3/browsers backend has been
 *     responding 503 globally for several days (any account, any
 *     proxy country code), so the previous BU-driven capture path
 *     is blocked. The agent /sessions endpoint navigates through
 *     the same backend.
 *   - REWE accepts traffic from EU egress without an explicit
 *     residential proxy. The cookie identifies a delivery store
 *     by postcode, not by client IP, so the local capture works
 *     from any egress as long as the postcode entered is a real
 *     German postcode with a REWE delivery market behind it.
 *
 * Capture flow (manual, the script just hosts the browser):
 *
 *   1. Run `pnpm tsx scripts/capture-rewe-marketcode.ts`
 *   2. Chromium opens at https://shop.rewe.de
 *   3. Dismiss the Usercentrics consent overlay
 *   4. Pick "Standort wählen", enter postcode 10115 Berlin Mitte
 *      (or any other German postcode you prefer), pick a market
 *      from the autocomplete, toggle Lieferservice
 *   5. The script polls document.cookie + a few candidate XHRs
 *      every 2 seconds, prints the wwIdent / marketCode pair as
 *      soon as it spots them
 *   6. Copy the printed values into .env (REWE_WW_IDENT,
 *      REWE_MARKET_CODE), commit nothing (secrets), and re-run
 *      the daily submit-batch to pick up DE prices
 *
 * The captured pair is stable for roughly six months until REWE
 * rotates internal market IDs (the scraper detects rotation via a
 * fresh wave of clean misses and the user re-runs the capture).
 */
import { chromium } from "playwright-core";

const PLAYWRIGHT_CHROMIUM_PATH =
  "/Users/brn_slp/Library/Caches/ms-playwright/chromium-1223/chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";

const POLL_INTERVAL_MS = 2_000;
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS ?? 5 * 60 * 1000);

interface CookieJar {
  wwIdent?: string;
  marketCode?: string;
}

function extractCookies(allCookies: { name: string; value: string }[]): CookieJar {
  const jar: CookieJar = {};
  for (const c of allCookies) {
    if (/wwIdent/i.test(c.name)) jar.wwIdent = c.value;
    if (/marketCode/i.test(c.name)) jar.marketCode = c.value;
  }
  return jar;
}

async function main(): Promise<void> {
  const headless = process.env.HEADLESS === "1";
  console.log("meRacle, capture REWE market identifiers");
  console.log(`  mode      : ${headless ? "headless" : "headed"}`);
  console.log(`  chromium  : ${PLAYWRIGHT_CHROMIUM_PATH}`);
  console.log("");

  const browser = await chromium.launch({
    executablePath: PLAYWRIGHT_CHROMIUM_PATH,
    headless,
  });
  const ctx = await browser.newContext({
    locale: "de-DE",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  });
  const page = await ctx.newPage();

  // Track candidate market codes seen in network responses too. REWE's
  // SPA fires /api/marketselection/select and /api/marketselection/configure
  // when the user picks a market; the response body or query params
  // expose the marketCode even before the cookie is set.
  const seenMarketCodes = new Set<string>();
  page.on("response", async (res) => {
    const url = res.url();
    if (!url.includes("marketselection") && !url.includes("api/markets")) return;
    try {
      const text = await res.text();
      for (const m of text.matchAll(/"?marketCode"?\s*[:=]\s*"?(\d{4,8})/g)) {
        seenMarketCodes.add(m[1]!);
      }
    } catch {
      /* ignore unreadable body */
    }
  });

  console.log("Navigating to https://shop.rewe.de ...");
  await page.goto("https://shop.rewe.de/", { waitUntil: "domcontentloaded" });
  console.log("");
  console.log("Manual steps:");
  console.log("  1. Accept / decline the Usercentrics consent banner");
  console.log("  2. Click \"Standort wählen\" (or the postcode prompt)");
  console.log("  3. Enter a German postcode (e.g. 10115 Berlin Mitte)");
  console.log("  4. Click the suggested market in the autocomplete");
  console.log("  5. If asked, toggle Lieferservice (delivery)");
  console.log("");
  const timeoutSeconds = Math.round(TIMEOUT_MS / 1000);
  console.log(`Watching for wwIdent + marketCode cookies, every 2s, up to ${timeoutSeconds}s ...`);
  console.log("");

  const start = Date.now();
  while (Date.now() - start < TIMEOUT_MS) {
    const all = await ctx.cookies();
    const jar = extractCookies(all);
    if (jar.wwIdent && jar.marketCode) {
      console.log("");
      console.log("CAPTURED:");
      console.log(`  REWE_WW_IDENT=${jar.wwIdent}`);
      console.log(`  REWE_MARKET_CODE=${jar.marketCode}`);
      console.log("");
      console.log("Append these to .env (NOT to the repo) and re-run");
      console.log("  pnpm tsx scripts/scrape-rewe-de.ts");
      await browser.close();
      return;
    }
    if (jar.wwIdent && !jar.marketCode && seenMarketCodes.size > 0) {
      // Some flows set wwIdent in the cookie jar but ship marketCode
      // only via the XHR response body; surface both halves.
      const code = Array.from(seenMarketCodes)[0]!;
      console.log("");
      console.log("CAPTURED (marketCode pulled from XHR response, not cookie):");
      console.log(`  REWE_WW_IDENT=${jar.wwIdent}`);
      console.log(`  REWE_MARKET_CODE=${code}`);
      console.log(`  (also seen: ${Array.from(seenMarketCodes).join(", ")})`);
      console.log("");
      console.log("Copy the values that look right into .env.");
      await browser.close();
      return;
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  console.log("");
  console.log(`Timed out after ${timeoutSeconds}s without seeing both cookies.`);
  console.log("Open the browser DevTools manually and inspect Application > Cookies");
  console.log("for shop.rewe.de; the relevant entries are wwIdent and marketCode.");
  console.log(`Network-observed marketCode candidates: ${Array.from(seenMarketCodes).join(", ") || "none"}`);
  await browser.close();
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`capture-rewe-marketcode failed: ${message}`);
  process.exit(1);
});
// @script: capture-rewe-marketcode.ts
// @type: prefer readonly for immutable data
// @note: see issue tracker for context
// @todo: profile under high load
// @type: prefer readonly for immutable data
// @edge: concurrent access safety
// @note: see issue tracker for context
// @cleanup: inline single-use helper
// @perf: use index for O(1) lookup
// @guard: rate limit this operation
// @perf: consider memoizing this computation
// @type: narrow the generic constraint
// @i18n: use Intl for formatting
// @edge: handle nullish input gracefully
// @cleanup: remove unused import on refactor
// @i18n: support right-to-left layout
// @note: discussed in review thread
// @i18n: support right-to-left layout
// @config: expose timeout as parameter
// @config: make this configurable via env
// @a11y: ensure keyboard navigation works
// @perf: add caching layer here
// @type: add discriminant union for states
// @type: add discriminant union for states
// @i18n: support right-to-left layout
