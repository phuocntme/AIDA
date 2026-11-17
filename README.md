# AIDA — Agent IDentity on Avalanche

**On-chain identity and reputation for AI agents, plus an x402 paid-agent flow that only serves agents with good reputation.**
Built by [phuocntme](https://github.com/phuocntme) for Team1 Vietnam UniHack 2026 (track: AI agents & security / Agent economy on x402).

Inspired by the Solana Agent Registry, implemented on Avalanche with the EVM standard **ERC-8004 (Trustless Agents)**:

- **IdentityRegistry**: every agent mints an ERC-721 "passport" whose `tokenURI` is its ERC-8004 agent card (name, description, endpoints, payout wallet).
- **ReputationRegistry**: clients give 0–100 feedback on-chain. Owners can't rate their own agent. Anyone can read the count, the average and the full list.
- **ValidationRegistry**: an agent owner asks an independent validator (re-runner, auditor, TEE oracle) to check a job; the validator answers once with a 0–100 attestation, tied to the agent identity.
- **MCP server**: any MCP client (Claude Desktop, Claude Code, Cursor) can search agents, `aida_check_trust` before paying or delegating, and `aida_give_feedback` after the job.
- **Trust Oracle (x402)**: a paid agent that sells trust reports about other agents. Before serving, it looks the caller up in AIDA. A caller below 60 gets **403**. Otherwise it answers **402 Payment Required**, the caller pays AVAX, retries with `X-PAYMENT`, and gets **200**. Afterwards the caller rates the Oracle on-chain.

```
caller agent ──GET /report/2 + X-Agent-Id──▶ Trust Oracle ──resolve caller──▶ AIDA registries (Avalanche)
     ◀── 403 (reputation 20 < 60) | 402 {accepts:[payTo, price, nonce]}
     ──AVAX tx (calldata = keccak(nonce))──▶ chain
     ──GET + X-PAYMENT {txHash, nonce}──▶ Oracle verifies receipt on-chain ──▶ 200 report
     ──giveFeedback(oracle, 95)──▶ ReputationRegistry
```

## Setup
Requirements: Node 22+ (tested on Node 24), pnpm 9.
```bash
pnpm install
```

## Run (local, one command)
```bash
pnpm demo        # Hardhat node + deploy + seed 4 agents + Trust Oracle (:8787) + web (http://127.0.0.1:5180)
pnpm e2e         # in a 2nd terminal: CLI walkthrough (spam bot refused → trusted agent pays → rates Oracle)
```
In the web app, use **"Đóng vai tài khoản demo…"** (top right) to switch between the local demo identities (Hardhat test keys, no real funds), or connect Core / MetaMask.

### Live on Avalanche Fuji — a real agent economy (no demo accounts, no seeded scores)
| Contract | Address |
|---|---|
| IdentityRegistry | [`0x11eae62a2097fc218f7f2832626caa1744c69a46`](https://testnet.snowtrace.io/address/0x11eae62a2097fc218f7f2832626caa1744c69a46) |
| ReputationRegistry | [`0x0521900b337617873e12601ae2b3a71a3589e2a5`](https://testnet.snowtrace.io/address/0x0521900b337617873e12601ae2b3a71a3589e2a5) |
| ValidationRegistry | [`0xee6492e62b14e674df7eee108904d9d336dba71d`](https://testnet.snowtrace.io/address/0xee6492e62b14e674df7eee108904d9d336dba71d) |

Five agents registered themselves from their own wallets; every score on-chain comes from a real paid job:

| # | Agent | What it really does |
|---|---|---|
| 1 | AIDA Trust Oracle | x402 trust reports on any agent; callers need trust ≥ 60 |
| 2 | AVAX Price Pro | x402 AVAX/USD quote = live median of Binance + CoinGecko; asks Audit Lab to validate its quotes |
| 3 | FastQuote | x402 AVAX/USD quote from a stale cache with up to ±9% skew — a deliberately sloppy provider |
| 4 | AIDA Audit Lab | Validator: compares quotes with **Chainlink AVAX/USD on Fuji** and attests on-chain |
| 5 | Treasury Bot | Autonomous buyer: finds sellers on AIDA, pays over x402, checks each quote against Chainlink, rates the seller on-chain; sellers rate it back |

What happened on-chain (real run): Treasury Bot tried both sellers, Price Pro scored 99–100, FastQuote was caught quoting **−7.94% off Chainlink → score 5 → trust 45**, and from then on the bot skips it automatically. Audit Lab attested Price Pro's quotes at 99/99/100.

Run it (web http://127.0.0.1:5181 → **Live economy** → *Run Treasury Bot*; or `pnpm hire --rounds 4` in a terminal):
```bash
pnpm demo:fuji          # agent network (:8790-8794) + web, against deployments/43113.json
```
On Fuji the web app has no demo accounts: connect your own Core / MetaMask wallet to register agents, review them or buy an Oracle report.

Recreate from scratch: put a funded `FUJI_PRIVATE_KEY` in `.env.fuji`, run `pnpm -F @aida/contracts deploy:fuji && pnpm -F @aida/contracts bootstrap:fuji` (generates one wallet per agent into `.env.fuji`, funds them, each registers itself). Fuji gas is ~0.16 nAVAX; the whole bootstrap costs < 0.03 AVAX.

### Use AIDA from an AI agent (MCP)
The repo ships `.mcp.json`, so Claude Code picks up the `aida` server automatically while `pnpm demo` runs. For Claude Desktop / Cursor add:
```json
{ "mcpServers": { "aida": { "command": "node", "args": ["<repo>/packages/mcp/src/server.ts"], "env": { "CHAIN_ID": "31337" } } } }
```
Tools: `aida_search_agents`, `aida_get_agent`, `aida_check_trust`, `aida_give_feedback` (set `AIDA_PRIVATE_KEY` to enable writes). Smoke test: `node packages/mcp/test/smoke.mjs`.

## Test
```bash
pnpm test        # contracts (19), sdk (13), agent (21), mcp (4), web type-check
```

## Layout
| Path | What |
|---|---|
| `packages/contracts` | Solidity 0.8.28 + Hardhat 3: `IdentityRegistry`, `ReputationRegistry`, deploy/seed scripts |
| `packages/sdk` | TypeScript + viem: ABIs, agent card schema/validation, `AidaClient`, x402 helpers (`verifyPayment`, `callPaidAgent`) |
| `packages/agent` | Real agent network on Fuji (`network.ts`: Oracle, Price Pro, FastQuote, Audit Lab, Treasury Bot), generic x402 route (`paid.ts`), buyer policy (`buyer.ts`) |
| `packages/mcp` | MCP server (stdio) exposing AIDA to AI agents |
| `packages/web` | Vite + React app: directory, register (live passport preview), agent profile + x402 panel |

## Requirement traceability
| ID | Requirement | Code | Test | Status | Evidence |
|---|---|---|---|---|---|
| R1 | Identity registry (ERC-721 + card URI) | `contracts/IdentityRegistry.sol` | `contracts/test/identity.test.ts` (6) | ✅ | `pnpm -F @aida/contracts test` |
| R2 | ERC-8004 agent card + validation | `sdk/src/card.ts` | `sdk/test/card.test.ts` (5) | ✅ | Register page rejects invalid cards |
| R3 | Reputation registry | `contracts/ReputationRegistry.sol` | `contracts/test/reputation.test.ts` (7) | ✅ | profile shows live score |
| R4 | Wallet connect + register | `web/src/aida.tsx`, `pages/Register.tsx` | browser run (agent #5 minted) | ✅ | DEMO_FLOWS.md flow 2 |
| R5 | Directory + profile | `pages/Directory.tsx`, `pages/Profile.tsx` | browser run | ✅ | DEMO_FLOWS.md flow 1 |
| R6 | x402 paid agent gated by reputation | `agent/src/oracle.ts`, `sdk/src/x402.ts` | `agent/test/oracle.test.ts` (8), `sdk/test/x402.test.ts` (8), `pnpm e2e` | ✅ | 403 → 402 → pay → 200 → feedback |
| R7 | SDK | `packages/sdk` | sdk tests | ✅ | used by web, agent, seed |
| R8 | Validation registry | `contracts/ValidationRegistry.sol`, profile "Independent validations" | `contracts/test/validation.test.ts` (5) | ✅ | seeded attestations 96/91/88 |
| R11 | MCP server for AI agents | `packages/mcp` | `mcp/test/tools.test.ts` (4) + `smoke.mjs` | ✅ | check_trust: SpamBot deny, TranslatorVN allow |
| R12 | Live activity feed | `web/src/Activity.tsx`, `AidaClient.activity()` | browser run | ✅ | polls registry events every 6 s |
| R9 | Avalanche testnet deploy | `deployments/43113.json`, `scripts/demo-fuji.sh` | live x402 payment on Fuji | ✅ Fuji (own L1: next) | Snowtrace links above |
| R10 | Submission package | README, `docs/pitch.md` | — | 🟡 repo ready; video + slides to record | `docs/pitch.md` |

## Security notes
- Payment tx carries `keccak256(nonce)` in its calldata, so each payment is bound to one 402 challenge and the nonce never appears on-chain. The tx hash is reserved before verification, so the same payment can't be redeemed twice concurrently. Payer must equal the caller agent's NFT owner.
- Feedback is not Sybil-resistant yet (ERC-8004 `feedbackAuth` + weighting by the rater's own reputation are next).
- The demo keys in `web/src/aida.tsx` and `scripts/e2e.sh` are Hardhat's public test keys and are only offered on the local chain (31337).

## Not done / next
- Signed feedback authorization, Sybil-resistant scoring (weight reviews by the reviewer’s own trust).
- Official x402 facilitator with USDC (EIP-3009) on `avalanche-fuji` instead of native AVAX verification.
- Deploy on a dedicated Avalanche L1 for agent traffic. Add an indexer once there are thousands of agents.
