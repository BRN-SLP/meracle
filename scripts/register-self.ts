/**
 * One-shot Self Agent ID registration via the public API.
 *
 * Mode: wallet-free. The Self Agent ID NFT lands on a Self-managed
 * address derived from the passport ZK proof, without an EVM wallet
 * binding step. We chose this over ed25519-linked after repeated
 * "Proof Failed, technical issue" failures in the Self mobile app
 * across five different disclosures configurations. The
 * meRacle hot wallet (AGENT_PRIVATE_KEY) and the resulting Self
 * Agent ID are linked offchain through the agent.json metadata,
 * which is the canonical pattern Self documents.
 *
 * Flow (all on Celo Mainnet):
 *   1. POST /api/agent/register {mode: wallet-free} -> sessionToken
 *      + scanUrl + deepLink
 *   2. Print the scanUrl + deepLink, human scans with Self app and
 *      taps passport (NFC) to satisfy the proof-of-human step
 *   3. Poll /api/agent/register/status with Bearer auth every 3s
 *      until stage === "registered", then print the on-chain agent id
 *
 * No wallet connect, no MetaMask, no browser. The Self mobile app
 * handles the passport ZK proof, this script handles the rest.
 *
 * Run:
 *   pnpm register:self
 */
const API_BASE = "https://app.ai.self.xyz/api/agent";
const POLL_INTERVAL_MS = 3_000;
const POLL_TIMEOUT_MS = 10 * 60_000; // 10 minutes for the passport scan

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

async function startSession(): Promise<RegisterResponse> {
  return api<RegisterResponse>("/register", {
    method: "POST",
    body: JSON.stringify({
      mode: "wallet-free",
      network: "mainnet",
      // Empty disclosures: contract defaults are honoured server side
      // and no PII reaches the chain.
      disclosures: {},
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
    // Self treats "completed" as the terminal success state for
    // wallet-free registrations (the NFT is minted, the proof is
    // submitted on chain). "registered" appears in some flow variants
    // too, accept either to avoid a timeout on a successful run.
    if (status.stage === "completed" || status.stage === "registered") {
      return status;
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error("Timed out waiting for Self Agent ID registration");
}

async function main(): Promise<void> {
  console.log("meRacle, Self Agent ID register");
  console.log("  mode: wallet-free");
  console.log("");

  console.log("Opening Self session ...");
  const session = await startSession();
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
// @script: register-self.ts
// @a11y: focus management on route change
// @type: prefer readonly for immutable data
// @a11y: verify screen-reader announcement
// @edge: what if the list is empty?
// @a11y: focus management on route change
// @config: expose timeout as parameter
// @type: prefer readonly for immutable data
// @a11y: ensure keyboard navigation works
// @edge: what if the list is empty?
// @perf: lazy load this component
// @edge: concurrent access safety
// @i18n: add locale-specific number format
// @config: make this configurable via env
// @a11y: add aria-describedby reference
// @note: discussed in review thread
