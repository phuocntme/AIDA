# Demo flows — AIDA

## Setup
- Base URL: `http://127.0.0.1:5180`
- Start (from the repo root): `pnpm demo` (Hardhat node + deploy + seed + Trust Oracle + web)
- Reset before a full run: stop `pnpm demo` (Ctrl-C) and start it again (fresh chain, re-seeded)
- Login: none. Use the **"Demo account…"** dropdown (top right). Local Hardhat test keys only.

## Flow 1 — Home: who is trustworthy? (R1, R3, R5)
URL: `/`
1. Headline "On-chain identity for every AI agent." → "every AI agent gets an NFT passport on Avalanche"
2. Trust terrain → "each peak is a registered agent; its height is its on-chain trust score"
3. Stats strip → "4 agents, 6 reviews, read straight from the chain"
4. Scroll to "Agent directory": TranslatorVN 90 Trusted, SpamBot 9000 20 Risky → tab "Risky" filters to SpamBot

## Flow 2 — Register a new agent (R2, R4)
URL: `/#/register`
1. Demo account → "Customer (no agent yet)"
2. Type name, description, endpoint → live passport + ERC-8004 JSON update as you type
3. "Mint passport on-chain" → "Agent #0005 has a passport." + tx hash

## Flow 3 — x402: a low-trust agent is refused (R6)
URL: `/#/agent/1`
1. Demo account → "SpamBot 9000 owner (#2)"
2. Trust Oracle panel → "Buy report on #0001"
3. Terminal: `← 403 Refused: reputation 20 < 60` → "the Oracle checked AIDA before taking any money"

## Flow 4 — x402: a trusted agent pays, gets served, rates the Oracle (R6, R3)
URL: `/#/agent/2`
1. Demo account → "TranslatorVN owner (#1)"
2. "Buy report on #0002" → terminal: `402 Payment Required` → `pay 0.01 AVAX` → `200 report received`
3. Verdict "RISKY"
4. "Rate Oracle: 95" → "Rated the Trust Oracle 95/100 on-chain." → Home: the Trust Oracle peak rises

## Flow 5 — Proof (terminal)
Commands: `pnpm test` then `pnpm e2e`
1. contracts `19 passing`, sdk `pass 13`, agent `pass 8`, mcp `pass 4` → "every revert path and payment check is tested"
2. e2e: `HTTP 403 … reputation 20 < 60`, `402`, `paid tx`, `200`, `Rated Oracle 95/100` → "same flow from a headless agent"

## Flow 6 — Same flows live on Avalanche Fuji
Start: `pnpm demo:fuji` → `http://127.0.0.1:5181` (network label "Avalanche Fuji")
1. Profile #0002 as "TranslatorVN owner (#1)" → "Buy report on #0002" → `402` → `pay 0.001 AVAX · tx …` (Snowtrace link) → `200`
2. Click the tx link → "a real AVAX payment on Fuji, verified by the Oracle on-chain"

## Flow 7 — Real agent economy on Fuji (the submission video)
Start: `pnpm demo:fuji` → `http://127.0.0.1:5181/#/economy`
1. Sellers ledger: AVAX Price Pro ~99 Trusted, FastQuote 45 Risky → "scores came only from real paid jobs"
2. "Run Treasury Bot · 4 rounds" → console: `✗ skip FastQuote: AIDA trust 45 < 60`, `402 → paid 0.0005 AVAX`, `200 · quote vs Chainlink → score`, `rated … on-chain`, Oracle report `402 → 200 · TRUSTED`
3. Click a tx link → the payment on testnet.snowtrace.io
4. `/#/agent/2` → reviews from Treasury Bot + Audit Lab validations vs Chainlink
