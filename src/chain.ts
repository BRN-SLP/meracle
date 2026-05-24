/**
 * Celo Mainnet viem clients.
 *
 * Public client reads, wallet client signs and broadcasts. The
 * agent account is derived from `AGENT_PRIVATE_KEY` (validated by
 * `env.ts`) so the agent address is deterministic, the same key
 * always produces the same address.
 *
 * Fee currency: every write call should be passed `feeCurrency:
 * CUSD_ADDRESS` so gas is paid in cUSD. The agent holds cUSD only,
 * no CELO. cUSD is 18-decimal Mento stablecoin and is whitelisted
 * as a native fee currency (no adapter required, unlike 6-decimal
 * USDC/USDT which need adapters).
 *
 * CIP-64 transactions (type `0x7b`) carry ~50k gas overhead vs
 * native CELO gas, factor that in when budgeting.
 */
import { createPublicClient, createWalletClient, http } from "viem";
import type { Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";

import { env } from "./env.js";

export const agentAccount = privateKeyToAccount(
  env.AGENT_PRIVATE_KEY as `0x${string}`,
);

export const agentAddress: Address = agentAccount.address;

export const publicClient = createPublicClient({
  chain: celo,
  transport: http(env.CELO_RPC_URL),
});

export const walletClient = createWalletClient({
  account: agentAccount,
  chain: celo,
  transport: http(env.CELO_RPC_URL),
});

/**
 * cUSD address typed as a 0x-string literal, ready to pass as the
 * `feeCurrency` option to `walletClient.writeContract` / similar.
 *
 * Usage:
 * ```ts
 * await walletClient.writeContract({
 *   address: SOME_CONTRACT,
 *   abi,
 *   functionName: "foo",
 *   args: [...],
 *   feeCurrency: cusdFeeCurrency,
 * });
 * ```
 */
export const cusdFeeCurrency: Address = env.CUSD_ADDRESS as Address;
