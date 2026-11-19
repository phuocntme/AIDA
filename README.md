# AIDA: check before you pay

**Slides:** _link will be added here on 20 Nov 2026_ · **Video (2 to 3 min):** _link will be added here on 20 Nov 2026_

AIDA lets one AI agent decide whether to pay another, and stops it from paying the wrong one. Agents are identities in the ERC-8004 registry on Avalanche. A paying agent spends through an `AgentPolicy` contract with a daily cap, a per-payment cap, a recipient whitelist and a kill switch held by a human. A review can only be written after a payment, and for a price quote the reviewer does not pick the score: the contract reads Chainlink and computes it.

Team1 Vietnam UniHack 2026 · live on Avalanche Fuji · self-chosen topic. The closest listed topics are #12 (agent treasury with guardrails) and #17 (x402 payment rails). AIDA has the policy contract, the rule-based agent and the attack demo of #12 but no DEX rebalancing, and the 402 → pay → retry flow of #17 but no facilitator.

Dev toggles, stated up front: the five demo agents run on the builder's machine (their on-chain cards say `http://127.0.0.1:879x`), FastQuote is wrong on purpose, payments are native test AVAX in an x402-style flow (not the x402 `exact` scheme with USDC), and for recording the dev server can press the kill switch with a pause-only operator key (off unless `AIDA_DEMO_SIGNER=1`). Details in [Rules compliance](#rules-compliance).

![Treasury Bot pays through AgentPolicy, the contract scores each quote against Chainlink](docs/img/economy-run.png)

## Live on Fuji

AIDA's three contracts are verified on Routescan (the explorer behind Snowtrace). Identity and the public copy of every review live in the canonical ERC-8004 registries, which AIDA did not deploy.

| Contract | Address | Role |
|---|---|---|
| AgentPolicy | [`0x14ed319980c2af6840ab4969249147a6dd677a86`](https://testnet.snowtrace.io/address/0x14ed319980c2af6840ab4969249147a6dd677a86) | spending policy: caps, whitelist, kill switch; records every payment |
| PaidReviews | [`0x39e53fc226d97b28fdc826bb413169abbb80f548`](https://testnet.snowtrace.io/address/0x39e53fc226d97b28fdc826bb413169abbb80f548) | one payment allows one review; scores a signed quote against Chainlink |
| ValidationRegistry | [`0x01f397aedc0b80fd40434f4413ee43e51b633b7d`](https://testnet.snowtrace.io/address/0x01f397aedc0b80fd40434f4413ee43e51b633b7d) | a named validator answers once per request (ERC-8004-style, simplified) |
| ERC-8004 Identity Registry (canonical, v2.0.0) | [`0x8004A818BFB912233c491871b3d84c89A494BD9e`](https://testnet.snowtrace.io/address/0x8004A818BFB912233c491871b3d84c89A494BD9e) | the agents' identities; AIDA reads `ownerOf` and `tokenURI` |
| ERC-8004 Reputation Registry (canonical) | [`0x8004B663056A597Dffe9eCcC1965A193B7388713`](https://testnet.snowtrace.io/address/0x8004B663056A597Dffe9eCcC1965A193B7388713) | receives a copy of every AIDA review, with PaidReviews as the client |
| Chainlink AVAX/USD | [`0x5498BB86BC934c8D34FDA08E81D444153d0D06aD`](https://testnet.snowtrace.io/address/0x5498BB86BC934c8D34FDA08E81D444153d0D06aD) | read by PaidReviews inside the review transaction |

Five agents registered themselves in the canonical registry from their own wallets, then listed themselves in AIDA. No score was seeded.

| ERC-8004 id | Agent | What it does |
|---|---|---|
| [308](https://testnet.snowtrace.io/tx/0x9f16b1a3a9a62131dc1061af4b90cfb966284f8897b1f3c89d0a1b335065cf39) | AIDA Trust Oracle | sells trust reports (0.001 AVAX); serves callers with trust ≥ 60, or a newcomer whose funded policy has a guardian the oracle knows (a self-guarded policy does not count) |
| [309](https://testnet.snowtrace.io/tx/0x9c8fd2b97a403be2718e3d763978a324e50e788ee61e3c89c0fc21bb35f9cb1c) | AVAX Price Pro | sells a signed AVAX/USD quote (0.0005 AVAX): median of Binance and CoinGecko at request time |
| [310](https://testnet.snowtrace.io/tx/0xf08903fd867d5e0983b95170f0ca8ebcaa9e8b4b725d63f2b9fc16929660c6ab) | FastQuote | sells a signed quote from a stale cache that is 4 to 9% off. Wrong on purpose |
| [311](https://testnet.snowtrace.io/tx/0x086459a096536915c17f2838e610413b1a72c917667c49966f23d56163f66770) | AIDA Audit Lab | validator: re-checks Price Pro's quotes against Chainlink and answers in the ValidationRegistry |
| [312](https://testnet.snowtrace.io/tx/0xf5a5006f4a717a0334d1dc3b1bc45dabd0874c98d05c9f8961020486f177667a) | Treasury Bot | buyer: pays through AgentPolicy and hands each signed quote to PaidReviews |

Transactions you can open (19 Nov 2026):

| Step | Tx |
|---|---|
| Treasury Bot puts itself under the policy; the guardian is a separate human key | [`0x6d454d6d…`](https://testnet.snowtrace.io/tx/0x6d454d6d418033cb57b166c1aa61abd20093607bcaed54b4db78e6180258a1ab) |
| Guardian whitelists Price Pro | [`0xe8838583…`](https://testnet.snowtrace.io/tx/0xe8838583dec6afa5862d78ed309a54d4936b5952c96b94a666084fb6c6124f56) |
| Guardian funds the policy with 0.02 AVAX | [`0xd205bf11…`](https://testnet.snowtrace.io/tx/0xd205bf11850bf21aa58742d929db4fabb69a1702433aa2c0a078106e53b0bd13) |
| Guardian names a pause-only operator | [`0x8ee48090…`](https://testnet.snowtrace.io/tx/0x8ee48090f4915febb2d2ddbe0d4e42abd3fe53f6a4588d7380f18f7d3a86315c) |
| Payment to Price Pro through `AgentPolicy.pay` (0.0005 AVAX, 96,114 gas) | [`0x71522637…`](https://testnet.snowtrace.io/tx/0x7152263758e8da197a0789a8fc7b686616345587dd475227d233646b0f446e25) |
| `reviewQuote`: the contract reads Chainlink and writes score 97, with a copy to ERC-8004 | [`0x48e5fb44…`](https://testnet.snowtrace.io/tx/0x48e5fb449e7ff3ceb0eb64653a80bee68cf557ed96fa4b1b30c74e8c1f23c3b2) |
| Payment to FastQuote, then the contract scores its quote 9 (7.62% off) | [`0x7f8db391…`](https://testnet.snowtrace.io/tx/0x7f8db39146ab8181da63386c50602274a2d69feed8a6469f2c451c310a52c39d) · [`0x107dc39d…`](https://testnet.snowtrace.io/tx/0x107dc39dcacd5e4cfc21e94065db9a4267b0b65a021abe8a61420f9c9f7fbda0) |
| Guardian takes FastQuote off the whitelist after two bad scores | [`0x96708f51…`](https://testnet.snowtrace.io/tx/0x96708f51160b3845d77e6f584dc7b93e66d441cb2bc600e06b56795d3c1b814f) |
| Attack: the bot's key sends a payment to a stranger. Reverted, `RecipientNotAllowed` | [`0x87487b37…`](https://testnet.snowtrace.io/tx/0x87487b37c44e5d1f4b807bf7b4cb543d03fe32b7f0d54dd138869b551379619c) |
| Attack: 0.05 AVAX to a whitelisted seller. Reverted, `OverPerPaymentCap` | [`0xe3c6a7f3…`](https://testnet.snowtrace.io/tx/0xe3c6a7f30a320cf223bd54d241b16886c28847f50de24a228b691ec549971da3) |
| Kill switch: the operator pauses Treasury Bot, then resumes it | [`0xdf97febd…`](https://testnet.snowtrace.io/tx/0xdf97febd53da06fac5a870b06cbd9b055075377767315b16078df747101d3c78) · [`0xc32d1f4a…`](https://testnet.snowtrace.io/tx/0xc32d1f4a23c70868cdef968d967b89a698fc5ed6de71260e563e14845657be58) |

Check it yourself with [Foundry](https://getfoundry.sh)'s `cast`:

```bash
RPC=https://api.avax-test.network/ext/bc/C/rpc
# agent 309 lives in the canonical ERC-8004 registry
cast call 0x8004A818BFB912233c491871b3d84c89A494BD9e "ownerOf(uint256)(address)" 309 --rpc-url $RPC
# its AIDA reviews, read from the canonical ERC-8004 Reputation Registry (count, average, decimals)
cast call 0x8004B663056A597Dffe9eCcC1965A193B7388713 "getSummary(uint256,address[],string,string)(uint64,int128,uint8)" \
  309 "[0x39e53fc226d97b28fdc826bb413169abbb80f548]" "" "" --rpc-url $RPC
# ask the policy, as the bot, to pay 0.05 AVAX: reverts with OverPerPaymentCap(5e16, 2e15)
cast call 0x14ed319980c2af6840ab4969249147a6dd677a86 "pay(uint256,address,uint128,bytes32)" 312 \
  0xcDA93bcE750509aA67aEdBb6C55F94ff65D4BA85 50000000000000000 0x$(printf '%064d' 1) \
  --from 0x981d5415D80f0fc7161B015A825455c2C751AFd2 --rpc-url $RPC
```

## How it works

1. An agent registers in the ERC-8004 Identity Registry. Its `tokenURI` is a registration file: name, description, services, payout wallet. It then calls `PaidReviews.enroll` to appear in AIDA's directory.
2. Treasury Bot lists the AVAX/USD sellers. It skips any seller with two or more reviews and an average below 60. It hires only sellers on its policy's whitelist.
3. The bot signs each request with its agent wallet (`X-Agent-Auth`). The seller checks the signature against the identity's owner in the ERC-8004 registry and only then answers `402 Payment Required` with a price, its wallet and a nonce. The bot calls `AgentPolicy.pay(agentId, to, amount, keccak256(nonce))`. The contract checks the kill switch, the whitelist, the per-payment cap and the daily cap, records the payment under that reference, forwards the AVAX and emits `Paid`.
4. The seller checks the `Paid` event (agent, recipient, amount, reference) and returns the quote with its signature over the price, the time and the payment reference. A caller that has a policy but pays directly is refused.
5. The bot calls `PaidReviews.reviewQuote` with the signed quote. The contract marks the payment as reviewed, checks the seller's signature, reads Chainlink AVAX/USD, computes the score (100 minus 12 points per 1% deviation) and writes it. It also copies the review into the ERC-8004 Reputation Registry.
6. The guardian, or a pause-only operator the guardian named, presses *Kill switch*. The next run asks the contract by `eth_call`, gets `AgentPaused` and stops before any payment.

No LLM decides anything about money. Treasury Bot is a rule engine: `chooseSeller`, `checkPayment` and `parseSignedQuote` are plain functions with unit tests in `packages/agent/test`. The MCP server is read-only: an LLM connected to it can ask whether a payment would be allowed (`aida_check_payment`), and has no key to make one.

Diagrams, contract interfaces and the threat model are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

### Why pay for a price that Chainlink gives for free?

Because the on-chain feed is not fresh. Chainlink AVAX/USD on Fuji updates every 600 seconds or on a 1% move ([reference data directory](https://reference-data-directory.vercel.app/feeds-avalanche-fuji-testnet.json)). In eight consecutive rounds we read, the price moved by up to 0.9% from one round to the next. A bot that is about to trade wants the price now, so it buys a quote taken at request time. Chainlink is used afterwards as a wide sanity band: a seller within 1% of it scores 88 or more, and a seller 5% off scores 40. The Economy page shows both numbers and how old the Chainlink answer was when the quote arrived.

### Attack demo

![Attack: the rule engine refuses, then AgentPolicy reverts the transaction](docs/img/attack.png)

The *Attack* button (or `pnpm hire --attack`) feeds the bot two hostile payment requests of the kind a prompt injection would produce: pay a wallet that is not the seller, and pay 25 times the cap. Each is checked twice. The rule engine refuses it. Then the demo assumes the bot's code is compromised and skips its rules: the bot's own key sends the transaction, and `AgentPolicy` reverts it on-chain.

```
injected: pay 0.0005 AVAX to 0x9510…9A78, a wallet that is not the seller
  rule engine refused: payTo is not the seller's registered wallet
  bot sent it anyway → AgentPolicy reverted: RecipientNotAllowed
injected: pay 0.05 AVAX to AVAX Price Pro (25× the per-payment cap)
  rule engine refused: price 0.05 AVAX above the per-call cap 0.002
  bot sent it anyway → AgentPolicy reverted: OverPerPaymentCap
0 AVAX left the policy · balance 0.0125 AVAX, unchanged
```

![Kill switch: the policy is paused and the contract refuses the run](docs/img/kill-switch.png)

## Rules compliance

| Question | Answer |
|---|---|
| Why on-chain? | The spending limits must hold even if the bot's code or prompt is compromised, so they live in a contract the bot cannot change. A review must be tied to a real payment and scored by something neither party controls, so the payment record, the signature check and the Chainlink read happen in one transaction. Identity is shared: any ERC-8004 reader sees the same agents and the same reviews. |
| Why Avalanche? | The pieces AIDA builds on are deployed here: the canonical ERC-8004 registries on Fuji and C-Chain, Chainlink AVAX/USD, and the [Avalanche Data API](https://developers.avacloud.io/data-api/overview), which the app uses to list every transaction sent to the policy, including reverted ones that emit no events. Measured on Fuji on 19 Nov 2026: a payment is in a block about 1.0 s after it is sent (block millisecond timestamp minus send time) and the bot holds a confirmed receipt after 2.3 to 3.7 s over a public RPC. Fuji produced a block every 1.24 s (blocks 61292694 to 61292894). |
| What does it cost? | `pay` uses 95,625 gas and `reviewQuote` about 344,000 to 443,000 gas, most of it the copy into the ERC-8004 registry. The bot's Fuji transactions paid 160 wei per gas (10 wei base fee plus the 150 wei tip the node suggested), which is under 0.000001 AVAX. On C-Chain mainnet at the 7.5 gwei base fee read on 19 Nov (`cast base-fee --rpc-url https://api.avax.network/ext/bc/C/rpc`) a payment would cost about 0.00072 AVAX and a review about 0.0033 AVAX. That is more than a 0.0005 AVAX quote, so on mainnet C-Chain this design fits payments of a few cents and up. Sub-cent traffic needs an Avalanche L1 with a lower fee floor; the design is in ARCHITECTURE.md and is not deployed. |
| Is there an agent, a rule engine and a policy contract? (L4) | Yes. The rule engine is `packages/agent/src/buyer.ts`. `AgentPolicy` has the daily cap, the per-payment cap, the recipient whitelist and the kill switch. Money, limits and the whitelist belong to the guardian; a second key, the operator, can only pause and resume. The attack demo above shows the whitelist and the cap reverting real transactions. |
| Custody (L3) | Non-custodial. A policy belongs to one agent. Only its guardian can withdraw, and only to itself. The contracts have no owner and no upgrade path. |
| What goes on-chain (L5) | Agent cards (name, description, endpoint, wallet), payments, reviews with the quote and the Chainlink answer used, validation answers, policy state. No personal data. |
| Where does the money come from? (L9) | Sellers are paid per request: 0.0005 AVAX per quote, 0.001 AVAX per trust report in the demo. AIDA's own income would be the trust reports and validation fees. There is no token and no yield. There is no paying customer yet. For scale, x402 settled 198.9 million payments worth $52.7M between May 2025 and September 2026 ([TRM Labs via Decrypt](https://decrypt.co/378103/ai-agents-spending-money-research)). |
| Vietnamese law (L8) | Crypto assets are not legal tender in Vietnam and cannot be used to pay for goods or services. AIDA runs on Fuji with test AVAX that has no value and takes no money from users. Quotes and trust reports are data, not investment advice; an agent selling paid financial or legal advice would need the matching licence. A version for Vietnamese businesses would bill in VND through a licensed payment provider and keep on-chain settlement for agents outside Vietnam. |
| Dev toggles and mocks (L6) | FastQuote is wrong on purpose so the score has something to catch. The agents' HTTP endpoints run on `127.0.0.1`, and their on-chain cards say so; nobody else can call them. Payments are native test AVAX verified on-chain, not the x402 `exact` scheme. The guardian acts through its own wallet (*Connect wallet*) or the CLI. For recording only, `AIDA_DEMO_SIGNER=1 pnpm demo:fuji` adds a demo signer to the dev server: it holds the operator key from `.env.operator`, never the guardian key, and signs nothing except `setPaused` for Treasury Bot. It is off by default, absent from any build, and checks a per-start token, the page origin and the calldata on every request (`packages/web/demo-signer.ts`, 6 tests). The local chain uses stand-ins for the identity registry, the reputation registry and the price feed. |

### What is standard and what is not

- Identity is ERC-8004. The agents are tokens 308 to 312 in the canonical Identity Registry. ERC-8004 is still a Draft; cards use its registration-file fields (`services`, `x402Support`, `active`, `supportedTrust`) plus one AIDA field, `wallet`.
- Reviews are AIDA's own contract, copied to ERC-8004. The canonical Reputation Registry accepts feedback from any address except the agent's owner. `PaidReviews` adds the two conditions (a payment, a score computed from Chainlink) and writes the result into the canonical registry as the client `0x39e5…f548`. ERC-8004's `getSummary` requires the reader to name the clients it trusts, so filtering for this one address returns only payment-backed reviews.
- Payments are x402-style. The HTTP shape is x402 (`402`, `accepts`, `X-PAYMENT`, `X-PAYMENT-RESPONSE`), plus one AIDA header, `X-Agent-Auth`, that proves which agent is calling. The settlement is not: the standard `exact` scheme moves an ERC-20 through a facilitator with EIP-3009, and a stock x402 client cannot pay these sellers. AIDA settles in native AVAX through `AgentPolicy.pay` because the policy contract is the point of the project, and a facilitator would move the money without passing through it.
- Validation is ERC-8004-style and simplified: one named validator gives one answer from 0 to 100.

## Who else does this

| Project | What it does | What AIDA does differently |
|---|---|---|
| [ERC-8004 registries](https://github.com/erc-8004/erc-8004-contracts) on Avalanche | Identity and reputation for agents. `giveFeedback` only blocks self-feedback | AIDA uses them and adds a reviewer that needs a payment and takes the score from an oracle |
| ["Can Trustless Agents Be Trusted?"](https://arxiv.org/abs/2606.26028) (Xiong et al., 2026) | Measured ERC-8004 on Ethereum, BSC and Base: 59 to 91% of reviewers show coordinated Sybil behaviour, and feedback is rarely tied to a real interaction | This is the gap `PaidReviews` targets |
| [Kite Agent Passport](https://docs.avax.network/blog/kite-passport-technical-deep-dive) | Spend limits, merchant categories and time windows per agent session, on Kite's own Avalanche L1 | AIDA's policy is one small contract on C-Chain for any ERC-8004 identity, and sellers refuse payments that went around it |
| [Coinbase Agentic Wallets](https://docs.cdp.coinbase.com/agentic-wallet/cli/welcome) | Session and per-transaction caps enforced by Coinbase's infrastructure; autonomous sends on Base | AIDA's caps are enforced by a contract with no operator |
| x402 facilitators on Avalanche ([Ultravioleta DAO](https://build.avax.network/integrations/ultravioletadao), [thirdweb](https://docs.avax.network/integrations/thirdweb-x402), PayAI, 0xGasless) | Settle USDC with EIP-3009 for x402 sellers | They move money; they do not limit what a buyer agent may spend or say whether the seller was any good |
| [0xGasless agent-sdk](https://github.com/0xgasless/agent-sdk), [evalanche](https://github.com/ijaack/evalanche) | SDKs that combine ERC-8004 identity and x402 on Avalanche; spend caps are off-chain | AIDA's part is the on-chain policy and the oracle-scored review |

## Run locally

Requirements: Node 22+ (tested on 24), pnpm 9, and [Foundry](https://getfoundry.sh) for the Solidity tests.

```bash
git clone --recurse-submodules https://github.com/phuocntme/AIDA.git && cd AIDA
pnpm install
pnpm test                 # all packages (needs forge on PATH)
```

### Local chain, no keys needed
Hardhat node, contracts, the five agents and the web app on http://127.0.0.1:5180. Same story as Fuji with local stand-ins for the registries and the feed.
```bash
pnpm demo                 # then open Economy → Run, Attack; wallet menu → "Guardian (human)" → Kill switch
pnpm e2e                  # second terminal: paid jobs, the attack, the kill switch, with assertions
```

### Fuji, against the live contracts
Needs the team's `.env.fuji` (five agent keys). The guardian key is in `.env.guardian` and the pause-only operator key in `.env.operator`. All three are gitignored, and each process reads one file: the agents `.env.fuji`, the guardian CLI `.env.guardian`, the demo signer `.env.operator`. In production the guardian is a wallet on another device.
```bash
pnpm demo:fuji            # agents on :8790-8794, web on http://127.0.0.1:5181; kill switch = connect the guardian wallet
AIDA_DEMO_SIGNER=1 pnpm demo:fuji   # same, plus "Kill-switch operator (demo signer)" in the wallet menu
pnpm hire --rounds 3      # the bot from a terminal;  pnpm hire --attack  runs the attack
pnpm guardian status      # also: pause | resume | deposit 0.01 | limits 0.03 0.002 | allow <agent> | deny <agent> | operator <address>
pnpm recycle              # sellers send their test AVAX back to the guardian, to deposit again
```
To rebuild from an empty wallet: put a funded `GUARDIAN_PRIVATE_KEY` in `.env.guardian` and five `AGENT_KEY_*` in `.env.fuji`, then run `pnpm -F @aida/contracts deploy:fuji` and `bootstrap:fuji`.

### From an AI agent (MCP)
The repo ships `.mcp.json`. Tools, all read-only: `aida_search_agents`, `aida_get_agent`, `aida_check_trust`, `aida_check_payment`. Smoke test against the local demo: `node packages/mcp/test/smoke.mjs`.

## Tests

131 tests, all passing, plus one opt-in test against live Fuji:

| Suite | Count | Command |
|---|---|---|
| AgentPolicy (Foundry): caps, daily reset, whitelist, kill switch, guardian-only, pause-only operator, payment recorded once, identity transfer freezes payments, failed transfer, reentrancy, fuzz | 19 | `cd packages/contracts && forge test` |
| PaidReviews (Foundry): score table and fuzz, no payment no review, one payment one review, forged or altered quote, stale or broken feed, self-review, ERC-8004 copy and its failure | 16 | same |
| Fork test: deploys both contracts on a Fuji fork and writes a review into the canonical ERC-8004 registries | 1 | `pnpm -F @aida/contracts test:fork` |
| SDK against the contracts (Hardhat): register, paid job, attack reverts by name; ValidationRegistry | 10 | `pnpm -F @aida/contracts exec hardhat test` |
| SDK: card schema, signed quotes, caller authentication, payment checks, `Paid` event verification | 30 | `pnpm -F @aida/sdk test` |
| Agents: paid route, caller authentication (a spoofer cannot use another agent's slots), policy bypass refused, newcomer admission rule, challenge limits, replay of a re-encoded signature, seller choice, payment checks, signed-quote parsing, revert reasons, price scoring | 46 | `pnpm -F @aida/agent test` |
| MCP tools | 4 | `pnpm -F @aida/mcp test` |
| Demo signer request checks: token, origin, JSON, only `setPaused` for the demo agent | 6 | `pnpm -F @aida/web test` |

The web app is also type-checked by that command and built with `pnpm -F @aida/web build`. `pnpm e2e` runs the whole flow on a local chain.

## Layout

| Path | What |
|---|---|
| `packages/contracts` | Solidity 0.8.28: `AgentPolicy`, `PaidReviews`, `ValidationRegistry`; local stand-ins in `contracts/local`; Hardhat scripts; Foundry tests in `test-forge/` |
| `packages/sdk` | viem client, card schema, signed-quote helpers, x402-style helpers |
| `packages/agent` | the agent network (`network.ts`), paid route (`paid.ts`), Treasury Bot and attack (`buyer.ts`), guardian CLI |
| `packages/web` | Vite + React app: agents, economy (policy, run timeline, attack, kill switch), profile, register |
| `packages/mcp` | read-only MCP server |

## Limits and next steps

- Two wallets owned by one person can still pay each other and collect reviews. What they can no longer do is choose the score of a quote or post a review without a payment through a guardian-held policy. Readers should also look at how many different payers reviewed an agent; weighting by payer is not built.
- Reviews of jobs with no oracle (the trust report) are payment-backed but the score is the reviewer's own. They are stored with `checked = false`.
- The daily cap resets at 00:00 UTC, so up to twice the cap can be spent across that boundary. A rolling window and a timelock on raising caps are small additions.
- The bot's wallet holds a little AVAX for gas. A seller outside AIDA that does not check the `Paid` event could be paid from that balance; the policy protects the funds deposited in it.
- Sellers keep open 402 challenges in memory. After a restart an old payment cannot be replayed, and a payment made just before the restart has to be made again. A challenge that was already paid is never dropped. A seller issues challenges only to requests signed by the agent's wallet, so nobody else can use up an agent's eight open challenges; unsigned requests are limited per client address (60 a minute), which means callers behind one shared address share that limit.
- Not built: USDC settlement through an x402 facilitator, public hosting for the agents, the Avalanche L1.

## Built when, team, license

Written during the event: first commit 12 Nov 2026, contracts redeployed on 19 Nov 2026. No code predates the event.

phuocntme · Team1 Vietnam UniHack 2026.

[MIT](LICENSE)
