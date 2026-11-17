// x402-style payment flow with native-token payments verified on-chain (no facilitator).
// HTTP shape follows x402: 402 + { x402Version, accepts: [requirement] }, retry with X-PAYMENT.
import { keccak256, stringToBytes } from "viem";
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
  getTransactionReceipt(args: { hash: Hex }): Promise<{ status: string }>;
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

export type PaidCallStep =
  | { kind: "request"; status: number; body: unknown }
  | { kind: "paid"; txHash: Hex; requirement: PaymentRequirement };

/**
 * Client side of the flow: GET -> (402) -> pay(requirement) -> retry with X-PAYMENT.
 * Returns every step so a UI can show the protocol. Never retries more than once.
 */
export async function callPaidAgent(
  url: string,
  agentId: bigint,
  pay: (req: PaymentRequirement) => Promise<Hex>,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; steps: PaidCallStep[]; body: unknown }> {
  const steps: PaidCallStep[] = [];
  const get = async (extra: Record<string, string> = {}) => {
    const res = await fetchImpl(url, { headers: { "X-Agent-Id": agentId.toString(), ...extra } });
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
