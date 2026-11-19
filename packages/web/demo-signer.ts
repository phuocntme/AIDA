// Checks for the demo signer (see vite.config.ts). Pure functions so they can be tested without a server.
// The signer holds an OPERATOR key, whose only power in AgentPolicy is setPaused. Even so, every request must:
//   1. carry the per-start random token that only the page served by this dev server knows,
//   2. come from the dev server's own origin (a missing Origin is refused),
//   3. be a JSON POST (a cross-site page would need a CORS preflight, which is never granted),
//   4. be exactly setPaused(<the demo agent>, bool) on the AgentPolicy contract.
import { timingSafeEqual } from "node:crypto";
import { decodeFunctionData, type Hex } from "viem";
import { agentPolicyAbi } from "@aida/sdk";

export type SignerConfig = { token: string; origins: string[]; policy: string; agentId: bigint };
export type SignerRequest = { method?: string; headers: Record<string, string | string[] | undefined>; body: string };
export type SignerDecision = { ok: true; action: "address" } | { ok: true; action: "send"; to: Hex; data: Hex } | { ok: false; status: number; error: string };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function checkSignerRequest(req: SignerRequest, cfg: SignerConfig): SignerDecision {
  const deny = (status: number, error: string): SignerDecision => ({ ok: false, status, error });
  if (req.method !== "POST") return deny(405, "POST only");
  const origin = one(req.headers.origin);
  if (!origin || !cfg.origins.includes(origin)) return deny(403, "origin not allowed");
  const site = one(req.headers["sec-fetch-site"]);
  if (site && site !== "same-origin") return deny(403, "cross-site request");
  if (!one(req.headers["content-type"]).toLowerCase().startsWith("application/json")) return deny(415, "content-type must be application/json");
  if (!cfg.token || !same(one(req.headers["x-aida-signer-token"]), cfg.token)) return deny(401, "missing or wrong token");
  let msg: { action?: unknown; to?: unknown; data?: unknown };
  try {
    msg = JSON.parse(req.body);
  } catch {
    return deny(400, "body is not JSON");
  }
  if (msg.action === "address") return { ok: true, action: "address" };
  if (msg.action !== "send") return deny(400, "unknown action");
  if (typeof msg.to !== "string" || msg.to.toLowerCase() !== cfg.policy.toLowerCase()) return deny(403, "only calls to AgentPolicy are signed");
  if (typeof msg.data !== "string" || !/^0x[0-9a-fA-F]+$/.test(msg.data)) return deny(400, "data must be hex");
  try {
    const call = decodeFunctionData({ abi: agentPolicyAbi, data: msg.data as Hex });
    if (call.functionName !== "setPaused") return deny(403, `the demo signer only signs setPaused, not ${call.functionName}`);
    if (call.args[0] !== cfg.agentId) return deny(403, "the demo signer only pauses the demo agent");
  } catch {
    return deny(403, "calldata is not an AgentPolicy call");
  }
  return { ok: true, action: "send", to: msg.to as Hex, data: msg.data as Hex };
}
