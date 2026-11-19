# Pitch outline (slides)

Source of truth for every number: [README](../README.md). Video beats and captions: [DEMO_FLOWS.md](../DEMO_FLOWS.md).

| # | Slide | Content |
|---|---|---|
| 1 | AIDA: check before you pay | One line: an AI agent with a wallet can be tricked into paying anyone. AIDA limits what it can pay and tells it who is worth paying. Self-chosen topic, closest to #12 and #17. Dev toggles in small print: demo agents run locally, FastQuote is wrong on purpose, native test AVAX in an x402-style flow |
| 2 | Problem | Agent reputation today can be written by anyone for free: 59 to 91% of ERC-8004 reviewers on Ethereum, BSC and Base show Sybil behaviour (Xiong et al., 2026). Spending limits live in a platform or in the bot's own code |
| 3 | What AIDA adds | (1) AgentPolicy: daily cap, per-payment cap, whitelist, kill switch, on-chain. (2) PaidReviews: one payment allows one review; for a quote the contract computes the score from Chainlink. (3) Identity and a copy of every review in the canonical ERC-8004 registries |
| 4 | Demo: a paid job | Screenshot `docs/img/economy-run.png`: skip, pay, quote vs Chainlink, score |
| 5 | Demo: the attack and the kill switch | Screenshots `docs/img/attack.png`, `docs/img/kill-switch.png`: `RecipientNotAllowed`, `OverPerPaymentCap`, `AgentPaused` |
| 6 | Where Avalanche is used | Canonical ERC-8004 registries on Fuji (agents 308 to 312), Chainlink AVAX/USD read in the review transaction, Avalanche Data API for the policy ledger, three verified contracts. Measured: in a block about 1 s after sending, 95,625 gas per payment |
| 7 | The three answers | Why on-chain, why Avalanche, where the money comes from: copy the three rows of the README table. Add the honest cost line: at mainnet prices the design fits payments of a few cents and up; sub-cent needs an L1 (designed, not deployed) |
| 8 | Who else does this | Kite Passport, Coinbase Agentic Wallets, x402 facilitators, 0xGasless and evalanche SDKs, with the one-line difference each (README table) |
| 9 | Proof | 131 tests incl. fuzz and a Fuji fork test; contract addresses; `cast` commands anyone can run |
| 10 | Law and limits | Vietnamese law row (testnet, no user funds, VND billing for a local product). Limits: self-dealing between own wallets, localhost agents, no USDC facilitator yet |
| 11 | Team and links | phuocntme · https://github.com/phuocntme/AIDA · video |
