import {
  defineChain,
  parseEventLogs,
  stringToHex,
  hexToString,
  type Account,
  type Chain,
  type PublicClient,
  type Transport,
  type WalletClient,
} from "viem";
import { avalancheFuji } from "viem/chains";
import { identityAbi, reputationAbi, validationAbi } from "./abi.ts";
import { decodeCardURI, encodeCardURI, validateCard, type AgentCard } from "./card.ts";
import type { Hex } from "./x402.ts";

export const localChain = defineChain({
  id: 31337,
  name: "Hardhat local",
  nativeCurrency: { name: "AVAX", symbol: "AVAX", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
});

export const chains: Record<number, Chain> = { 31337: localChain, 43113: avalancheFuji };

export type Deployment = {
  chainId: number;
  identity: Hex;
  reputation: Hex;
  validation?: Hex;
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
  kind: "registered" | "feedback" | "validation-requested" | "validated";
  agentId: bigint;
  actor: Hex;
  score?: number;
  blockNumber: bigint;
  logIndex: number;
  txHash?: Hex;
  timestamp?: bigint;
};

export type FeedbackView = { client: Hex; score: number; tag: string; uri: string; timestamp: bigint };

export const tagToBytes = (tag: string) => stringToHex(tag.slice(0, 31), { size: 32 });
export const bytesToTag = (b: Hex) => hexToString(b, { size: 32 }).replace(/\0+$/, "");

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

  async register(card: AgentCard): Promise<{ agentId: bigint; txHash: Hex }> {
    const v = validateCard(card);
    if (!v.ok) throw new Error(`Invalid agent card: ${v.errors.join("; ")}`);
    const w = this.needWallet();
    const txHash = await w.writeContract({
      address: this.dep.identity,
      abi: identityAbi,
      functionName: "register",
      args: [encodeCardURI(card)],
    });
    const receipt = await this.pub.waitForTransactionReceipt({ hash: txHash });
    const [ev] = parseEventLogs({ abi: identityAbi, logs: receipt.logs, eventName: "Registered" });
    if (!ev) throw new Error("Registered event not found in receipt");
    return { agentId: ev.args.agentId, txHash };
  }

  async giveFeedback(agentId: bigint, score: number, tag: string, uri = ""): Promise<Hex> {
    if (!Number.isInteger(score) || score < 0 || score > 100) throw new Error("score must be an integer 0-100");
    const w = this.needWallet();
    const txHash = await w.writeContract({
      address: this.dep.reputation,
      abi: reputationAbi,
      functionName: "giveFeedback",
      args: [agentId, score, tagToBytes(tag), uri],
    });
    await this.pub.waitForTransactionReceipt({ hash: txHash });
    return txHash;
  }

  async summary(agentId: bigint): Promise<{ count: bigint; average: bigint }> {
    const [count, average] = await this.pub.readContract({
      address: this.dep.reputation,
      abi: reputationAbi,
      functionName: "getSummary",
      args: [agentId],
    });
    return { count, average };
  }

  async feedback(agentId: bigint): Promise<FeedbackView[]> {
    const list = await this.pub.readContract({
      address: this.dep.reputation,
      abi: reputationAbi,
      functionName: "getFeedback",
      args: [agentId],
    });
    return list.map((f) => ({ client: f.client, score: f.score, tag: bytesToTag(f.tag), uri: f.uri, timestamp: f.timestamp }));
  }

  async exists(agentId: bigint): Promise<boolean> {
    return this.pub.readContract({ address: this.dep.identity, abi: identityAbi, functionName: "exists", args: [agentId] });
  }

  async ownerOf(agentId: bigint): Promise<Hex> {
    return this.pub.readContract({ address: this.dep.identity, abi: identityAbi, functionName: "ownerOf", args: [agentId] });
  }

  private needValidation(): Hex {
    if (!this.dep.validation) throw new Error("This deployment has no ValidationRegistry");
    return this.dep.validation;
  }

  async requestValidation(agentId: bigint, validator: Hex, requestURI: string): Promise<{ requestId: bigint; txHash: Hex }> {
    const w = this.needWallet();
    const txHash = await w.writeContract({ address: this.needValidation(), abi: validationAbi, functionName: "requestValidation", args: [agentId, validator, requestURI] });
    const receipt = await this.pub.waitForTransactionReceipt({ hash: txHash });
    const [ev] = parseEventLogs({ abi: validationAbi, logs: receipt.logs, eventName: "ValidationRequested" });
    if (!ev) throw new Error("ValidationRequested event not found in receipt");
    return { requestId: ev.args.requestId, txHash };
  }

  async respondValidation(requestId: bigint, response: number, responseURI = ""): Promise<Hex> {
    if (!Number.isInteger(response) || response < 0 || response > 100) throw new Error("response must be an integer 0-100");
    const w = this.needWallet();
    const txHash = await w.writeContract({ address: this.needValidation(), abi: validationAbi, functionName: "respond", args: [requestId, response, responseURI] });
    await this.pub.waitForTransactionReceipt({ hash: txHash });
    return txHash;
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
   * Recent activity, newest first. Local chain: contract events. Public RPCs (Fuji caps getLogs at 100 blocks):
   * rebuilt from contract state instead — reviews and validations carry on-chain timestamps.
   */
  async activity(limit = 12): Promise<ActivityItem[]> {
    if (this.dep.chainId === 31337) return this.activityFromLogs(limit);
    return this.activityFromState(limit);
  }

  async activityFromState(limit = 12): Promise<ActivityItem[]> {
    const agents = await this.list();
    const items: ActivityItem[] = [];
    await Promise.all(
      agents.map(async (a) => {
        const [fb, vs] = await Promise.all([this.feedback(a.agentId), this.validations(a.agentId)]);
        fb.forEach((f, i) => items.push({ kind: "feedback", agentId: a.agentId, actor: f.client, score: f.score, blockNumber: 0n, logIndex: i, timestamp: f.timestamp }));
        for (const v of vs) {
          items.push({ kind: "validation-requested", agentId: a.agentId, actor: v.validator, blockNumber: 0n, logIndex: Number(v.requestId) * 2, timestamp: v.requestedAt });
          if (v.responded) items.push({ kind: "validated", agentId: a.agentId, actor: v.validator, score: v.response, blockNumber: 0n, logIndex: Number(v.requestId) * 2 + 1, timestamp: v.respondedAt });
        }
      }),
    );
    items.sort((x, y) => (x.timestamp === y.timestamp ? y.logIndex - x.logIndex : Number((y.timestamp ?? 0n) - (x.timestamp ?? 0n))));
    return items.slice(0, limit);
  }

  async activityFromLogs(limit = 12, windows = 5): Promise<ActivityItem[]> {
    const latest = await this.pub.getBlockNumber();
    const items: ActivityItem[] = [];
    let to = latest;
    for (let n = 0; n < windows && to >= 0n && items.length < limit; n++) {
      const from = to > 1999n ? to - 1999n : 0n;
      const range = { fromBlock: from, toBlock: to };
      const [reg, fb, vreq, vres] = await Promise.all([
        this.pub.getContractEvents({ address: this.dep.identity, abi: identityAbi, eventName: "Registered", ...range }),
        this.pub.getContractEvents({ address: this.dep.reputation, abi: reputationAbi, eventName: "NewFeedback", ...range }),
        this.dep.validation ? this.pub.getContractEvents({ address: this.dep.validation, abi: validationAbi, eventName: "ValidationRequested", ...range }) : Promise.resolve([]),
        this.dep.validation ? this.pub.getContractEvents({ address: this.dep.validation, abi: validationAbi, eventName: "ValidationResponded", ...range }) : Promise.resolve([]),
      ]);
      const base = (l: { blockNumber: bigint; logIndex: number; transactionHash: Hex }) => ({ blockNumber: l.blockNumber, logIndex: l.logIndex, txHash: l.transactionHash });
      for (const l of reg) items.push({ kind: "registered", agentId: l.args.agentId!, actor: l.args.owner!, ...base(l) });
      for (const l of fb) items.push({ kind: "feedback", agentId: l.args.agentId!, actor: l.args.client!, score: l.args.score, ...base(l) });
      for (const l of vreq) items.push({ kind: "validation-requested", agentId: l.args.agentId!, actor: l.args.validator!, ...base(l) });
      for (const l of vres) items.push({ kind: "validated", agentId: l.args.agentId!, actor: "0x0000000000000000000000000000000000000000", score: l.args.response, ...base(l) });
      if (from === 0n) break;
      to = from - 1n;
    }
    items.sort((a, b) => (a.blockNumber === b.blockNumber ? b.logIndex - a.logIndex : Number(b.blockNumber - a.blockNumber)));
    const top = items.slice(0, limit);
    const blocks = [...new Set(top.map((i) => i.blockNumber))];
    const times = new Map(await Promise.all(blocks.map(async (b) => [b, (await this.pub.getBlock({ blockNumber: b })).timestamp] as const)));
    return top.map((i) => ({ ...i, timestamp: times.get(i.blockNumber) }));
  }

  async resolve(agentId: bigint): Promise<AgentView | null> {
    if (!(await this.exists(agentId))) return null;
    const [owner, uri, s] = await Promise.all([
      this.ownerOf(agentId),
      this.pub.readContract({ address: this.dep.identity, abi: identityAbi, functionName: "tokenURI", args: [agentId] }),
      this.summary(agentId),
    ]);
    const decoded = decodeCardURI(uri);
    return {
      agentId,
      owner,
      uri,
      card: decoded.ok ? decoded.card : null,
      cardErrors: decoded.ok ? [] : decoded.errors,
      ...s,
    };
  }

  async list(): Promise<AgentView[]> {
    const total = await this.pub.readContract({ address: this.dep.identity, abi: identityAbi, functionName: "totalAgents" });
    const ids = Array.from({ length: Number(total) }, (_, i) => BigInt(i + 1));
    const views = await Promise.all(ids.map((id) => this.resolve(id)));
    return views.filter((v): v is AgentView => v !== null);
  }
}
