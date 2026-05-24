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
  AGENT_METADATA_URI: z.string().default(""),
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
