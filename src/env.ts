/**
 * Environment loader, validated through Zod.
 *
 * Treats `process.env` as `unknown` at the boundary and narrows it
 * into a strongly typed `Env` object via a single schema. Every
 * script imports `env` from here, no module reads `process.env`
 * directly.
 *
 * Required keys live in `.env.example`. Missing or malformed values
 * throw at startup with a readable Zod error, before any RPC or
 * transaction is attempted.
 */
import "dotenv/config";
import { z } from "zod";

const hexAddress = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, "must be a 0x-prefixed 20-byte hex address");

const hexPrivateKey = z
  .string()
  .regex(/^0x[a-fA-F0-9]{64}$/, "must be a 0x-prefixed 32-byte hex string");

const EnvSchema = z.object({
  CELO_RPC_URL: z.string().url().default("https://forno.celo.org"),
  AGENT_PRIVATE_KEY: hexPrivateKey,
  MERCATO_ADDRESS: hexAddress,
  IDENTITY_REGISTRY: hexAddress,
  REPUTATION_REGISTRY: hexAddress,
  SELF_AGENT_REGISTRY: hexAddress,
  // cUSD on Celo Mainnet. 18-decimal Mento stablecoin, native fee
  // currency (used directly as the address, no adapter needed).
  CUSD_ADDRESS: hexAddress.default(
    "0x765DE816845861e75A25fCA122bb6898B8B1282a",
  ),
  AGENT_METADATA_URI: z
    .string()
    .default(
      "https://raw.githubusercontent.com/BRN-SLP/meracle/main/agent.json",
    ),
  // Browser Use Cloud API key, used by the UK scraper to spin up
  // a remote chromium session behind a UK residential proxy.
  // Optional, scrapers needing it short-circuit when absent.
  BROWSER_USE_API_KEY: z.string().regex(/^bu_/).optional(),
  // Ed25519 keypair used to register the agent on Self Agent ID.
  // Generated once locally and stored in ~/.secrets, NEVER committed.
  // Only needed when running scripts/register-self.ts.
  SELF_AGENT_ED25519_PUBLIC: z.string().regex(/^[0-9a-f]{64}$/i).optional(),
  SELF_AGENT_ED25519_PRIVATE: z.string().regex(/^[0-9a-f]{64}$/i).optional(),
  // Personal EVM wallet that owns the Self Agent ID NFT once minted.
  // Self ties this address to the operator's passport ZK proof, so it
  // becomes a permanent "verified human" record on the Self Agent ID
  // Registry. Distinct from AGENT_PRIVATE_KEY: that one is the hot
  // wallet which submits prices on chain, this one is the human owner.
  // Required only by scripts/register-self.ts in ed25519-linked mode.
  SELF_HUMAN_ADDRESS: hexAddress.optional(),
  // REWE delivery market identifier. Without it the /api/products
  // endpoint returns the catalog without prices (NO_HIT or empty
  // articles list). Capture once via a Browser Use Cloud session that
  // walks the Standort modal at 10115 Berlin Mitte, then hardcode the
  // pair here. Both keys are the same numeric string in practice but
  // Rewe expects both names on every request.
  // See docs/deferred-retailers.md for the discovery procedure.
  REWE_WW_IDENT: z.string().regex(/^\d{4,8}$/).optional(),
  REWE_MARKET_CODE: z.string().regex(/^\d{4,8}$/).optional(),
});

export type Env = z.infer<typeof EnvSchema>;

function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment:\n${issues}`);
  }
  return parsed.data;
}

export const env: Env = loadEnv();
// @config: scraper-specific env vars are optional
