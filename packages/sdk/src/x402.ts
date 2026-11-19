// x402-style payment flow with native-token payments verified on-chain (no facilitator).
// HTTP shape follows x402: 402 + { x402Version, accepts: [requirement] }, retry with X-PAYMENT.
import { encodeAbiParameters, keccak256, parseEventLogs, recoverMessageAddress, stringToBytes } from "viem";
import { agentPolicyAbi } from "./abi.ts";
import { base64ToUtf8, utf8ToBase64 } from "./card.ts";

export type Hex = `0x${string}`;

export type PaymentRequirement = {
  scheme: "exact";
  network: string;
  chainId: number;
  asset: "native";
  maxAmountRequired: string; // wei, decimal string
  payTo: Hex;
  resource: string;
  nonce: string;
  description?: string;
};

export type PaymentPayload = { txHash: Hex; nonce: string };
export type Check = { ok: true } | { ok: false; reason: string };

export function buildRequirements(p: {
  payTo: Hex | string;
  price: bigint;
  chainId: number;
  network: string;
  resource: string;
  nonce: string;
  description?: string;
}): PaymentRequirement {
  return {
    scheme: "exact",
    network: p.network,
    chainId: p.chainId,
    asset: "native",
    maxAmountRequired: p.price.toString(),
    payTo: p.payTo as Hex,
    resource: p.resource,
    nonce: p.nonce,
    description: p.description,
  };
}

export function encodePayment(p: PaymentPayload): string {
  return utf8ToBase64(JSON.stringify(p));
}

export function decodePayment(header: string): { ok: true; payment: PaymentPayload } | { ok: false; reason: string } {
  try {
    const p = JSON.parse(base64ToUtf8(header)) as Record<string, unknown>;
    if (typeof p.txHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(p.txHash)) return { ok: false, reason: "X-PAYMENT txHash must be a 32-byte hex hash" };
    if (typeof p.nonce !== "string" || !p.nonce) return { ok: false, reason: "X-PAYMENT nonce missing" };
    return { ok: true, payment: { txHash: p.txHash as Hex, nonce: p.nonce } };
  } catch {
    return { ok: false, reason: "X-PAYMENT header is not base64 JSON" };
  }
}

export function gateByReputation(summary: { count: bigint; average: bigint }, minScore: number): Check {
  if (summary.count === 0n) return { ok: false, reason: "no reputation yet (0 feedback)" };
  if (summary.average < BigInt(minScore)) return { ok: false, reason: `reputation ${summary.average} < ${minScore}` };
  return { ok: true };
}

/** Minimal chain reader (a viem PublicClient satisfies this). */
export type ChainReader = {
  getTransaction(args: { hash: Hex }): Promise<{ to: string | null; value: bigint; from: string; input?: Hex }>;
  getTransactionReceipt(args: { hash: Hex }): Promise<{ status: string; logs?: readonly { address: string; data: Hex; topics: readonly Hex[] }[] }>;
};

/**
 * The payment tx must carry keccak256(nonce) as calldata: it binds the payment to exactly one 402 challenge
 * while keeping the nonce itself secret (revealed only over HTTP by the caller), so a mempool observer
 * cannot redeem someone else's payment.
 */
export function nonceToData(nonce: string): Hex {
  return keccak256(stringToBytes(nonce));
}

/**
 * Verifies a native payment on-chain. Never throws.
 * The tx hash is reserved before the first await (no concurrent double-spend) and released if verification fails.
 */
export async function verifyPayment(
  chain: ChainReader,
  payment: PaymentPayload,
  req: PaymentRequirement,
  expectedPayer: string,
  usedTx: Set<string>,
): Promise<Check> {
  const key = payment.txHash.toLowerCase();
  if (usedTx.has(key)) return { ok: false, reason: "payment tx already used" };
  if (payment.nonce !== req.nonce) return { ok: false, reason: "payment nonce does not match the 402 challenge" };
  usedTx.add(key);
  const fail = (reason: string): Check => {
    usedTx.delete(key);
    return { ok: false, reason };
  };
  try {
    const [tx, receipt] = await Promise.all([
      chain.getTransaction({ hash: payment.txHash }),
      chain.getTransactionReceipt({ hash: payment.txHash }),
    ]);
    if (receipt.status !== "success") return fail("payment tx failed on-chain");
    if (!tx.to || tx.to.toLowerCase() !== req.payTo.toLowerCase()) return fail("payment recipient is not payTo");
    if (tx.value < BigInt(req.maxAmountRequired)) return fail(`payment amount ${tx.value} < ${req.maxAmountRequired}`);
    if (tx.from.toLowerCase() !== expectedPayer.toLowerCase()) return fail("payer is not the calling agent's owner");
    if ((tx.input ?? "0x").toLowerCase() !== nonceToData(req.nonce)) return fail("payment calldata does not carry the challenge nonce commitment");
  } catch (e) {
    return fail(`could not read payment tx: ${(e as Error).message.split("\n")[0]}`);
  }
  return { ok: true };
}

/**
 * Verifies a payment made through AgentPolicy.pay (agents that run behind a policy must pay this way).
 * Checks the Paid event emitted by the policy contract: payer agent, recipient, amount and nonce commitment.
 */
export async function verifyPolicyPayment(
  chain: ChainReader,
  payment: PaymentPayload,
  req: PaymentRequirement,
  policy: Hex,
  callerId: bigint,
  usedTx: Set<string>,
): Promise<Check> {
  const key = payment.txHash.toLowerCase();
  if (usedTx.has(key)) return { ok: false, reason: "payment tx already used" };
  if (payment.nonce !== req.nonce) return { ok: false, reason: "payment nonce does not match the 402 challenge" };
  usedTx.add(key);
  const fail = (reason: string): Check => {
    usedTx.delete(key);
    return { ok: false, reason };
  };
  try {
    const receipt = await chain.getTransactionReceipt({ hash: payment.txHash });
    if (receipt.status !== "success") return fail("payment tx failed on-chain");
    const logs = (receipt.logs ?? []).filter((l) => l.address.toLowerCase() === policy.toLowerCase());
    const paid = parseEventLogs({ abi: agentPolicyAbi, logs: logs as never, eventName: "Paid" });
    const ref = nonceToData(req.nonce);
    const hit = paid.find(
      (e) => e.args.agentId === callerId && e.args.to.toLowerCase() === req.payTo.toLowerCase() && e.args.amount >= BigInt(req.maxAmountRequired) && e.args.ref.toLowerCase() === ref,
    );
    if (!hit) return fail("no matching AgentPolicy Paid event (agent, recipient, amount, nonce)");
  } catch (e) {
    return fail(`could not read payment tx: ${(e as Error).message.split("\n")[0]}`);
  }
  return { ok: true };
}

// ---------- caller authentication ----------
// A seller only issues a 402 challenge to a caller that proves it holds the agent's wallet. The caller signs
// (personal_sign) a digest over: this scheme's tag, the chain, its agent id, the seller's origin ("audience"),
// the path, a timestamp and a random nonce. Header: X-Agent-Auth = base64 JSON { ts, nonce, sig }.
// Without this, X-Agent-Id could be spoofed to use up another agent's open-challenge quota.

export type CallAuth = { ts: number; nonce: string; sig: Hex };
export type CallAuthScope = { chainId: number; agentId: bigint; audience: string; path: string };
export const CALL_AUTH_MAX_SKEW_S = 120;

export function callAuthDigest(scope: CallAuthScope, ts: number, nonce: string): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "string" }, { type: "uint256" }, { type: "uint256" }, { type: "string" }, { type: "string" }, { type: "uint64" }, { type: "string" }],
      ["aida-call-v1", BigInt(scope.chainId), scope.agentId, scope.audience.toLowerCase(), scope.path, BigInt(ts), nonce],
    ),
  );
}

export const encodeCallAuth = (a: CallAuth) => utf8ToBase64(JSON.stringify(a));

/** Shape and freshness only (cheap, no chain read). */
export function decodeCallAuth(header: string | undefined, nowS: number, maxSkewS = CALL_AUTH_MAX_SKEW_S): { ok: true; auth: CallAuth } | { ok: false; reason: string } {
  if (!header) return { ok: false, reason: "X-Agent-Auth header missing" };
  try {
    const a = JSON.parse(base64ToUtf8(header)) as Record<string, unknown>;
    if (!Number.isInteger(a.ts) || typeof a.nonce !== "string" || !/^[0-9a-f]{16,64}$/.test(a.nonce) || typeof a.sig !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(a.sig)) {
      return { ok: false, reason: "X-Agent-Auth must be base64 JSON { ts, nonce, sig }" };
    }
    if (Math.abs(nowS - (a.ts as number)) > maxSkewS) return { ok: false, reason: "X-Agent-Auth timestamp is too old or in the future" };
    return { ok: true, auth: { ts: a.ts as number, nonce: a.nonce, sig: a.sig as Hex } };
  } catch {
    return { ok: false, reason: "X-Agent-Auth header is not base64 JSON" };
  }
}

/** Who signed this call for this scope. Null if the signature is malformed. */
export async function callAuthSigner(scope: CallAuthScope, auth: CallAuth): Promise<Hex | null> {
  try {
    return await recoverMessageAddress({ message: { raw: callAuthDigest(scope, auth.ts, auth.nonce) }, signature: auth.sig });
  } catch {
    return null;
  }
}

export type PaidCallStep =
  | { kind: "request"; status: number; body: unknown }
  | { kind: "paid"; txHash: Hex; requirement: PaymentRequirement };

/**
 * Client side of the flow: GET -> (402) -> pay(requirement) -> retry with X-PAYMENT.
 * Returns every step so a UI can show the protocol. Never retries more than once.
 * With `signCall`, every request carries X-Agent-Auth, which sellers require before they issue a challenge.
 */
export async function callPaidAgent(
  url: string,
  agentId: bigint,
  pay: (req: PaymentRequirement) => Promise<Hex>,
  fetchImpl: typeof fetch = fetch,
  /** Returns the X-Agent-Auth header for one request (a fresh signature each time). */
  signCall?: (to: { audience: string; path: string }) => Promise<string>,
): Promise<{ ok: boolean; steps: PaidCallStep[]; body: unknown }> {
  const steps: PaidCallStep[] = [];
  const target = new URL(url);
  const get = async (extra: Record<string, string> = {}) => {
    const auth: Record<string, string> = signCall ? { "X-Agent-Auth": await signCall({ audience: target.origin, path: target.pathname }) } : {};
    const res = await fetchImpl(url, { headers: { "X-Agent-Id": agentId.toString(), ...auth, ...extra } });
    const body = await res.json().catch(() => ({ error: `non-JSON response (HTTP ${res.status})` }));
    steps.push({ kind: "request", status: res.status, body });
    return { status: res.status, body: body as Record<string, unknown> };
  };
  let r = await get();
  if (r.status === 402) {
    const accepts = r.body.accepts as PaymentRequirement[] | undefined;
    const requirement = accepts?.[0];
    if (!requirement || requirement.asset !== "native") return { ok: false, steps, body: { error: "unsupported payment requirement" } };
    const txHash = await pay(requirement);
    steps.push({ kind: "paid", txHash, requirement });
    r = await get({ "X-PAYMENT": encodePayment({ txHash, nonce: requirement.nonce }) });
  }
  return { ok: r.status === 200, steps, body: r.body };
}
