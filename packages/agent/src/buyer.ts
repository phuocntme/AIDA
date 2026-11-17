// Treasury Bot — an autonomous buyer agent on Avalanche Fuji.
// Each round: discover AVAX/USD sellers on AIDA → pick one → pay over x402 → verify the quote against
// Chainlink → rate the seller on-chain. Policy: try newcomers first, re-check the runner-up every third round,
// otherwise hire the most trusted seller; never hire a seller AIDA shows below 60 after 2+ reviews.
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, formatEther, http, parseEther, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { avalancheFuji } from "viem/chains";
import { AidaClient, callPaidAgent, nonceToData, type AgentView, type Deployment, type PaymentRequirement } from "@aida/sdk";
import { accuracyScore, chainlinkPrice } from "./price.ts";

export type BuyerEvent = { level: "head" | "info" | "ok" | "warn" | "err"; text: string; tx?: string };
const trust = (a: AgentView) => (a.count === 0n ? "new" : `${a.average}/100 · ${a.count} reviews`);
const MIN_TRUST = 60n;

export type SpendPolicy = { maxWei: bigint; budgetWei: bigint; chainId: number };
type Check = { ok: true } | { ok: false; reason: string };

/** Client-side spending policy: never trust the seller's 402 blindly (unit-tested). */
export function checkPayment(req: PaymentRequirement, seller: AgentView, policy: SpendPolicy, spentWei: bigint): Check {
  if (req.asset !== "native" || req.scheme !== "exact") return { ok: false, reason: "unsupported payment scheme" };
  if (req.chainId !== policy.chainId) return { ok: false, reason: `wrong chain ${req.chainId}` };
  let amount: bigint;
  try {
    amount = BigInt(req.maxAmountRequired);
  } catch {
    return { ok: false, reason: "invalid amount" };
  }
  if (amount <= 0n || amount > policy.maxWei) return { ok: false, reason: `price ${formatEther(amount)} AVAX above the per-call cap ${formatEther(policy.maxWei)}` };
  if (spentWei + amount > policy.budgetWei) return { ok: false, reason: `run budget ${formatEther(policy.budgetWei)} AVAX would be exceeded` };
  const allowed = [seller.card?.wallet, seller.owner].filter(Boolean).map((a) => a!.toLowerCase());
  if (!allowed.includes(req.payTo.toLowerCase())) return { ok: false, reason: "payTo is not the seller's registered wallet" };
  return { ok: true };
}

/** Only call http(s) endpoints on allowlisted hosts (the agents run locally by default). */
export function endpointAllowed(endpoint: string, hosts: string[]): boolean {
  try {
    const u = new URL(endpoint);
    return (u.protocol === "http:" || u.protocol === "https:") && hosts.includes(u.hostname);
  } catch {
    return false;
  }
}

const safeFetch: typeof fetch = (input, init) => fetch(input, { ...init, redirect: "error", signal: AbortSignal.timeout(15000) });
const brief = (body: unknown) => {
  const b = body as { error?: unknown; reason?: unknown } | null;
  return String(b?.reason ?? b?.error ?? "unexpected response").replace(/[^\x20-\x7E]/g, "").slice(0, 160);
};

/** Pure selection policy (unit-tested). */
export function chooseSeller(sellers: AgentView[], tried: Set<bigint>, round: number): { pick: AgentView | null; why: string; skipped: AgentView[] } {
  const skipped = sellers.filter((a) => a.count >= 2n && a.average < MIN_TRUST);
  const ok = sellers.filter((a) => !skipped.includes(a));
  const fresh = ok.find((a) => a.count === 0n && !tried.has(a.agentId));
  if (fresh) return { pick: fresh, why: "no reviews yet — trying the newcomer", skipped };
  const ranked = [...ok].sort((x, y) => Number(y.average - x.average) || Number(x.count - y.count));
  if (round % 3 === 0 && ranked[1] && ranked[1].count < 5n) return { pick: ranked[1], why: `re-checking the runner-up (${trust(ranked[1])})`, skipped };
  const best = ranked[0] ?? null;
  return { pick: best, why: best ? `highest AIDA trust (${trust(best)})` : "no trustworthy seller left", skipped };
}

export function loadBuyer() {
  const root = new URL("../../../", import.meta.url);
  const dep: Deployment = JSON.parse(readFileSync(new URL("deployments/43113.json", root), "utf8"));
  const env = readFileSync(new URL(".env.fuji", root), "utf8");
  const key = /^AGENT_KEY_BUYER=(0x[0-9a-fA-F]{64})$/m.exec(env)?.[1] as Hex;
  if (!key || !dep.agents) throw new Error("run bootstrap:fuji first (needs AGENT_KEY_BUYER and deployments/43113.json agents)");
  const rpc = process.env.FUJI_RPC_URL ?? "https://avalanche-fuji-c-chain-rpc.publicnode.com";
  const pub = createPublicClient({ chain: avalancheFuji, transport: http(rpc, { retryCount: 4 }), pollingInterval: 1000 });
  const wallet = createWalletClient({ account: privateKeyToAccount(key), chain: avalancheFuji, transport: http(rpc) });
  return { dep, pub, wallet, aida: new AidaClient(pub as never, dep, wallet as never), me: BigInt(dep.agents.buyer.agentId) };
}

export async function runBuyer(opts: { rounds: number; report: boolean; emit: (e: BuyerEvent) => void }) {
  const { dep, pub, wallet, aida, me } = loadBuyer();
  const { emit } = opts;
  const policy: SpendPolicy = {
    maxWei: parseEther(process.env.BUYER_MAX_PRICE ?? "0.002"),
    budgetWei: parseEther(process.env.BUYER_BUDGET ?? "0.01"),
    chainId: 43113,
  };
  const hosts = (process.env.BUYER_ALLOWED_HOSTS ?? "127.0.0.1,localhost").split(",").map((h) => h.trim());
  let spent = 0n;
  const payTo = (seller: AgentView) => async (req: PaymentRequirement): Promise<Hex> => {
    const c = checkPayment(req, seller, policy, spent);
    if (!c.ok) throw new Error(`refused to pay: ${c.reason}`);
    const hash = await wallet.sendTransaction({ to: req.payTo, value: BigInt(req.maxAmountRequired), data: nonceToData(req.nonce) });
    await pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
    spent += BigInt(req.maxAmountRequired);
    return hash;
  };

  emit({ level: "head", text: `Treasury Bot (agent #${me}) needs an AVAX/USD price — ${opts.rounds} round${opts.rounds === 1 ? "" : "s"} on Avalanche Fuji` });
  emit({ level: "info", text: `wallet ${wallet.account.address} · ${formatEther(await pub.getBalance({ address: wallet.account.address }))} AVAX` });
  const tried = new Set<bigint>();

  for (let round = 1; round <= opts.rounds; round++) {
    const all = await aida.list();
    const sellers = all.filter((a) => a.agentId !== me && a.card?.endpoints.some((e) => e.endpoint.endsWith("/quote")));
    emit({ level: "head", text: `Round ${round} · AIDA lists ${sellers.length} AVAX/USD sellers: ${sellers.map((s) => `${s.card?.name} [${trust(s)}]`).join(", ")}` });
    const { pick, why, skipped } = chooseSeller(sellers, tried, round);
    for (const s of skipped) emit({ level: "err", text: `✗ skip ${s.card?.name}: AIDA trust ${s.average} < ${MIN_TRUST}` });
    if (!pick) break;
    tried.add(pick.agentId);
    const endpoint = pick.card!.endpoints.find((e) => e.endpoint.endsWith("/quote"))!.endpoint;
    if (!endpointAllowed(endpoint, hosts)) {
      emit({ level: "err", text: `✗ ${pick.card?.name}: endpoint host not in BUYER_ALLOWED_HOSTS` });
      continue;
    }
    emit({ level: "info", text: `→ hire ${pick.card?.name} (#${pick.agentId}): ${why}` });
    try {
      const r = await callPaidAgent(endpoint, me, payTo(pick), safeFetch);
      const paid = r.steps.find((s) => s.kind === "paid");
      if (paid && paid.kind === "paid") emit({ level: "warn", text: `402 Payment Required → paid ${formatEther(BigInt(paid.requirement.maxAmountRequired))} AVAX`, tx: paid.txHash });
      if (!r.ok) {
        emit({ level: "err", text: `✗ ${brief(r.body)}` });
        continue;
      }
      const quote = Number((r.body as { price: number }).price);
      const ref = await chainlinkPrice(pub as never);
      const score = accuracyScore(quote, ref.price);
      const dev = (((quote - ref.price) / ref.price) * 100).toFixed(2);
      emit({ level: score >= 60 ? "ok" : "err", text: `200 · quote ${quote} vs Chainlink ${ref.price.toFixed(4)} (${dev}%) → score ${score}` });
      const fb = await aida.giveFeedback(pick.agentId, score, "price-accuracy");
      emit({ level: "info", text: `rated ${pick.card?.name} ${score}/100 on-chain`, tx: fb });
    } catch (e) {
      emit({ level: "err", text: `round failed: ${(e as Error).message.split("\n")[0]}` });
    }
  }

  if (opts.report && dep.oracleAgentId) {
    const sellers = (await aida.list()).filter((a) => a.card?.endpoints.some((e) => e.endpoint.endsWith("/quote")));
    const best = [...sellers].sort((x, y) => Number(y.average - x.average))[0];
    const oracle = (await aida.resolve(BigInt(dep.oracleAgentId)))!;
    const self = (await aida.resolve(me))!;
    emit({ level: "head", text: `Due diligence · Trust Oracle report on ${best.card?.name} (my trust ${trust(self)}; Oracle requires ≥ 60)` });
    try {
      const oUrl = `${oracle.card!.endpoints[0].endpoint}/${best.agentId}`;
      if (!endpointAllowed(oUrl, hosts)) throw new Error("oracle endpoint host not in BUYER_ALLOWED_HOSTS");
      const r = await callPaidAgent(oUrl, me, payTo(oracle), safeFetch);
      const codes = r.steps.flatMap((s) => (s.kind === "request" ? [s.status] : []));
      const paid = r.steps.find((s) => s.kind === "paid");
      if (r.ok) emit({ level: "ok", text: `${codes.join(" → ")} · verdict ${(r.body as { report: { verdict: string } }).report.verdict.toUpperCase()}`, tx: paid?.kind === "paid" ? paid.txHash : undefined });
      else emit({ level: "err", text: `${codes.join(" → ")} ${brief(r.body)}` });
    } catch (e) {
      emit({ level: "err", text: `oracle failed: ${(e as Error).message.split("\n")[0]}` });
    }
  }
  emit({ level: "info", text: `done · balance ${formatEther(await pub.getBalance({ address: wallet.account.address }))} AVAX` });
}
