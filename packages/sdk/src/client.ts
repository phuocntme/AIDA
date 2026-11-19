import {
  defineChain,
  encodeAbiParameters,
  keccak256,
  parseAbi,
  parseEventLogs,
  recoverMessageAddress,
  type Account,
  type Chain,
  type PublicClient,
  type Transport,
  type WalletClient,
} from "viem";
import { avalancheFuji } from "viem/chains";
import { agentPolicyAbi, identityAbi, reviewsAbi, validationAbi } from "./abi.ts";
import { decodeCardURI, encodeCardURI, validateCard, type AgentCard } from "./card.ts";
import { callAuthDigest, encodeCallAuth, type Hex } from "./x402.ts";

export const localChain = defineChain({
  id: 31337,
  name: "Hardhat local",
  nativeCurrency: { name: "AVAX", symbol: "AVAX", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
});

export const chains: Record<number, Chain> = { 31337: localChain, 43113: avalancheFuji };

export type Deployment = {
  chainId: number;
  /** ERC-8004 Identity Registry. On Fuji: the canonical registry 0x8004A818…BD9e. Local chain: a stand-in. */
  identity: Hex;
  /** PaidReviews: directory + payment-backed reviews, scores for quotes computed from Chainlink on-chain. */
  reviews: Hex;
  /** AgentPolicy: spending caps, recipient whitelist and kill switch. */
  policy: Hex;
  validation?: Hex;
  /** Chainlink AVAX/USD feed (a mock on the local chain). */
  feed: Hex;
  /** ERC-8004 Reputation Registry that receives a copy of every review (canonical on Fuji). */
  erc8004Reputation?: Hex;
  guardian?: Hex;
  oracleAgentId?: string;
  validatorAgentId?: string;
  agents?: Record<string, { agentId: string; address: string; port: number; endpoint: string }>;
};

export type AgentView = {
  agentId: bigint;
  owner: Hex;
  uri: string;
  card: AgentCard | null;
  cardErrors: string[];
  count: bigint;
  average: bigint;
  /** How many of the reviews were scored on-chain against Chainlink. */
  checked: bigint;
};

export type ValidationView = {
  requestId: bigint;
  agentId: bigint;
  validator: Hex;
  requestURI: string;
  responded: boolean;
  response: number;
  responseURI: string;
  requestedAt: bigint;
  respondedAt: bigint;
};

export type ActivityItem = {
  kind: "feedback" | "validation-requested" | "validated";
  agentId: bigint;
  actor: Hex;
  score?: number;
  checked?: boolean;
  logIndex: number;
  timestamp?: bigint;
};

export type PolicyView = {
  agentId: bigint;
  guardian: Hex;
  /** Pause-only key named by the guardian (zero address = none). */
  operator: Hex;
  agent: Hex;
  dailyCap: bigint;
  perPaymentCap: bigint;
  balance: bigint;
  spentToday: bigint;
  paused: boolean;
  payments: bigint;
  totalPaid: bigint;
  recipients: Hex[];
};

export type FeedbackView = {
  reviewerAgentId: bigint;
  client: Hex;
  score: number;
  /** true: the contract computed the score from the seller's signed quote and the Chainlink feed. */
  checked: boolean;
  tag: string;
  timestamp: bigint;
  /** USD, 0 when not checked */
  quote: number;
  feedPrice: number;
  feedUpdatedAt: bigint;
  ref: Hex;
};

export type SignedQuote = { agentId: bigint; quote: bigint; quotedAt: number; ref: Hex; signature: Hex };

export const FEED_DECIMALS = 8;
/** USD price → feed units (8 decimals). */
export const toFeedUnits = (usd: number) => BigInt(Math.round(usd * 10 ** FEED_DECIMALS));
export const fromFeedUnits = (v: bigint) => Number(v) / 10 ** FEED_DECIMALS;

/** Same hash as PaidReviews.quoteDigest: what a seller signs when it answers a paid quote request. */
export function quoteDigest(reviews: Hex, chainId: number, q: Omit<SignedQuote, "signature">): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "uint128" }, { type: "uint64" }, { type: "bytes32" }],
      [reviews, BigInt(chainId), q.agentId, q.quote, BigInt(q.quotedAt), q.ref],
    ),
  );
}

/** Who signed this quote (personal_sign over quoteDigest). Null if the signature is malformed. */
export async function quoteSigner(reviews: Hex, chainId: number, q: SignedQuote): Promise<Hex | null> {
  try {
    return await recoverMessageAddress({ message: { raw: quoteDigest(reviews, chainId, q) }, signature: q.signature });
  } catch {
    return null;
  }
}

/** PaidReviews calls can revert with AgentPolicy's errors (NoSuchPayment, AlreadyReviewed): decode both. */
const reviewsWriteAbi = [...reviewsAbi, ...agentPolicyAbi.filter((x) => x.type === "error")];
const feedAbi = parseAbi(["function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)"]);
/** Read side of the ERC-8004 Reputation Registry (reference implementation v2). */
export const erc8004ReputationAbi = parseAbi([
  "function getSummary(uint256 agentId, address[] clientAddresses, string tag1, string tag2) view returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals)",
  "function getClients(uint256 agentId) view returns (address[])",
]);

export class AidaClient {
  readonly pub: PublicClient<Transport, Chain>;
  readonly dep: Deployment;
  readonly wallet?: WalletClient<Transport, Chain, Account>;

  constructor(pub: PublicClient<Transport, Chain>, dep: Deployment, wallet?: WalletClient<Transport, Chain, Account>) {
    this.pub = pub;
    this.dep = dep;
    this.wallet = wallet;
  }

  private needWallet() {
    if (!this.wallet) throw new Error("A wallet is required for this action");
    return this.wallet;
  }

  /** Simulates first (a revert throws before any gas is spent), then sends and waits. */
  private async send(address: Hex, abi: unknown, functionName: string, args: unknown[], value?: bigint, beforeSend?: () => void) {
    const w = this.needWallet();
    const { request } = await this.pub.simulateContract({ account: w.account, address, abi, functionName, args, value } as never);
    beforeSend?.();
    const txHash = await w.writeContract(request as never);
    const receipt = await this.pub.waitForTransactionReceipt({ hash: txHash, timeout: 180_000 });
    if (receipt.status !== "success") throw new Error(`${functionName} reverted`);
    return { txHash, receipt };
  }

  // ---------- identity (ERC-8004 Identity Registry) + AIDA directory ----------

  /** Mints an ERC-8004 identity for the card, then lists it in the AIDA directory. Two transactions. */
  async register(card: AgentCard): Promise<{ agentId: bigint; txHash: Hex; enrollTx: Hex }> {
    const v = validateCard(card);
    if (!v.ok) throw new Error(`Invalid agent card: ${v.errors.join("; ")}`);
    const { txHash, receipt } = await this.send(this.dep.identity, identityAbi, "register", [encodeCardURI(card)]);
    const logs = receipt.logs.filter((l) => l.address.toLowerCase() === this.dep.identity.toLowerCase());
    const [ev] = parseEventLogs({ abi: identityAbi, logs, eventName: "Registered" });
    if (!ev) throw new Error("Registered event not found in receipt");
    const enrollTx = await this.enroll(ev.args.agentId);
    return { agentId: ev.args.agentId, txHash, enrollTx };
  }

  /** Lists an existing ERC-8004 identity (owned by this wallet) in the AIDA directory. */
  async enroll(agentId: bigint): Promise<Hex> {
    return (await this.send(this.dep.reviews, reviewsAbi, "enroll", [agentId])).txHash;
  }

  async setAgentURI(agentId: bigint, card: AgentCard): Promise<Hex> {
    return (await this.send(this.dep.identity, identityAbi, "setAgentURI", [agentId, encodeCardURI(card)])).txHash;
  }

  async ownerOf(agentId: bigint): Promise<Hex> {
    return this.pub.readContract({ address: this.dep.identity, abi: identityAbi, functionName: "ownerOf", args: [agentId] });
  }

  /** Ids listed in the AIDA directory. */
  async agentIds(): Promise<bigint[]> {
    return [...(await this.pub.readContract({ address: this.dep.reviews, abi: reviewsAbi, functionName: "agents" }))];
  }

  async resolve(agentId: bigint): Promise<AgentView | null> {
    try {
      const [owner, uri, s] = await Promise.all([
        this.ownerOf(agentId),
        this.pub.readContract({ address: this.dep.identity, abi: identityAbi, functionName: "tokenURI", args: [agentId] }),
        this.summary(agentId),
      ]);
      const decoded = decodeCardURI(uri);
      return { agentId, owner, uri, card: decoded.ok ? decoded.card : null, cardErrors: decoded.ok ? [] : decoded.errors, ...s };
    } catch (e) {
      // ownerOf reverts for an id that was never minted
      if (/ERC721NonexistentToken|reverted|revert/i.test((e as Error).message)) return null;
      throw e;
    }
  }

  async list(): Promise<AgentView[]> {
    const views = await Promise.all((await this.agentIds()).map((id) => this.resolve(id)));
    return views.filter((v): v is AgentView => v !== null);
  }

  // ---------- reviews (PaidReviews) ----------

  async summary(agentId: bigint): Promise<{ count: bigint; average: bigint; checked: bigint }> {
    const [count, average, checked] = await this.pub.readContract({ address: this.dep.reviews, abi: reviewsAbi, functionName: "getSummary", args: [agentId] });
    return { count, average, checked };
  }

  async feedback(agentId: bigint): Promise<FeedbackView[]> {
    const list = await this.pub.readContract({ address: this.dep.reviews, abi: reviewsAbi, functionName: "getReviews", args: [agentId] });
    return list.map((f) => ({
      reviewerAgentId: f.reviewerAgentId,
      client: f.client,
      score: f.score,
      checked: f.checked,
      tag: f.tag,
      timestamp: f.timestamp,
      quote: fromFeedUnits(f.quote),
      feedPrice: fromFeedUnits(f.feedPrice),
      feedUpdatedAt: f.feedUpdatedAt,
      ref: f.ref,
    }));
  }

  /** X-Agent-Auth header for one request to a seller: proves this wallet holds `agentId` (see x402.ts). */
  async signCall(agentId: bigint, audience: string, path: string): Promise<string> {
    const w = this.needWallet();
    const ts = Math.floor(Date.now() / 1000);
    const nonce = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("");
    const sig = await w.signMessage({ message: { raw: callAuthDigest({ chainId: this.dep.chainId, agentId, audience, path }, ts, nonce) } });
    return encodeCallAuth({ ts, nonce, sig });
  }

  /** Signs a quote as the seller (this wallet must own `agentId`). */
  async signQuote(q: Omit<SignedQuote, "signature">): Promise<SignedQuote> {
    const w = this.needWallet();
    const signature = await w.signMessage({ message: { raw: quoteDigest(this.dep.reviews, this.dep.chainId, q) } });
    return { ...q, signature };
  }

  /**
   * Reviews a paid price quote. The reviewer passes the seller's signed quote; the contract reads Chainlink and
   * computes the score. Returns what the contract decided.
   */
  async reviewQuote(q: SignedQuote): Promise<{ txHash: Hex; score: number; feedPrice: number; feedUpdatedAt: bigint; mirrored: boolean | null }> {
    const { txHash, receipt } = await this.send(this.dep.reviews, reviewsWriteAbi, "reviewQuote", [q.ref, q.agentId, q.quote, BigInt(q.quotedAt), q.signature]);
    const logs = receipt.logs.filter((l) => l.address.toLowerCase() === this.dep.reviews.toLowerCase());
    const [ev] = parseEventLogs({ abi: reviewsAbi, logs, eventName: "Reviewed" });
    if (!ev) throw new Error("Reviewed event not found in receipt");
    const [m] = parseEventLogs({ abi: reviewsAbi, logs, eventName: "Mirrored" });
    return { txHash, score: ev.args.score, feedPrice: fromFeedUnits(ev.args.feedPrice), feedUpdatedAt: ev.args.feedUpdatedAt, mirrored: m ? m.args.ok : null };
  }

  /** Reviews any other paid job: payment-backed, score chosen by the reviewer. */
  async review(ref: Hex, agentId: bigint, score: number, tag: string): Promise<Hex> {
    if (!Number.isInteger(score) || score < 0 || score > 100) throw new Error("score must be an integer 0-100");
    return (await this.send(this.dep.reviews, reviewsWriteAbi, "review", [ref, agentId, score, tag.slice(0, 31)])).txHash;
  }

  /** Chainlink AVAX/USD as the contracts see it. */
  async feedPrice(): Promise<{ price: number; updatedAt: number }> {
    const r = await this.pub.readContract({ address: this.dep.feed, abi: feedAbi, functionName: "latestRoundData" });
    return { price: fromFeedUnits(r[1]), updatedAt: Number(r[3]) };
  }

  /** The copy of AIDA's reviews in the ERC-8004 Reputation Registry (client = PaidReviews). Null if not configured. */
  async erc8004Summary(agentId: bigint): Promise<{ count: number; average: number } | null> {
    if (!this.dep.erc8004Reputation) return null;
    const [count, value, decimals] = await this.pub.readContract({
      address: this.dep.erc8004Reputation,
      abi: erc8004ReputationAbi,
      functionName: "getSummary",
      args: [agentId, [this.dep.reviews], "", ""],
    });
    return { count: Number(count), average: Number(value) / 10 ** decimals };
  }

  // ---------- validation ----------

  private needValidation(): Hex {
    if (!this.dep.validation) throw new Error("This deployment has no ValidationRegistry");
    return this.dep.validation;
  }

  async requestValidation(agentId: bigint, validator: Hex, requestURI: string): Promise<{ requestId: bigint; txHash: Hex }> {
    const { txHash, receipt } = await this.send(this.needValidation(), validationAbi, "requestValidation", [agentId, validator, requestURI]);
    const [ev] = parseEventLogs({ abi: validationAbi, logs: receipt.logs, eventName: "ValidationRequested" });
    if (!ev) throw new Error("ValidationRequested event not found in receipt");
    return { requestId: ev.args.requestId, txHash };
  }

  async respondValidation(requestId: bigint, response: number, responseURI = ""): Promise<Hex> {
    if (!Number.isInteger(response) || response < 0 || response > 100) throw new Error("response must be an integer 0-100");
    return (await this.send(this.needValidation(), validationAbi, "respond", [requestId, response, responseURI])).txHash;
  }

  async validations(agentId: bigint): Promise<ValidationView[]> {
    if (!this.dep.validation) return [];
    const address = this.dep.validation;
    const ids = await this.pub.readContract({ address, abi: validationAbi, functionName: "getAgentRequests", args: [agentId] });
    return Promise.all(
      ids.map(async (requestId) => {
        const r = await this.pub.readContract({ address, abi: validationAbi, functionName: "getRequest", args: [requestId] });
        return { requestId, ...r };
      }),
    );
  }

  async validationSummary(agentId: bigint): Promise<{ count: bigint; average: bigint }> {
    if (!this.dep.validation) return { count: 0n, average: 0n };
    const [count, average] = await this.pub.readContract({ address: this.dep.validation, abi: validationAbi, functionName: "getSummary", args: [agentId] });
    return { count, average };
  }

  /**
   * Recent reviews and audits, newest first, rebuilt from contract state (each record carries its timestamp).
   * Public Fuji RPCs cap eth_getLogs at a small block range, so events are not used here.
   */
  async activity(limit = 12): Promise<ActivityItem[]> {
    const agents = await this.list();
    const items: ActivityItem[] = [];
    await Promise.all(
      agents.map(async (a) => {
        const [fb, vs] = await Promise.all([this.feedback(a.agentId), this.validations(a.agentId)]);
        fb.forEach((f, i) => items.push({ kind: "feedback", agentId: a.agentId, actor: f.client, score: f.score, checked: f.checked, logIndex: i, timestamp: f.timestamp }));
        for (const v of vs) {
          items.push({ kind: "validation-requested", agentId: a.agentId, actor: v.validator, logIndex: Number(v.requestId) * 2, timestamp: v.requestedAt });
          if (v.responded) items.push({ kind: "validated", agentId: a.agentId, actor: v.validator, score: v.response, logIndex: Number(v.requestId) * 2 + 1, timestamp: v.respondedAt });
        }
      }),
    );
    items.sort((x, y) => (x.timestamp === y.timestamp ? y.logIndex - x.logIndex : Number((y.timestamp ?? 0n) - (x.timestamp ?? 0n))));
    return items.slice(0, limit);
  }

  // ---------- AgentPolicy ----------

  /** null when the agent has no policy. */
  async policy(agentId: bigint): Promise<PolicyView | null> {
    const address = this.dep.policy;
    const [p, recipients, operator] = await Promise.all([
      this.pub.readContract({ address, abi: agentPolicyAbi, functionName: "getPolicy", args: [agentId] }),
      this.pub.readContract({ address, abi: agentPolicyAbi, functionName: "recipients", args: [agentId] }),
      this.pub.readContract({ address, abi: agentPolicyAbi, functionName: "operator", args: [agentId] }),
    ]);
    if (!p.exists) return null;
    return {
      agentId,
      guardian: p.guardian,
      operator,
      agent: p.agent,
      dailyCap: p.dailyCap,
      perPaymentCap: p.perPaymentCap,
      balance: p.balance,
      spentToday: p.spentToday,
      paused: p.paused,
      payments: BigInt(p.payments),
      totalPaid: p.totalPaid,
      recipients: [...recipients],
    };
  }

  async createPolicy(agentId: bigint, guardian: Hex, dailyCap: bigint, perPaymentCap: bigint): Promise<Hex> {
    return (await this.send(this.dep.policy, agentPolicyAbi, "createPolicy", [agentId, guardian, dailyCap, perPaymentCap])).txHash;
  }

  /** Pays through the agent's policy. Simulates first, so a policy violation throws before any gas is spent. */
  async payViaPolicy(agentId: bigint, to: Hex, amount: bigint, ref: Hex, beforeSend?: () => void): Promise<Hex> {
    return (await this.send(this.dep.policy, agentPolicyAbi, "pay", [agentId, to, amount, ref], undefined, beforeSend)).txHash;
  }

  /**
   * Dry-runs AgentPolicy.pay (eth_call). Resolves when the contract would accept, rejects with its revert otherwise.
   * `from` defaults to this client's wallet; pass the agent's address to ask without holding its key.
   */
  async simulatePolicyPay(agentId: bigint, to: Hex, amount: bigint, from?: Hex, ref: Hex = `0x${"00".repeat(31)}01`): Promise<void> {
    const account = from ?? this.needWallet().account;
    await this.pub.simulateContract({ account, address: this.dep.policy, abi: agentPolicyAbi, functionName: "pay", args: [agentId, to, amount, ref] });
  }

  /**
   * Sends AgentPolicy.pay WITHOUT simulating, with a fixed gas limit, so a refused payment is mined as a reverted
   * transaction that anyone can open on the explorer. Used by the attack demo.
   */
  async forcePolicyPay(agentId: bigint, to: Hex, amount: bigint, ref: Hex): Promise<{ txHash: Hex | null; reverted: boolean }> {
    const w = this.needWallet();
    let txHash: Hex;
    try {
      txHash = await w.writeContract({ address: this.dep.policy, abi: agentPolicyAbi, functionName: "pay", args: [agentId, to, amount, ref], gas: 150_000n });
    } catch (e) {
      // A local dev node refuses to accept a transaction that would revert; public networks mine it as failed.
      if (/revert/i.test((e as Error).message)) return { txHash: null, reverted: true };
      throw e;
    }
    const receipt = await this.pub.waitForTransactionReceipt({ hash: txHash, timeout: 180_000 });
    return { txHash, reverted: receipt.status !== "success" };
  }

  async payment(ref: Hex): Promise<{ to: Hex; agentId: bigint; reviewed: boolean } | null> {
    const p = await this.pub.readContract({ address: this.dep.policy, abi: agentPolicyAbi, functionName: "getPayment", args: [ref] });
    return /^0x0+$/.test(p.to) ? null : { to: p.to, agentId: p.agentId, reviewed: p.reviewed };
  }

  // guardian actions
  async setPolicyPaused(agentId: bigint, paused: boolean): Promise<Hex> {
    return (await this.send(this.dep.policy, agentPolicyAbi, "setPaused", [agentId, paused])).txHash;
  }
  async setPolicyOperator(agentId: bigint, operator: Hex): Promise<Hex> {
    return (await this.send(this.dep.policy, agentPolicyAbi, "setOperator", [agentId, operator])).txHash;
  }
  async setPolicyRecipient(agentId: bigint, to: Hex, allowed: boolean): Promise<Hex> {
    return (await this.send(this.dep.policy, agentPolicyAbi, "setRecipient", [agentId, to, allowed])).txHash;
  }
  async setPolicyLimits(agentId: bigint, dailyCap: bigint, perPaymentCap: bigint): Promise<Hex> {
    return (await this.send(this.dep.policy, agentPolicyAbi, "setLimits", [agentId, dailyCap, perPaymentCap])).txHash;
  }
  async depositToPolicy(agentId: bigint, amount: bigint): Promise<Hex> {
    return (await this.send(this.dep.policy, agentPolicyAbi, "deposit", [agentId], amount)).txHash;
  }
  async withdrawFromPolicy(agentId: bigint, amount: bigint): Promise<Hex> {
    return (await this.send(this.dep.policy, agentPolicyAbi, "withdraw", [agentId, amount])).txHash;
  }
}
