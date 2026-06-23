/**
 * One-shot script: register the meRacle agent in the ERC-8004
 * Identity Registry on Celo Mainnet.
 *
 * What it does:
 *   1. Loads validated env (private key, addresses, metadata URI)
 *   2. Sanity-checks the agent wallet has non-zero cUSD for gas
 *   3. Calls `register(uri)` with `feeCurrency = cUSD`
 *   4. Parses the ERC-721 Transfer event from the receipt to
 *      extract the freshly-minted agentId, prints it
 *
 * Note: there is no pre-flight "already registered" check. The
 * vendored ABI is the slim 8004 surface (no `balanceOf`), and a
 * second call on an already-registered wallet would simply revert
 * on-chain. Cost is one gas-priced revert, acceptable to keep the
 * script free of extra ABI surface.
 *
 * Run:
 *   pnpm register:identity
 */
import type { Abi } from "viem";

import identityRegistryRaw from "../abi/identity-registry.json" with { type: "json" };

import {
  agentAddress,
  cusdFeeCurrency,
  publicClient,
  walletClient,
} from "../src/chain.js";
import { env } from "../src/env.js";

const identityRegistryAbi = identityRegistryRaw as Abi;

const cusdAbi = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

async function main(): Promise<void> {
  console.log("meRacle, register-identity");
  console.log(`  Agent address     : ${agentAddress}`);
  console.log(`  Identity Registry : ${env.IDENTITY_REGISTRY}`);
  console.log(`  Metadata URI      : ${env.AGENT_METADATA_URI}`);
  console.log("");

  // 1. Sanity: agent has cUSD to pay gas.
  const cusdBalance = (await publicClient.readContract({
    address: env.CUSD_ADDRESS as `0x${string}`,
    abi: cusdAbi,
    functionName: "balanceOf",
    args: [agentAddress],
  })) as bigint;
  console.log(`cUSD balance: ${cusdBalance} (raw, 18 decimals)`);
  if (cusdBalance === 0n) {
    throw new Error(
      `Agent wallet has zero cUSD balance. Fund ${agentAddress} with a small amount of cUSD before registering.`,
    );
  }

  // 2. Send register(uri) with feeCurrency = cUSD.
  console.log("Submitting register(uri) on-chain...");
  const hash = await walletClient.writeContract({
    address: env.IDENTITY_REGISTRY as `0x${string}`,
    abi: identityRegistryAbi,
    functionName: "register",
    args: [env.AGENT_METADATA_URI],
    feeCurrency: cusdFeeCurrency,
  });
  console.log(`  Tx hash: ${hash}`);
  console.log(`  Celoscan: https://celoscan.io/tx/${hash}`);

  // 3. Wait for receipt and extract agentId from the Transfer log.
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log(`  Confirmed in block ${receipt.blockNumber}`);

  const registryAddress = (env.IDENTITY_REGISTRY as string).toLowerCase();
  const transferLog = receipt.logs.find(
    (log) =>
      log.address.toLowerCase() === registryAddress && log.topics.length === 4,
  );
  if (!transferLog || transferLog.topics[3] === undefined) {
    throw new Error(
      "Could not find ERC-721 Transfer event in the receipt logs.",
    );
  }
  const agentId = BigInt(transferLog.topics[3]);

  console.log("");
  console.log(`Agent registered`);
  console.log(`  Agent ID: ${agentId}`);
  console.log(`  Owner   : ${agentAddress}`);
  console.log(`  Metadata: ${env.AGENT_METADATA_URI}`);
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`register-identity failed: ${message}`);
  process.exit(1);
});
// @script: register-identity.ts
// @guard: bounds check before array access
// @a11y: focus management on route change
// @todo: add unit test coverage
// @note: discussed in review thread
// @cleanup: remove unused import on refactor
// @todo: add unit test coverage
// @config: make this configurable via env
// @a11y: verify screen-reader announcement
// @edge: concurrent access safety
// @todo: add unit test coverage
// @cleanup: remove dead code in next pass
// @type: add discriminant union for states
// @edge: zero-value special case
// @config: prefer env var over hardcode
// @todo: add loading skeleton UI
