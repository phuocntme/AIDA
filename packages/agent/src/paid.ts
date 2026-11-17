// Generic x402 paid route for AIDA agents: identity check → reputation gate → 402 challenge → on-chain payment check → serve.
import { randomBytes } from "node:crypto";
import {
  buildRequirements,
  decodePayment,
  gateByReputation,
  verifyPayment,
  utf8ToBase64,
  type AgentView,
  type ChainReader,
  type FeedbackView,
  type Hex,
  type PaymentRequirement,
} from "@aida/sdk";

export type PaidResponse = { status: number; body: Record<string, unknown>; headers?: Record<string, string> };

export type PaidDeps = {
  registry: { resolve(id: bigint): Promise<AgentView | null>; feedback(id: bigint): Promise<FeedbackView[]> };
  chain: ChainReader;
  payTo: Hex;
  priceWei: bigint;
  chainId: number;
  network: string;
};

export type RouteSpec = {
  /** Path pattern, e.g. /^\/quote$/ ; capture groups are passed to precheck/produce. */
  route: RegExp;
  usage: string;
  description: string;
  /** null = any registered agent may buy (cold-start friendly); a number = minimum average trust. */
  minScore: number | null;
  /** Reject a request before charging for it (e.g. unknown target). */
  precheck?: (m: RegExpExecArray) => Promise<PaidResponse | null>;
  produce: (m: RegExpExecArray, caller: AgentView) => Promise<Record<string, unknown>>;
  /** Called after a verified payment was served (e.g. the seller rates the buyer). Errors are logged, never thrown. */
  onPaid?: (caller: AgentView, txHash: Hex) => Promise<void>;
};

const NONCE_TTL_MS = 10 * 60 * 1000;

export function createPaidRoute(d: PaidDeps, spec: RouteSpec) {
  const nonces = new Map<string, { req: PaymentRequirement; callerId: bigint; expires: number }>();
  const usedTx = new Set<string>();

  function challenge(resource: string, callerId: bigint, error?: string): PaidResponse {
    const nonce = randomBytes(12).toString("hex");
    const req = buildRequirements({ payTo: d.payTo, price: d.priceWei, chainId: d.chainId, network: d.network, resource, nonce, description: spec.description });
    nonces.set(nonce, { req, callerId, expires: Date.now() + NONCE_TTL_MS });
    return { status: 402, body: { x402Version: 1, accepts: [req], ...(error ? { error } : {}) } };
  }

  async function handle(path: string, headers: Record<string, string | undefined>): Promise<PaidResponse> {
    const m = spec.route.exec(path);
    if (!m) return { status: 404, body: { error: `not found; use ${spec.usage}` } };

    const rawCaller = headers["x-agent-id"];
    if (!rawCaller || !/^\d+$/.test(rawCaller)) return { status: 400, body: { error: "X-Agent-Id header (your AIDA agent id) is required" } };
    const callerId = BigInt(rawCaller);
    const caller = await d.registry.resolve(callerId);
    if (!caller) return { status: 404, body: { error: `caller agent #${callerId} is not registered in AIDA` } };

    if (spec.minScore !== null) {
      const gate = gateByReputation(caller, spec.minScore);
      if (!gate.ok) return { status: 403, body: { error: "caller reputation too low", reason: gate.reason, callerId: callerId.toString() } };
    }

    if (spec.precheck) {
      const early = await spec.precheck(m);
      if (early) return early;
    }

    const header = headers["x-payment"];
    if (!header) return challenge(path, callerId);
    const decoded = decodePayment(header);
    if (!decoded.ok) return challenge(path, callerId, decoded.reason);
    const issued = nonces.get(decoded.payment.nonce);
    if (!issued || issued.expires < Date.now() || issued.req.resource !== path || issued.callerId !== callerId) {
      return challenge(path, callerId, "unknown or expired nonce for this resource");
    }
    // Reserve the nonce before awaiting; restore it on failure so a valid but not-yet-visible payment can be retried.
    nonces.delete(decoded.payment.nonce);
    const check = await verifyPayment(d.chain, decoded.payment, issued.req, caller.owner, usedTx);
    if (!check.ok) {
      nonces.set(decoded.payment.nonce, issued);
      return { status: 402, body: { x402Version: 1, accepts: [issued.req], error: check.reason } };
    }

    const body = await spec.produce(m, caller);
    if (spec.onPaid) spec.onPaid(caller, decoded.payment.txHash).catch((e) => console.error("onPaid failed:", (e as Error).message.split("\n")[0]));
    const receipt = { success: true, txHash: decoded.payment.txHash, network: d.network };
    return { status: 200, body, headers: { "X-PAYMENT-RESPONSE": utf8ToBase64(JSON.stringify(receipt)) } };
  }

  return { handle };
}

export const toJson = (v: unknown) => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));
