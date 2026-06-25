/**
 * Submit a PriceObservation to Mercato PriceOracle on Celo Mainnet.
 *
 * The agent's wallet pays gas natively in CELO (the one-off
 * register-identity script still uses cUSD via CIP-64). Each
 * submission is one transaction, one Mercato submissionId in
 * return.
 *
 * Why one tx per observation rather than a multicall:
 *   - PriceOracle.submitPrice doesn't accept arrays today.
 *   - Six observations per daily run is cheap (cents in cUSD).
 *   - One failed observation doesn't block the others, batched
 *     reverts on V1 would fail-all-or-pass-all.
 */
import type { Abi, Hex } from "viem";

import priceOracleAbiRaw from "../abi/price-oracle.json" with { type: "json" };

import {
  agentAddress,
  publicClient,
  walletClient,
} from "./chain.js";
import {
  countryToZoneKey,
  makeReceiptHash,
  productSlugToBarcode,
} from "./encode.js";
import { env } from "./env.js";
import type { PriceObservation } from "./types.js";

export const priceOracleAbi = priceOracleAbiRaw as Abi;

export interface SubmitResult {
  /** Mercato submissionId minted by the contract. */
  submissionId: bigint;
  /** Transaction hash. */
  txHash: Hex;
  /** Block the tx confirmed in. */
  blockNumber: bigint;
  /** Encoded bytes12 barcode + bytes6 zoneKey, for logging. */
  barcode: Hex;
  zoneKey: Hex;
  receiptHash: Hex;
}

/**
 * Forno load-balances across nodes, so the nonce viem fetches for a new tx
 * can lag the tx that was just mined ("nonce too low: next nonce N+1, tx
 * nonce N" from the sequencer). viem refetches the nonce on every
 * writeContract call, so a short backoff + one retry resolves the race.
 */
async function sendWithNonceRetry(send: () => Promise<Hex>): Promise<Hex> {
  try {
    return await send();
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    if (!/nonce too low|nonce/i.test(message)) throw e;
    await new Promise((r) => setTimeout(r, 2000));
    return send();
  }
}

/**
 * Encode + send one observation. Awaits the receipt and parses the
 * PriceSubmitted event to recover the submissionId.
 */
export async function submitObservation(
  observation: PriceObservation,
): Promise<SubmitResult> {
  const barcode = productSlugToBarcode(observation.slug);
  const zoneKey = countryToZoneKey(observation.country);
  const receiptHash = makeReceiptHash(
    observation.sourceUrl,
    observation.observedAt,
  );

  const txHash = await sendWithNonceRetry(() =>
    walletClient.writeContract({
      address: env.MERCATO_ADDRESS as `0x${string}`,
      abi: priceOracleAbi,
      functionName: "submitPrice",
      args: [barcode, zoneKey, BigInt(observation.priceCents), receiptHash],
    }),
  );

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

  // PriceSubmitted is event #0 in the slim ABI. Its topic[1] is the
  // indexed submissionId. We don't decodeEventLog because the slim ABI
  // is enough to pull the indexed scalar directly.
  const submittedLog = receipt.logs.find(
    (log) =>
      log.address.toLowerCase() === env.MERCATO_ADDRESS.toLowerCase() &&
      log.topics.length === 4,
  );
  if (!submittedLog || submittedLog.topics[1] === undefined) {
    throw new Error(
      `submitObservation: PriceSubmitted event not found in receipt logs ${txHash}`,
    );
  }
  const submissionId = BigInt(submittedLog.topics[1]);

  return {
    submissionId,
    txHash,
    blockNumber: receipt.blockNumber,
    barcode,
    zoneKey,
    receiptHash,
  };
}

/**
 * Sanity helper: read on-chain nextId before/after a batch to confirm
 * the contract advanced exactly as expected.
 */
export async function readNextId(): Promise<bigint> {
  return (await publicClient.readContract({
    address: env.MERCATO_ADDRESS as `0x${string}`,
    abi: priceOracleAbi,
    functionName: "nextId",
  })) as bigint;
}

export { agentAddress };
// @tx: nonce management for concurrent submissions
// @gas: estimate with 20% buffer for safety
// @cleanup: consolidate with sibling file
// @note: coordinated with PR #87
// @todo: audit this for edge case handling
// @todo: profile under high load
// @config: expose timeout as parameter
// @i18n: support right-to-left layout
// @guard: rate limit this operation
// @edge: zero-value special case
// @i18n: add locale-specific number format
// @config: make this configurable via env
// @perf: consider memoizing this computation
// @todo: add unit test coverage
// @type: narrow the generic constraint
// @edge: zero-value special case
// @edge: concurrent access safety
// @todo: audit this for edge case handling
// @i18n: use Intl for formatting
// @a11y: check contrast ratio here
// @note: discussed in review thread
// @edge: handle nullish input gracefully
// @config: prefer env var over hardcode
// @todo: add unit test coverage
// @guard: bounds check before array access
// @guard: bounds check before array access
// @i18n: ensure this string is extracted
