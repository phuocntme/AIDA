// Runs the AIDA agent network (one process, one port per agent) against Fuji (default) or a local Hardhat node:
//   :8790 AIDA Trust Oracle  sells trust reports; serves callers with trust ≥ 60, or newcomers whose funded policy has a guardian it knows
//   :8791 AVAX Price Pro     sells a signed AVAX/USD quote, live median of Binance + CoinGecko; asks Audit Lab to validate
//   :8792 FastQuote          sells a signed AVAX/USD quote that is 4-9% off on purpose (demo toggle)
//   :8793 AIDA Audit Lab     validator: answers validation requests by comparing quotes with Chainlink
//   :8794 Treasury Bot       control endpoint for the web app: POST /run, POST /attack, GET /log
// This process holds the five agent keys. It never reads the guardian key.
import { createServer } from "node:http";
import { parseEther } from "viem";
import { toFeedUnits, type Hex } from "@aida/sdk";
import { loadNetwork } from "./config.ts";
import { createOracle } from "./oracle.ts";
import { createPaidRoute, type PaidResponse } from "./paid.ts";
import { accuracyScore, feedIsFresh, formatQuoteJob, marketPrice, parseQuoteJob, sloppyQuoter } from "./price.ts";
import { runAttack, runBuyer, type BuyerEvent } from "./buyer.ts";

const net = loadNetwork();
const { dep, pub, reader, chainId } = net;
const A = dep.agents;
const price = BigInt(process.env.QUOTE_PRICE_WEI ?? parseEther("0.0005").toString());
const reportPrice = BigInt(process.env.REPORT_PRICE_WEI ?? parseEther("0.001").toString());
const ts = () => new Date().toISOString().slice(11, 19);
const log = (who: string, msg: string) => console.log(`${ts()} ${who.padEnd(18)} ${msg}`);
const oneLine = (e: unknown) => (e as Error).message.split("\n")[0];

const policy = {
  address: dep.policy,
  covers: async (id: bigint) => (await reader.policy(id)) !== null,
  info: async (id: bigint) => reader.policy(id),
};
// Guardians the Trust Oracle knows. A newcomer without reviews is served only if one of them stands behind its
// policy (and is not the agent itself) and the policy is funded. Default: the guardian of this deployment.
const TRUSTED_GUARDIANS = (process.env.ORACLE_TRUSTED_GUARDIANS ?? dep.guardian ?? "").split(",").filter(Boolean) as Hex[];
const base = { registry: reader, chain: pub as never, chainId, network: net.network, policy };
/** A seller's own origin: callers sign their requests for exactly this audience. */
const audienceOf = (id: keyof typeof A) => ({ audience: new URL(A[id].endpoint).origin });
const oracleW = net.agent("ORACLE");
const proW = net.agent("PRICEPRO");
const fastW = net.agent("FASTQUOTE");
const auditW = net.agent("AUDIT");

/** The quote a seller returns: price plus its signature over (PaidReviews, chain, agent, price, time, payment ref). */
async function signedQuote(w: typeof proW, agentId: string, usd: number, sources: string[], ref: Hex) {
  const at = Math.floor(Date.now() / 1000);
  const s = await w.client.signQuote({ agentId: BigInt(agentId), quote: toFeedUnits(usd), quotedAt: at, ref });
  return { pair: "AVAX/USD", price: Number(s.quote) / 1e8, at, sources, ref, signature: s.signature };
}

// --- AIDA Trust Oracle ---
const oracle = createOracle({ ...base, callerAuth: audienceOf("oracle"), payTo: oracleW.account.address, priceWei: reportPrice, minScore: 60, admitGuarded: { guardians: TRUSTED_GUARDIANS } });

// --- AVAX Price Pro (accurate, fresh) ---
let proJobs = 0;
let lastGood: { price: number; sources: string[] } | null = null;
/** Live median; if every public source is down, the last good price, else the on-chain feed. Never throws. */
async function livePrice(): Promise<{ price: number; sources: string[] }> {
  try {
    lastGood = await marketPrice();
    return lastGood;
  } catch {
    if (lastGood) return { price: lastGood.price, sources: ["cache"] };
    return { price: (await reader.feedPrice()).price, sources: ["chainlink"] };
  }
}
const pro = createPaidRoute(
  { ...base, callerAuth: audienceOf("pricepro"), payTo: proW.account.address, priceWei: price },
  {
    route: /^\/quote$/,
    usage: "GET /quote",
    description: "Signed AVAX/USD quote (live median of Binance + CoinGecko)",
    minScore: null,
    produce: async (_m, _caller, paid) => {
      const m = await livePrice();
      const q = await signedQuote(proW, A.pricepro.agentId, m.price, m.sources, paid.ref);
      proJobs++;
      if (proJobs % 2 === 1) {
        proW
          .serial(() => proW.client.requestValidation(BigInt(A.pricepro.agentId), auditW.account.address, formatQuoteJob(q.price, q.at)))
          .then((r) => log("PricePro", `asked Audit Lab to validate quote ${q.price} (request #${r.requestId})`))
          .catch((e) => log("PricePro", `validation request failed: ${oneLine(e)}`));
      }
      log("PricePro", `served ${q.price} (${m.sources.join("+")})`);
      return q;
    },
  },
);

// --- FastQuote (sloppy on purpose) ---
let fastQuote: () => number = () => Number.NaN;
const fast = createPaidRoute(
  { ...base, callerAuth: audienceOf("fastquote"), payTo: fastW.account.address, priceWei: price },
  {
    route: /^\/quote$/,
    usage: "GET /quote",
    description: "Signed AVAX/USD quote (cached)",
    minScore: null,
    produce: async (_m, _caller, paid) => {
      const q = await signedQuote(fastW, A.fastquote.agentId, fastQuote(), ["cache"], paid.ref);
      log("FastQuote", `served ${q.price} (stale cache)`);
      return q;
    },
  },
);

// --- AIDA Audit Lab: validator loop ---
const answered = new Set<string>();
// Only the known price sellers may ask for validation, and at most AUDIT_PER_MIN answers per minute (gas griefing guard).
const AUDIT_FOR = new Set([A.pricepro.agentId, A.fastquote.agentId]);
const AUDIT_PER_MIN = Number(process.env.AUDIT_PER_MIN ?? 6);
let auditWindow = { start: Date.now(), n: 0 };
async function auditTick() {
  for (const agentId of AUDIT_FOR) {
    const vs = await reader.validations(BigInt(agentId));
    for (const v of vs) {
      const id = v.requestId.toString();
      if (v.responded || answered.has(id) || v.validator.toLowerCase() !== auditW.account.address.toLowerCase()) continue;
      if (Date.now() - auditWindow.start > 60_000) auditWindow = { start: Date.now(), n: 0 };
      if (auditWindow.n >= AUDIT_PER_MIN) return;
      const ref = await reader.feedPrice();
      if (!feedIsFresh(ref.updatedAt)) return log("AuditLab", "Chainlink answer is stale: not answering now");
      auditWindow.n++;
      answered.add(id);
      const job = parseQuoteJob(v.requestURI);
      const score = job ? accuracyScore(job.price, ref.price) : 0;
      try {
        await auditW.serial(() => auditW.client.respondValidation(v.requestId, score, `chainlink://AVAX-USD/${ref.price}/${ref.updatedAt}`));
        log("AuditLab", `validation #${id}: quote ${job?.price ?? "?"} vs Chainlink ${ref.price.toFixed(4)} → ${score}`);
      } catch (e) {
        answered.delete(id);
        log("AuditLab", `respond #${id} failed: ${oneLine(e)}`);
      }
    }
  }
}

// --- HTTP ---
const WEB_ORIGINS = (process.env.WEB_ORIGINS ?? "http://127.0.0.1:5181,http://localhost:5181,http://127.0.0.1:5180,http://localhost:5180").split(",");
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "X-Agent-Id, X-Agent-Auth, X-PAYMENT, Content-Type", "Access-Control-Expose-Headers": "X-PAYMENT-RESPONSE" };
function serve(port: number, name: string, info: Record<string, unknown>, handle?: (path: string, h: Record<string, string>, url?: URL, method?: string, client?: string) => Promise<PaidResponse>, control = false) {
  createServer(async (req, res) => {
    // Control endpoints (Treasury Bot) only answer the AIDA web app's origin; paid agents stay open to any caller.
    const reqOrigin = String(req.headers.origin ?? "");
    const headers = control ? { ...cors, "Access-Control-Allow-Origin": WEB_ORIGINS.includes(reqOrigin) ? reqOrigin : WEB_ORIGINS[0], Vary: "Origin" } : cors;
    if (req.method === "OPTIONS") return void res.writeHead(204, headers).end();
    const url = new URL(req.url ?? "/", "http://x");
    const path = url.pathname;
    let out: PaidResponse;
    try {
      const postOk = control && req.method === "POST";
      if (req.method !== "GET" && !postOk) out = { status: 405, body: { error: "method not allowed" } };
      else if (path === "/" || path === "/status" || !handle) out = { status: 200, body: { agent: name, chainId, ...info } };
      else out = await handle(path, req.headers as Record<string, string>, url, req.method, req.socket.remoteAddress ?? "unknown");
    } catch (e) {
      out = { status: 500, body: { error: `internal error: ${oneLine(e)}` } };
    }
    if (path !== "/" && path !== "/status" && path !== "/log") log(name, `${req.method} ${path} caller=${req.headers["x-agent-id"] ?? "-"} → ${out.status}`);
    res.writeHead(out.status, { "Content-Type": "application/json", ...headers, ...(out.headers ?? {}) });
    res.end(JSON.stringify(out.body, null, 2));
  }).listen(port, "127.0.0.1");
}

/** Paid routes get the path, the headers and the client address (for the per-address limit on unauthenticated requests). */
const paid = (h: (path: string, headers: Record<string, string>, client?: string) => Promise<PaidResponse>) => (path: string, headers: Record<string, string>, _u?: URL, _m?: string, client?: string) => h(path, headers, client);
serve(A.oracle.port, "AIDA Trust Oracle", { agentId: A.oracle.agentId, payTo: oracleW.account.address, priceWei: reportPrice.toString(), minScore: 60 }, paid(oracle.handle));
serve(A.pricepro.port, "AVAX Price Pro", { agentId: A.pricepro.agentId, payTo: proW.account.address, priceWei: price.toString() }, paid(pro.handle));
serve(A.fastquote.port, "FastQuote", { agentId: A.fastquote.agentId, payTo: fastW.account.address, priceWei: price.toString() }, paid(fast.handle));
serve(A.audit.port, "AIDA Audit Lab", { agentId: A.audit.agentId, validator: auditW.account.address, reference: "Chainlink AVAX/USD" });

// --- Treasury Bot: started from the web app (POST /run, POST /attack), log streamed with GET /log?since=i ---
type Logged = BuyerEvent & { i: number; t: string; run: number; kind: "run" | "attack" };
const events: Logged[] = [];
let running: false | "run" | "attack" = false;
let runNo = 0;
function start(kind: "run" | "attack", job: (emit: (e: BuyerEvent) => void) => Promise<unknown>) {
  running = kind;
  const run = ++runNo;
  const emit = (e: BuyerEvent) => {
    events.push({ ...e, i: events.length, t: ts(), run, kind });
    log("Treasury", e.text);
  };
  job(emit)
    .catch((e) => emit({ level: "err", step: "refused", text: `${kind} failed: ${oneLine(e)}`, title: "Failed", note: oneLine(e).slice(0, 140) }))
    .finally(() => (running = false));
  return { status: 202, body: { started: true, kind, run, since: events.length } };
}
const buyerHandle = async (path: string, h: Record<string, string>, url?: URL, method = "GET"): Promise<PaidResponse> => {
  if (path === "/log") {
    const since = Number(url?.searchParams.get("since") ?? 0);
    return { status: 200, body: { running, runNo, events: events.filter((e) => e.i >= since) } };
  }
  if (path === "/run" || path === "/attack") {
    if (method !== "POST") return { status: 405, body: { error: `POST ${path}` } };
    if (!h["origin"] || !WEB_ORIGINS.includes(h["origin"])) return { status: 403, body: { error: "origin not allowed" } };
    if (running) return { status: 409, body: { error: "Treasury Bot is already busy" } };
    if (path === "/attack") return start("attack", (emit) => runAttack({ emit }));
    const rounds = Math.min(10, Math.max(1, Number(url?.searchParams.get("rounds") ?? 3)));
    return start("run", (emit) => runBuyer({ rounds, report: true, emit }));
  }
  return { status: 404, body: { error: "use POST /run?rounds=N, POST /attack or GET /log?since=i" } };
};
serve(A.buyer.port, "Treasury Bot", { agentId: A.buyer.agentId, role: "buyer", run: "POST /run?rounds=N", attack: "POST /attack", log: "GET /log?since=i" }, buyerHandle, true);

// FastQuote's stale base price is taken once at boot. Booting never depends on an outside price API being up.
fastQuote = sloppyQuoter((await livePrice()).price);
setInterval(() => auditTick().catch((e) => log("AuditLab", `tick failed: ${oneLine(e)}`)), 8000);
log("network", `AIDA agents live on ${net.chain.name}: oracle :${A.oracle.port}, pricepro :${A.pricepro.port}, fastquote :${A.fastquote.port}, audit :${A.audit.port}, bot :${A.buyer.port}`);
