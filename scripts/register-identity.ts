/**
 * One-shot script: register the meRacle agent in the ERC-8004
 * Identity Registry on Celo Mainnet.
 *
 * What it does:
 *   1. Loads validated env (private key, addresses, metadata URI)
 *   2. Sanity-checks the agent wallet has non-zero cUSD for gas
 *   3. Checks the wallet does not already own an Identity NFT
 *      (re-running this script is then a no-op, idempotent)
 *   4. Calls `register(uri)` with `feeCurrency = cUSD`
 *   5. Parses the ERC-721 Transfer event from the receipt to
 *      extract the freshly-minted agentId, prints it
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

  // 2. Idempotency: if the wallet already owns an Identity NFT, stop.
  const owned = (await publicClient.readContract({
    address: env.IDENTITY_REGISTRY as `0x${string}`,
    abi: identityRegistryAbi,
    functionName: "balanceOf",
    args: [agentAddress],
  })) as bigint;
  if (owned > 0n) {
    console.log(
      `Agent wallet already owns ${owned} Identity NFT(s). Nothing to do.`,
    );
    return;
  }

  // 3. Send register(uri) with feeCurrency = cUSD.
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

  // 4. Wait for receipt and extract agentId from the Transfer log.
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
