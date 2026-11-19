// Generic x402-style paid route for AIDA agents (native AVAX, verified on-chain, no facilitator):
// caller authentication (X-Agent-Auth, signed by the agent's wallet) → identity check → reputation gate → 402 challenge → on-chain payment check → serve.
import { randomBytes } from "node:crypto";
import {
  CALL_AUTH_MAX_SKEW_S,
  buildRequirements,
  callAuthDigest,
  callAuthSigner,
  decodeCallAuth,
  nonceToData,
  decodePayment,
  gateByReputation,
  verifyPayment,
  verifyPolicyPayment,
  utf8ToBase64,
  type AgentView,
  type Check,
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
  /**
   * AgentPolicy address + lookup. A caller that runs behind a policy must pay through AgentPolicy.pay;
   * a direct transfer that bypasses its caps, whitelist or kill switch is rejected.
   */
  policy?: {
    address: Hex;
    covers(agentId: bigint): Promise<boolean>;
    /** Who stands behind the agent's policy, for the newcomer admission rule (see RouteSpec.admitGuarded). */
    info?(agentId: bigint): Promise<{ guardian: Hex; agent: Hex; balance: bigint } | null>;
  };
  /**
   * Caller authentication. `audience` is this seller's own origin (e.g. http://127.0.0.1:8791): a caller must send
   * X-Agent-Auth, a fresh signature by the wallet that owns its agent identity, before anything is done in that
   * agent's name. `false` switches it off (unit tests of the other checks only).
   */
  callerAuth: false | { audience: string; maxFailuresPerMinute?: number };
  /** Open-challenge limits (defaults: 5000 in total, 8 per caller id) and a clock, both overridable in tests. */
  limits?: { maxOpen?: number; maxPerCaller?: number };
  now?: () => number;
};

export type RouteSpec = {
  /** Path pattern, e.g. /^\/quote$/ ; capture groups are passed to precheck/produce. */
  route: RegExp;
  usage: string;
  description: string;
  /** null = any registered agent may buy (cold-start friendly); a number = minimum average trust. */
  minScore: number | null;
  /**
   * With minScore: a caller that has no reviews yet is admitted only if ALL of these hold:
   *   - it has an AgentPolicy whose guardian is one of `guardians` (guardians this seller knows and trusts),
   *   - that guardian is neither the agent's own wallet nor the identity's owner (no self-guarding),
   *   - the policy holds at least the price of this request.
   * Having a policy is not enough: anyone can create one for a fresh agent with themselves as guardian.
   * A caller that already has reviews is always judged by them, policy or not.
   */
  admitGuarded?: { guardians: Hex[] };
  /** Reject a request before charging for it (e.g. unknown target). */
  precheck?: (m: RegExpExecArray) => Promise<PaidResponse | null>;
  /** `ref` is keccak256(nonce): the on-chain id of the payment that bought this response (a seller signs it into its quote). */
  produce: (m: RegExpExecArray, caller: AgentView, paid: { ref: Hex; txHash: Hex }) => Promise<Record<string, unknown>>;
  /** Called after a verified payment was served (e.g. the seller rates the buyer). Errors are logged, never thrown. */
  onPaid?: (caller: AgentView, txHash: Hex) => Promise<void>;
};

const NONCE_TTL_MS = 10 * 60 * 1000;
const MAX_OPEN_NONCES = 5000;
const MAX_OPEN_PER_CALLER = 8;
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** The newcomer admission rule (pure, unit-tested). */
export function guardedNewcomerOk(caller: AgentView, info: { guardian: Hex; agent: Hex; balance: bigint } | null, trustedGuardians: Hex[], priceWei: bigint): Check {
  if (caller.count !== 0n) return { ok: false, reason: "caller has reviews: judged by them" };
  if (!info) return { ok: false, reason: "no AgentPolicy" };
  if (same(info.guardian, info.agent) || same(info.guardian, caller.owner)) return { ok: false, reason: "policy is self-guarded" };
  if (!trustedGuardians.some((g) => same(g, info.guardian))) return { ok: false, reason: "policy guardian is not known to this seller" };
  if (info.balance < priceWei) return { ok: false, reason: "policy is not funded" };
  return { ok: true };
}

export function createPaidRoute(d: PaidDeps, spec: RouteSpec) {
  const nonces = new Map<string, { req: PaymentRequirement; callerId: bigint; expires: number }>();
  const usedTx = new Set<string>();

  const now = d.now ?? Date.now;
  const maxOpen = d.limits?.maxOpen ?? MAX_OPEN_NONCES;
  const maxPerCaller = d.limits?.maxPerCaller ?? MAX_OPEN_PER_CALLER;

  /**
   * Challenges live in memory only. After a restart no old nonce is known, so an old payment cannot be replayed;
   * a payment made just before a restart has to be made again.
   * A live challenge is never evicted, because its caller may already have paid for it. Only expired ones are
   * dropped; when the map is still full, or the agent already has too many open challenges, new requests are
   * refused until some expire. The per-agent quota is safe to key on the agent id because a challenge is only
   * issued after authenticate() below: a request that is not signed by the agent's wallet never reaches this.
   */
  function challenge(resource: string, callerId: bigint, error?: string): PaidResponse {
    const t = now();
    for (const [k, v] of nonces) if (v.expires < t) nonces.delete(k);
    let mine = 0;
    for (const v of nonces.values()) if (v.callerId === callerId) mine++;
    if (mine >= maxPerCaller) return { status: 429, body: { error: "too many open payment challenges for this caller; pay one or wait for them to expire" }, headers: { "Retry-After": "60" } };
    if (nonces.size >= maxOpen) return { status: 503, body: { error: "too many open payment challenges; retry later" }, headers: { "Retry-After": "60" } };
    const nonce = randomBytes(12).toString("hex");
    const req = buildRequirements({ payTo: d.payTo, price: d.priceWei, chainId: d.chainId, network: d.network, resource, nonce, description: spec.description });
    nonces.set(nonce, { req, callerId, expires: t + NONCE_TTL_MS });
    return { status: 402, body: { x402Version: 1, accepts: [req], ...(error ? { error } : {}) } };
  }

  // Requests that fail authentication are counted per client address, never per claimed agent id.
  const failures = new Map<string, { start: number; n: number }>();
  const seenAuth = new Map<string, number>();
  const maxFailures = d.callerAuth ? (d.callerAuth.maxFailuresPerMinute ?? 60) : 0;
  const overBudget = (client: string) => {
    const f = failures.get(client);
    return Boolean(f && now() - f.start <= 60_000 && f.n >= maxFailures);
  };
  function unauthenticated(client: string, reason: string): PaidResponse {
    const t = now();
    if (failures.size > 10_000) for (const [k, v] of failures) if (t - v.start > 60_000) failures.delete(k);
    const f = failures.get(client);
    if (!f || t - f.start > 60_000) failures.set(client, { start: t, n: 1 });
    else f.n++;
    return { status: 401, body: { error: "caller not authenticated", reason, how: "send X-Agent-Auth: base64 JSON { ts, nonce, sig } signed by the wallet that owns your agent identity (see packages/sdk/src/x402.ts)" } };
  }

  /**
   * Proves the request comes from the wallet that owns `callerId` in the identity registry. Cheap checks first
   * (header shape, timestamp); the chain is only read for a well-formed, fresh header.
   */
  async function authenticate(path: string, headers: Record<string, string | undefined>, callerId: bigint, client: string): Promise<{ caller: AgentView } | PaidResponse> {
    if (!d.callerAuth) {
      const caller = await d.registry.resolve(callerId);
      return caller ? { caller } : { status: 404, body: { error: `caller agent #${callerId} is not registered in AIDA` } };
    }
    if (overBudget(client)) return { status: 429, body: { error: "too many unauthenticated requests from this address" }, headers: { "Retry-After": "60" } };
    const decoded = decodeCallAuth(headers["x-agent-auth"], Math.floor(now() / 1000));
    if (!decoded.ok) return unauthenticated(client, decoded.reason);
    const scope = { chainId: d.chainId, agentId: callerId, audience: d.callerAuth.audience, path };
    const signer = await callAuthSigner(scope, decoded.auth);
    if (!signer) return unauthenticated(client, "signature is malformed");
    const caller = await d.registry.resolve(callerId);
    if (!caller) return unauthenticated(client, `agent #${callerId} is not registered in AIDA`);
    if (signer.toLowerCase() !== caller.owner.toLowerCase()) return unauthenticated(client, "not signed by the wallet that owns this agent (or signed for another seller, path or chain)");
    const t = now();
    for (const [k, exp] of seenAuth) if (exp < t) seenAuth.delete(k);
    // Replay cache is keyed on the signed digest, not the signature bytes: an ECDSA signature has a second valid
    // encoding (high-s, other v, hex case), so the same authorisation could otherwise be presented twice.
    const used = callAuthDigest(scope, decoded.auth.ts, decoded.auth.nonce);
    if (seenAuth.has(used)) return unauthenticated(client, "this signature was already used");
    seenAuth.set(used, t + 2 * CALL_AUTH_MAX_SKEW_S * 1000);
    return { caller };
  }

  async function handle(path: string, headers: Record<string, string | undefined>, client = "unknown"): Promise<PaidResponse> {
    const m = spec.route.exec(path);
    if (!m) return { status: 404, body: { error: `not found; use ${spec.usage}` } };

    const rawCaller = headers["x-agent-id"];
    if (!rawCaller || !/^\d+$/.test(rawCaller)) return { status: 400, body: { error: "X-Agent-Id header (your AIDA agent id) is required" } };
    const callerId = BigInt(rawCaller);
    const who = await authenticate(path, headers, callerId, client);
    if (!("caller" in who)) return who;
    const caller = who.caller;

    if (spec.minScore !== null) {
      const gate = gateByReputation(caller, spec.minScore);
      const guarded = !gate.ok && spec.admitGuarded && caller.count === 0n && d.policy?.info ? guardedNewcomerOk(caller, await d.policy.info(callerId), spec.admitGuarded.guardians, d.priceWei).ok : false;
      if (!gate.ok && !guarded) return { status: 403, body: { error: "caller reputation too low", reason: gate.reason, callerId: callerId.toString() } };
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
    if (!issued || issued.expires < now() || issued.req.resource !== path || issued.callerId !== callerId) {
      return challenge(path, callerId, "unknown or expired nonce for this resource");
    }
    // Reserve the nonce before awaiting; restore it on failure so a valid but not-yet-visible payment can be retried.
    nonces.delete(decoded.payment.nonce);
    const viaPolicy = d.policy ? await d.policy.covers(callerId) : false;
    const check = viaPolicy
      ? await verifyPolicyPayment(d.chain, decoded.payment, issued.req, d.policy!.address, callerId, usedTx)
      : await verifyPayment(d.chain, decoded.payment, issued.req, caller.owner, usedTx);
    if (!check.ok) {
      nonces.set(decoded.payment.nonce, issued);
      return { status: 402, body: { x402Version: 1, accepts: [issued.req], error: check.reason } };
    }

    const body = await spec.produce(m, caller, { ref: nonceToData(issued.req.nonce), txHash: decoded.payment.txHash });
    if (spec.onPaid) spec.onPaid(caller, decoded.payment.txHash).catch((e) => console.error("onPaid failed:", (e as Error).message.split("\n")[0]));
    const receipt = { success: true, txHash: decoded.payment.txHash, network: d.network };
    return { status: 200, body, headers: { "X-PAYMENT-RESPONSE": utf8ToBase64(JSON.stringify(receipt)) } };
  }

  return { handle };
}

export const toJson = (v: unknown) => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));
