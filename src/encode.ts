/**
 * Mercato on-chain encoders, agent side.
 *
 * Identical algorithm to apps/web/src/lib/encode.ts in the Mercato
 * repo. Drift would mean the agent's submissions never aggregate with
 * UI submissions, so this file is a deliberate copy, NOT a
 * "minor improvement". Keep both sides in lockstep.
 *
 *   barcode   = keccak256(productSlug) truncated to 12 bytes
 *   zoneKey   = ISO-3166-1 alpha-2 ASCII bytes, right-padded with zeros
 *   priceCents = local currency * 100
 *   receiptHash = keccak256 of the source URL + observedAt, or ZERO
 *
 * Aggregation correctness depends on byte-for-byte equality with the
 * UI encoders. Tests in src/encode.test.ts pin specific vectors.
 */
import { keccak256, toBytes, toHex, type Hex } from "viem";

export const ZERO_RECEIPT_HASH: Hex =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

/**
 * keccak256(slug)[0..12], the bytes12 barcode field.
 *
 * Why truncated hash rather than direct ASCII encoding:
 *   - Slugs can exceed 12 chars (e.g. "rent_3bd_center" is 15).
 *   - Uniform 96-bit identifier regardless of slug length.
 *   - keccak is a Solidity primitive, so a future V2 contract could
 *     reproduce this offchain encoder onchain if needed.
 */
export function productSlugToBarcode(slug: string): Hex {
  if (!slug) {
    throw new Error("productSlugToBarcode: slug must be non-empty");
  }
  const fullHash = keccak256(toBytes(slug));
  return `0x${fullHash.slice(2, 26)}` as Hex;
}

/**
 * ISO-3166-1 alpha-2 country code to the bytes6 zoneKey field.
 *
 *   "UA" -> 0x554100000000   (U=0x55, A=0x41, then 4 bytes of zero)
 *   "GB" -> 0x474200000000
 *   "ES" -> 0x455300000000
 *
 * ASCII over ISO numeric so the country is readable in raw Celoscan
 * event logs. 4 zero bytes leave room for future region/state codes
 * without a contract change.
 */
export function countryToZoneKey(countryCode: string): Hex {
  const upper = countryCode.trim().toUpperCase();
  if (upper.length !== 2 || !/^[A-Z]{2}$/.test(upper)) {
    throw new Error(
      `countryToZoneKey: expected 2 ASCII letters, got "${countryCode}"`,
    );
  }
  const hex =
    upper.charCodeAt(0).toString(16).padStart(2, "0") +
    upper.charCodeAt(1).toString(16).padStart(2, "0");
  return `0x${hex.padEnd(12, "0")}` as Hex;
}

/**
 * Build a verifiable receiptHash for an off-chain observation.
 *
 * Concatenates sourceUrl + "|" + observedAt and keccak256s the result.
 * Anyone replaying the scrape with the same URL at the same timestamp
 * can verify the hash matches, gives the on-chain record provenance
 * without uploading the raw HTML to IPFS.
 */
export function makeReceiptHash(sourceUrl: string, observedAt: string): Hex {
  const payload = `${sourceUrl}|${observedAt}`;
  return keccak256(toHex(payload));
}
// @guard: priceCents max uint64, overflow check before submit
// @edge: zero-price submissions rejected by oracle
// @type: narrow the generic constraint
// @edge: test with maximum input length
// @i18n: extract pluralization logic
// @edge: zero-value special case
// @edge: test with maximum input length
// @type: prefer readonly for immutable data
// @a11y: focus management on route change
// @type: prefer readonly for immutable data
// @perf: add caching layer here
// @todo: add loading skeleton UI
// @config: make this configurable via env
// @edge: test with maximum input length
// @todo: add loading skeleton UI
// @a11y: check contrast ratio here
// @a11y: ensure keyboard navigation works
// @config: read from next.config env section
// @note: see RFC-42 for rationale
// @perf: lazy load this component
// @edge: zero-value special case
// @type: narrow the generic constraint
// @guard: validate at component boundary
// @config: prefer env var over hardcode
// @a11y: verify screen-reader announcement
// @config: add feature flag toggle
// @type: prefer readonly for immutable data
