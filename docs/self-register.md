# Registering meRacle on the Self Agent ID Registry

The Self Agent ID is the second leg of the AI Agents Prize Pool requirement (alongside ERC-8004 Identity). Unlike the 8004 register, the Self flow does not have a scriptable on-chain entry point for end users; it runs through the official portal, which combines a passport-based human attestation with a wallet-bound agent record.

This guide documents the manual steps once and links the resulting record back to this repo.

## Prerequisites

- A wallet that has passed Self passport verification (the operator's main wallet; this is **not** the agent's hot wallet).
- The agent hot wallet generated for meRacle (the same address used as `AGENT_PRIVATE_KEY` and printed by `pnpm register:identity`). Have the address ready, **do not share the private key with any web app**.
- A reachable URL for the agent metadata. The default is `https://raw.githubusercontent.com/BRN-SLP/meracle/main/agent.json`.

## Where it lives

| Field | Value |
|---|---|
| Portal | https://app.ai.self.xyz |
| Self Agent ID Registry (Celo Mainnet) | `0xaC3DF9ABf80d0F5c020C06B04Cced27763355944` |

## Step-by-step

1. **Open the portal.** Go to https://app.ai.self.xyz in a desktop browser. Mobile works for some flows but desktop is the supported path for agent registration.
2. **Connect the operator wallet.** Use the passport-verified wallet (not the agent hot wallet). The portal will detect the existing human attestation.
3. **Create an agent record.** Navigate to the agent management section (labels vary across portal releases; look for "Agents", "My Agents", or "Register Agent").
4. **Fill the agent metadata.** Mirror the on-chain `agent.json` so the two registries stay consistent:
   - **Name**: meRacle
   - **Description**: Reference Price Oracle for Mercato
   - **Wallet address**: paste the agent hot wallet address (the operator wallet attests, the hot wallet operates)
   - **Metadata URI** (if asked): `https://raw.githubusercontent.com/BRN-SLP/meracle/main/agent.json`
   - **Network**: Celo Mainnet (chain id 42220)
5. **Sign the attestation.** The portal will trigger a wallet signature from the operator wallet. This is the human-to-agent binding; gas, if any, is paid by the operator wallet.
6. **Record the resulting Self Agent ID.** The portal returns an `agent_id` (numeric or hash) and a Celoscan link to the on-chain entry. Save both into the wiki notes (`~/knowledge/meracle/wiki/hot.md`), they are not committed to the repo.

## Verifying the entry on-chain

After the portal flow, the registry should hold a record bound to the agent hot wallet. Verify with a quick read from this repo:

```bash
# adhoc, scriptable later under scripts/verify-self.ts
cast call --rpc-url https://forno.celo.org \
  0xaC3DF9ABf80d0F5c020C06B04Cced27763355944 \
  "ownerOf(uint256)(address)" <SELF_AGENT_ID>
```

The returned address should match the operator wallet that signed in the portal. The agent hot wallet itself is referenced as the "wallet" entry inside the on-chain agent metadata, distinct from the NFT owner.

## Prize-pool checklist after this step

When all three items are present, the meRacle entry qualifies under the AI Agents Prize Pool rules:

- [ ] ERC-8004 Identity NFT minted (`pnpm register:identity` → prints agentId)
- [ ] Self Agent ID registered through the portal (this doc)
- [ ] Onchain transaction history from the agent wallet (any `submitPrice()` call to Mercato counts; arrives in Phase 1)

## If anything is off

The portal UI evolves. If a label here is stale or a field is missing, update this file rather than working around it; the doc is the single source of truth for the manual flow.
