/**
 * One-shot Self Agent ID registration via the public API.
 *
 * Mode: ed25519-linked. Binds the soulbound Self Agent ID NFT to an
 * existing EVM address (humanAddress) instead of an Ed25519-derived
 * placeholder address. The Ed25519 keypair remains the agent's
 * identity signer, humanAddress is the human owner who attests
 * through the passport ZK proof.
 *
 * Flow (all on Celo Mainnet):
 *   1. Read Ed25519 keypair + SELF_HUMAN_ADDRESS from env
 *   2. POST /api/agent/register/ed25519-challenge  -> challengeHash
 *   3. Sign challengeHash with Ed25519 private key
 *   4. POST /api/agent/register {mode: ed25519-linked, signature,
 *        humanAddress}  -> sessionToken + scanUrl + deepLink
 *   5. Print the scanUrl + deepLink, human scans with Self app and
 *      taps passport (NFC) to satisfy the proof-of-human step
 *   6. Poll /api/agent/register/status with Bearer auth every 3s
 *      until stage === "registered", then print the on-chain agent id
 *
 * No wallet connect, no MetaMask, no browser. The Self mobile app
 * handles the passport ZK proof, this script handles the rest. The
 * NFT lands on humanAddress, permanently flagged as verified human
 * on the Self Agent ID Registry.
 *
 * Run:
 *   pnpm register:self
 */
import { createPrivateKey, sign } from "node:crypto";

import { env } from "../src/env.js";

const API_BASE = "https://app.ai.self.xyz/api/agent";
const POLL_INTERVAL_MS = 3_000;
const POLL_TIMEOUT_MS = 10 * 60_000; // 10 minutes for the passport scan

interface ChallengeResponse {
  challengeHash: string; // 0x-prefixed bytes32
  nonce: string;
}

interface RegisterResponse {
  sessionToken: string;
  stage: string;
  scanUrl?: string;
  deepLink?: string;
  qrImageBase64?: string;
  agentAddress?: string;
  network?: string;
  expiresAt?: string;
  timeRemainingMs?: number;
  humanInstructions?: string[];
}

interface StatusResponse {
  stage: string; // "awaiting-scan" | "verified" | "registered" | ...
  agentId?: string | number;
  txHash?: string;
  blockNumber?: number;
  // ...
}

function requireKeys(): {
  pubHex: string;
  privHex: string;
  humanAddress: string;
} {
  if (!env.SELF_AGENT_ED25519_PUBLIC || !env.SELF_AGENT_ED25519_PRIVATE) {
    throw new Error(
      "SELF_AGENT_ED25519_PUBLIC and SELF_AGENT_ED25519_PRIVATE must be set " +
        "in .env. Generate with the snippet in .env.example or " +
        "scripts/gen-self-ed25519.ts.",
    );
  }
  if (!env.SELF_HUMAN_ADDRESS) {
    throw new Error(
      "SELF_HUMAN_ADDRESS must be set in .env. This is the personal " +
        "EVM wallet that will own the Self Agent ID NFT (NOT the agent " +
        "hot wallet). The passport ZK proof from the Self mobile app " +
        "will bind to this address. See .env.example for guidance.",
    );
  }
  return {
    pubHex: env.SELF_AGENT_ED25519_PUBLIC,
    privHex: env.SELF_AGENT_ED25519_PRIVATE,
    humanAddress: env.SELF_HUMAN_ADDRESS,
  };
}

/**
 * Build a node:crypto Ed25519 PrivateKey from the raw 32-byte seed
 * the env stores. node:crypto wants a DER-encoded PKCS8 blob, the
 * 16-byte prefix below is the standard SPKI envelope for Ed25519.
 */
function ed25519PrivateKeyFromSeed(privHex: string): ReturnType<typeof createPrivateKey> {
  const seed = Buffer.from(privHex, "hex");
  if (seed.length !== 32) {
    throw new Error(`Ed25519 seed must be 32 bytes, got ${seed.length}`);
  }
  const prefix = Buffer.from(
    "302e020100300506032b657004220420",
    "hex",
  );
  const der = Buffer.concat([prefix, seed]);
  return createPrivateKey({ key: der, format: "der", type: "pkcs8" });
}

async function api<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Self API ${path} -> ${res.status}: ${text.slice(0, 300)}`);
  }
  return text.length > 0 ? (JSON.parse(text) as T) : ({} as T);
}

async function fetchChallenge(
  pubHex: string,
  humanAddress: string,
): Promise<ChallengeResponse> {
  // ed25519-linked mode requires humanAddress in the challenge body
  // so the signed hash binds to the specific (pubkey, humanAddress)
  // pair. Without it Self issues a challenge for plain ed25519 mode
  // and /register later rejects the signature as "verification failed".
  return api<ChallengeResponse>("/register/ed25519-challenge", {
    method: "POST",
    body: JSON.stringify({
      pubkey: pubHex,
      network: "mainnet",
      mode: "ed25519-linked",
      humanAddress,
    }),
  });
}

function signChallenge(privHex: string, challengeHash: string): string {
  const key = ed25519PrivateKeyFromSeed(privHex);
  const hashHex = challengeHash.startsWith("0x")
    ? challengeHash.slice(2)
    : challengeHash;
  const message = Buffer.from(hashHex, "hex");
  // Ed25519 in node:crypto uses sign(null, message, key). 64-byte sig.
  const sig = sign(null, message, key);
  return sig.toString("hex");
}

async function startSession(
  pubHex: string,
  signatureHex: string,
  humanAddress: string,
): Promise<RegisterResponse> {
  return api<RegisterResponse>("/register", {
    method: "POST",
    body: JSON.stringify({
      // ed25519-linked binds the soulbound Self Agent ID NFT to an
      // existing EVM address (humanAddress) instead of an Ed25519-
      // derived address. The Ed25519 keypair remains the agent's
      // identity signer, humanAddress is the human owner who attests
      // through the passport ZK proof.
      mode: "ed25519-linked",
      network: "mainnet",
      ed25519Pubkey: pubHex,
      ed25519Signature: signatureHex,
      humanAddress,
      disclosures: {
        // Privacy-first defaults. The proof attests "owner is a real
        // human with a valid passport"; no other personal data hits
        // the chain.
        minimumAge: 0,
        ofac: false,
        nationality: false,
        name: false,
        date_of_birth: false,
        gender: false,
        issuing_state: false,
      },
    }),
  });
}

async function pollStatus(sessionToken: string): Promise<StatusResponse> {
  const start = Date.now();
  let lastStage = "";
  while (Date.now() - start < POLL_TIMEOUT_MS) {
    const status = await api<StatusResponse>("/register/status", {
      method: "GET",
      headers: { Authorization: `Bearer ${sessionToken}` },
    });
    if (status.stage !== lastStage) {
      console.log(`  stage: ${status.stage}`);
      lastStage = status.stage;
    }
    if (status.stage === "registered") return status;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error("Timed out waiting for Self Agent ID registration");
}

async function main(): Promise<void> {
  const { pubHex, privHex, humanAddress } = requireKeys();
  console.log("meRacle, Self Agent ID register");
  console.log(`  ed25519 pubkey: ${pubHex}`);
  console.log(`  humanAddress  : ${humanAddress}`);
  console.log("");

  console.log("Requesting challenge ...");
  const { challengeHash, nonce } = await fetchChallenge(pubHex, humanAddress);
  console.log(`  challengeHash: ${challengeHash}`);
  console.log(`  nonce        : ${nonce}`);

  console.log("Signing challenge with Ed25519 private key ...");
  const signatureHex = signChallenge(privHex, challengeHash);
  console.log(`  signature: ${signatureHex.slice(0, 16)}... (${signatureHex.length} hex chars)`);

  console.log("Opening Self session (mode: ed25519-linked) ...");
  const session = await startSession(pubHex, signatureHex, humanAddress);
  console.log(`  sessionToken : ${session.sessionToken.slice(0, 24)}...`);
  console.log(`  stage        : ${session.stage}`);
  if (session.agentAddress) {
    console.log(`  agent address: ${session.agentAddress}`);
  }
  if (session.timeRemainingMs !== undefined) {
    console.log(
      `  time window  : ${Math.round(session.timeRemainingMs / 60000)} minutes`,
    );
  }
  console.log("");
  console.log("==============================================================");
  console.log("ACTION REQUIRED, do this on your phone:");
  console.log("==============================================================");
  if (session.humanInstructions) {
    for (const line of session.humanInstructions) {
      console.log(`  - ${line}`);
    }
  }
  if (session.scanUrl) {
    console.log("");
    console.log("Scan URL (open on the desktop, point Self app camera at it):");
    console.log(`  ${session.scanUrl}`);
  }
  if (session.deepLink) {
    console.log("");
    console.log("Deep link (open ON the phone where Self app is installed):");
    console.log(`  ${session.deepLink}`);
  }
  console.log("==============================================================");
  console.log("");

  const final = await pollStatus(session.sessionToken);
  console.log("");
  console.log("REGISTERED on Self Agent ID Registry (Celo Mainnet).");
  console.log(`  Self Agent ID : ${final.agentId ?? "(not returned)"}`);
  console.log(`  Tx hash       : ${final.txHash ?? "(not returned)"}`);
  if (final.blockNumber !== undefined) {
    console.log(`  Block         : ${final.blockNumber}`);
  }
  if (final.txHash) {
    console.log(`  Celoscan      : https://celoscan.io/tx/${final.txHash}`);
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`register-self failed: ${message}`);
  process.exit(1);
});
