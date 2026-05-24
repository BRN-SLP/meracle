# Registering meRacle on the Self Agent ID Registry

The Self Agent ID is the second leg of the AI Agents Prize Pool requirement (alongside ERC-8004 Identity). This guide documents the one-shot CLI flow that mints a soulbound Self Agent ID NFT bound to a chosen EVM address, using the public Self HTTP API and the Self mobile app for the passport ZK proof. No portal clicks, no MetaMask, no wallet-connect.

## Identity model

meRacle uses three distinct identities. Keep them straight, they each have a different role.

| Identity | Role | How it is set |
|---|---|---|
| `humanAddress` (personal EVM wallet) | Owns the Self Agent ID NFT. Tagged on chain as "passport-attested human" by the Self mobile app. | `.env` variable `SELF_HUMAN_ADDRESS` |
| Ed25519 keypair | The agent's identity signer in the Self protocol. The mobile app proof is bound to the Ed25519 public key, and Self uses the keypair to verify future agent claims. | `.env` variables `SELF_AGENT_ED25519_PUBLIC` / `SELF_AGENT_ED25519_PRIVATE` |
| `AGENT_PRIVATE_KEY` (agent hot wallet) | Pays gas, holds the ERC-8004 NFT, submits price observations on the Mercato PriceOracle. Operational only, never holds the Self Agent ID NFT. | `.env` variable `AGENT_PRIVATE_KEY` |

The three are linked off chain through `agent.json` metadata, which Self and ERC-8004 reviewers can fetch to walk the graph. On chain, the registries record the two NFT owners independently.

## Prerequisites

- A wallet you control on Celo Mainnet that you are happy to expose publicly as "verified human via Self". This becomes `humanAddress` and is permanently associated with your passport ZK proof on the Self Agent ID Registry. Any prior Celo wallet you already used with Self (Celo Names, Self Points, etc.) is the right candidate.
- The Self mobile app installed on a phone with NFC, with your passport already verified (`Verified Biometric Passport` status visible in the app).
- An Ed25519 keypair generated locally and stored in `.env`. Use the snippet inside `.env.example` (the inline `node -e ...` one-liner) or any equivalent tool. Save the private key out of band, losing it means losing the Self Agent ID.
- The meRacle repo cloned with `pnpm install` complete and `.env` populated.

## Where it lives

| Field | Value |
|---|---|
| Self Agent ID Registry (Celo Mainnet) | `0xaC3DF9ABf80d0F5c020C06B04Cced27763355944` |
| Self HTTP API base | `https://app.ai.self.xyz/api/agent` |
| Registration mode | `ed25519-linked` |
| Script | `scripts/register-self.ts` |

## What the script does

`scripts/register-self.ts` runs this sequence end to end:

1. Reads `SELF_AGENT_ED25519_PUBLIC`, `SELF_AGENT_ED25519_PRIVATE`, `SELF_HUMAN_ADDRESS` from `.env`.
2. `POST /register/ed25519-challenge` with the Ed25519 pubkey, gets back a 32-byte challenge hash and a nonce.
3. Signs the challenge with the Ed25519 private key (raw 32-byte seed wrapped in a PKCS8 DER envelope, then `node:crypto.sign(null, ...)`).
4. `POST /register` with `{ mode: "ed25519-linked", network: "mainnet", ed25519Pubkey, ed25519Signature, humanAddress, disclosures }`. The disclosures block opts out of every personal field (name, DOB, nationality, gender, issuing state, OFAC) and asks only for the proof-of-human attestation.
5. Prints `scanUrl` and `deepLink` from the response, plus the agent address Self assigned and the time window for the session.
6. Polls `GET /register/status` every 3 seconds with `Authorization: Bearer <sessionToken>` until `stage === "registered"`.
7. Prints the Self Agent ID, the on-chain tx hash, and a Celoscan link.

## Step-by-step run

```bash
pnpm register:self
```

The script blocks on the polling loop, leave it running.

In a separate context:

- **Variant A, desktop QR**: open the `scanUrl` from the script output in a desktop browser. Point the Self mobile app camera at the on-screen QR.
- **Variant B, deep link**: open the `deepLink` from the script output directly on the phone where the Self app is installed. It will hand off straight into the app.

Once Self is loaded, follow the in-app prompts. The app shows the agent address (your `humanAddress`), confirms the disclosure set is minimal, and asks for an NFC tap on your passport to generate the ZK proof. After the tap, the app uploads the proof to Self, Self submits the on-chain transaction, and the polling script picks up `stage === "registered"` within a few seconds.

The script then prints the Self Agent ID and tx hash. Save both to `~/knowledge/meracle/wiki/hot.md` (off repo).

## Verifying the entry on chain

After the script reports success:

```bash
# Read the soulbound NFT owner from the registry
cast call --rpc-url https://forno.celo.org \
  0xaC3DF9ABf80d0F5c020C06B04Cced27763355944 \
  "ownerOf(uint256)(address)" <SELF_AGENT_ID>
```

The returned address must equal `SELF_HUMAN_ADDRESS`. Optionally cross-check the tx on `https://celoscan.io/tx/<txHash>`, the transaction should be a mint from the registry to your `humanAddress`.

## Prize pool checklist after this step

When all three items are present, meRacle qualifies under the AI Agents Prize Pool rules:

- [x] ERC-8004 Identity NFT minted (`pnpm register:identity` prints the agent id)
- [ ] Self Agent ID registered (this guide)
- [x] On-chain transaction history from the agent hot wallet (`submitPrice()` calls to the Mercato PriceOracle, populated by Phase 1 cron)

## If anything is off

The Self API evolves. If the response shape diverges from what `register-self.ts` expects, update the script and this file rather than working around it locally. The doc and the script together are the single source of truth for the registration flow.
