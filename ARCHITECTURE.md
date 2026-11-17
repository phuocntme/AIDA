# Architecture — AIDA (Agent IDentity on Avalanche)

Author: phuocntme

## Scope & Design Decisions
- **Built:** IdentityRegistry + ReputationRegistry contracts (ERC-8004-shaped), TS SDK, web app (register / directory / profile / paid-agent panel), "Trust Oracle" paid agent speaking an x402-style 402 → pay → retry protocol gated by AIDA reputation, seed + deploy scripts (local Hardhat node and Fuji).
- **Simplified:** x402 payment = a native AVAX transfer verified on-chain by the agent server (no facilitator, no EIP-3009 USDC). Same HTTP shape (`402` + `accepts` requirements, retry with `X-PAYMENT`), so it can later be swapped for the official facilitator. Feedback has no signed auth, only "owner can't rate own agent".
- **Left out:** Validation Registry, indexer, mainnet (see REQUIREMENTS.md).
- **Stack & design:** Hardhat 3 + viem for npm-native contract workflows; Vite + React for the web client; deterministic Trust Oracle & autonomous agent network over x402.

## Components
```
packages/
  contracts/   Solidity 0.8.28, Hardhat 3, OpenZeppelin 5
               IdentityRegistry.sol   ERC-721, register(uri) -> agentId, setAgentURI
               ReputationRegistry.sol giveFeedback(agentId, score 0-100, tag, uri), getSummary, getFeedback
               scripts/deploy.ts      deploy + write deployments/<chainId>.json
               scripts/seed.ts        3 demo agents + feedback (one trusted, one low-rep, the Oracle)
  sdk/         TypeScript, viem. ABIs, AgentCard schema + validateCard(), AidaClient
               (register, resolve, list, giveFeedback, summary), x402 helpers
               (buildRequirements, verifyPayment, payAndRetry)
  agent/       Node HTTP server "Trust Oracle" (GET /report/:agentId) + CLI client demo
  web/         Vite + React + viem. Pages: Directory, Register, Agent profile (+ paid agent panel)
```

## How a request moves: register → reputation → paid call → feedback
1. Owner fills the Register form → web builds an AgentCard JSON, `validateCard()` → stored as a `data:application/json;base64` URI (static/IPFS later) → `IdentityRegistry.register(uri)` → `Registered(agentId, owner, uri)` event.
2. Directory reads `Registered` events + `tokenURI`, decodes card, joins `ReputationRegistry.getSummary(agentId)`.
3. Caller agent X requests `GET /report/:target` with header `X-Agent-Id: X`.
   - Oracle resolves X: must exist, and `summary(X).count ≥ 1 && avg ≥ 60` (MIN_SCORE env). Else **403** with reason ("reputation 20 < 60").
   - No payment → **402** `{x402Version:1, accepts:[{scheme:"exact", network, chainId, payTo, maxAmountRequired, asset:"native", resource, nonce}]}`.
   - Client sends AVAX tx to `payTo`, retries with `X-PAYMENT: base64({txHash, nonce})`.
   - Oracle verifies receipt: success, `to == payTo`, `value ≥ price`, `from == ownerOf(X)`, txHash not used before → **200** report `{target, card, summary, feedback[], verdict}` + `X-PAYMENT-RESPONSE`.
4. Caller rates the Oracle: `giveFeedback(oracleId, score, "trust-report", "")` → Oracle's summary changes on the profile page.

## Data model
- `IdentityRegistry`: ERC-721 `AIDA`; `agentId` starts at 1; `tokenURI(agentId)` = card URI; events `Registered`, `URIUpdated`.
- AgentCard (ERC-8004 registration-file shape, subset): `{type:"https://eips.ethereum.org/EIPS/eip-8004#registration-v1", name, description, image?, endpoints:[{name, endpoint}], wallet}`; name 1–64 chars, description ≤ 500, endpoint must be http(s), wallet 0x-address.
- `ReputationRegistry`: `Feedback{client, score uint8, tag bytes32, uri string, timestamp}`; per-agent array + `count`, `totalScore`; `getSummary -> (count, average)`; reverts: `AgentNotFound`, `SelfFeedback`, `ScoreOutOfRange`.

## Reliability
- Every external input validated: card JSON (schema), headers (`X-Agent-Id` integer, `X-PAYMENT` base64 JSON), payment receipt (all fields checked), replay-protected (used txHash set). Failures return explicit JSON errors with a reason — never a silent pass.
- Contracts: custom errors, events for every state change, tests for each revert path.

## Trade-offs and what's next
- Native AVAX instead of USDC/EIP-3009: zero-dependency demo on local node and Fuji; next: official x402 facilitator on `avalanche-fuji`.
- Average score is Sybil-able: next: weight feedback by the client's own reputation, signed feedback auth (ERC-8004 `feedbackAuth`), Validation Registry, deploy on a dedicated Avalanche L1 for agent traffic.
