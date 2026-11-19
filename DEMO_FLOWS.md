# Demo flows

Used for the 2:00 to 3:00 screen recording. Every beat is at most two clicks. Captions are the on-screen line for that beat (8 words or fewer).

## Setup (Fuji, the recording)
- Start: `AIDA_DEMO_SIGNER=1 pnpm demo:fuji` → http://127.0.0.1:5181 (agents on :8790 to :8794)
- Before recording: `pnpm guardian status`. One *Run* spends 0.0025 AVAX. If the balance is below 0.005 or the day's cap is nearly used: `pnpm recycle`, then `pnpm guardian deposit 0.01` (and `pnpm guardian limits 0.05 0.002` to raise the daily cap). The cap resets at 07:00 Vietnam time.
- Kill switch without a wallet extension: wallet menu (top right) → "Kill-switch operator (demo signer)". With Core or MetaMask: import the guardian key and use *Connect wallet*.
- Record at 1920×1080, browser zoom 100%. On the Economy page scroll until the *Treasury Bot* panel fills the right half.
- Reset: nothing to reset. Each run adds real payments and reviews.

## Flow 1: What it is (0:00 to 0:20)
URL: `/`
1. Headline "Check before you pay" → caption: **AI agents pay each other. Which to trust?**
2. Terrain: Price Pro's peak next to FastQuote's dip → caption: **Demo agents run locally. FastQuote errs on purpose.**
3. Scroll to "Agents" table: Price Pro Trusted, FastQuote Risky → caption: **Scores come only from paid, checked jobs**

## Flow 2: The policy (0:20 to 0:35)
URL: `/#/economy`
1. "AgentPolicy" card: daily cap bar, per payment ≤ 0.002, whitelist chips → caption: **The bot spends only through this contract**

## Flow 3: A paid job (0:35 to 1:15)
URL: `/#/economy`
1. Click **Run** → row "Skipped FastQuote" → caption: **It skips the seller with a bad score**
2. Row "Paid 0.0005 AVAX · confirmed in 3 s" → caption: **Pays through the policy, confirmed in seconds**
3. Rows "Quote 6.95 USD" and "Score 97" → caption: **The contract scores the quote against Chainlink**
4. Click **tx ↗** on the Score row → Snowtrace opens the review transaction → caption: **Every step is a Fuji transaction**
5. Back on the page: tiles "Confirmed in" and "Network fee per payment" → caption: **Seconds to confirm, a fraction of a cent**

## Flow 4: The attack (1:15 to 1:50)
URL: `/#/economy`
1. Click **Attack** → rows "Injected" → caption: **Attack: pay a stranger, pay 25× the cap**
2. Rows "Rule engine refused" → caption: **The bot's own rules say no**
3. Rows "AgentPolicy reverted: RecipientNotAllowed" and "…OverPerPaymentCap" → caption: **Sent anyway, the contract reverts both**
4. Row "0 AVAX left the policy", then "Policy transactions" list with two red "Payment reverted" → caption: **Reverted payments, listed by Avalanche Data API**

## Flow 5: The kill switch (1:50 to 2:15)
URL: `/#/economy`
1. Wallet menu → "Kill-switch operator (demo signer)" → click **Kill switch** → card turns red, "PAUSED" → caption: **A human presses the kill switch**
2. Click **Run** → row "AgentPolicy reverted: AgentPaused" → caption: **The contract refuses the next run**
3. Click **Resume agent** → "ACTIVE"

## Flow 6: The record (2:15 to 2:40)
URL: `/#/agent/309` (Agents → AVAX Price Pro)
1. Score, trust chart, "Reviews" rows with "quote … · Chainlink …" → caption: **Each review shows the quote and Chainlink**
2. Panel "On-chain record": ERC-8004 identity #309, copy in ERC-8004 Reputation → caption: **Same reviews, readable in the ERC-8004 registry**

## Flow 7: Closing frame (2:40 to 2:50)
URL: the README on GitHub, section "Live on Fuji"
1. Contract table with Snowtrace links → caption: **Live on Fuji. 131 tests. MIT.**

## Local flow (no keys, for anyone who clones the repo)
- Start: `pnpm demo` → http://127.0.0.1:5180. Second terminal: `pnpm e2e`.
- Same Flows 2 to 5. The kill switch uses wallet menu → "Guardian (human)", a Hardhat test key.
- Differences: the identity registry, the reputation registry and the price feed are local stand-ins; there are no explorer links and no "Policy transactions" list.

## Terminal proof
- `pnpm test` → Foundry `35 tests passed`, Hardhat `10 passing`, sdk `pass 30`, agent `pass 45`, mcp `pass 4`, web `pass 6`
- `pnpm -F @aida/contracts test:fork` → writes a review into the canonical ERC-8004 registries on a Fuji fork
- `pnpm hire --attack` → the two reverts with Snowtrace links
