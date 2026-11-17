// Runs the real AIDA agent network against Avalanche Fuji (one process, one port per agent):
//   :8790 AIDA Trust Oracle  — x402 trust reports, callers need trust ≥ 60
//   :8791 AVAX Price Pro     — x402 AVAX/USD, live median of Binance + CoinGecko; asks Audit Lab to validate its quotes
//   :8792 FastQuote          — x402 AVAX/USD, deliberately sloppy (stale price, up to ±9% skew)
//   :8793 AIDA Audit Lab     — validator: answers validation requests by comparing quotes with Chainlink on Fuji
//   :8794 Treasury Bot       — status only (the buyer itself runs as `pnpm hire`)
// Sellers rate the buyer on-chain after every verified payment, so reputation flows both ways.
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createPublicClient, createWalletClient, http, parseEther, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { avalancheFuji } from "viem/chains";
import { AidaClient, type AgentView, type Deployment } from "@aida/sdk";
import { createOracle } from "./oracle.ts";
import { createPaidRoute, type PaidResponse } from "./paid.ts";
import { accuracyScore, chainlinkPrice, formatQuoteJob, marketPrice, parseQuoteJob, sloppyQuoter } from "./price.ts";
import { runBuyer, type BuyerEvent } from "./buyer.ts";

const root = new URL("../../../", import.meta.url);
const dep: Deployment = JSON.parse(readFileSync(new URL("deployments/43113.json", root), "utf8"));
const env = readFileSync(new URL(".env.fuji", root), "utf8");
if (!dep.agents) throw new Error("deployments/43113.json has no agents — run `pnpm -F @aida/contracts bootstrap:fuji` first");
const key = (n: string) => new RegExp(`^AGENT_KEY_${n}=(0x[0-9a-fA-F]{64})$`, "m").exec(env)?.[1] as Hex;
const rpc = process.env.FUJI_RPC_URL ?? "https://avalanche-fuji-c-chain-rpc.publicnode.com";
const pub = createPublicClient({ chain: avalancheFuji, transport: http(rpc, { retryCount: 4 }), pollingInterval: 1000 });
const price = BigInt(process.env.QUOTE_PRICE_WEI ?? parseEther("0.0005").toString());
const reportPrice = BigInt(process.env.REPORT_PRICE_WEI ?? parseEther("0.001").toString());
const ts = () => new Date().toISOString().slice(11, 19);
const log = (who: string, msg: string) => console.log(`${ts()} ${who.padEnd(18)} ${msg}`);

/** One wallet per agent; its transactions are queued so concurrent jobs never collide on nonces. */
function agentWallet(name: string) {
  const account = privateKeyToAccount(key(name));
  const wallet = createWalletClient({ account, chain: avalancheFuji, transport: http(rpc) });
  const client = new AidaClient(pub as never, dep, wallet as never);
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T,>(fn: () => Promise<T>) => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => undefined);
    return run;
  };
  return { account, client, serial };
}

const reader = new AidaClient(pub as never, dep);
const base = { registry: reader, chain: pub as never, chainId: 43113, network: "avalanche-fuji" };
const A = dep.agents;
const oracleW = agentWallet("ORACLE");
const proW = agentWallet("PRICEPRO");
const fastW = agentWallet("FASTQUOTE");
const auditW = agentWallet("AUDIT");

const rateBuyer = (who: string, w: ReturnType<typeof agentWallet>) => async (caller: AgentView) => {
  const tx = await w.serial(() => w.client.giveFeedback(caller.agentId, 100, "paid-on-time"));
  log(who, `rated buyer #${caller.agentId} 100 (paid-on-time) tx ${tx.slice(0, 10)}…`);
};

// --- AIDA Trust Oracle ---
const oracle = createOracle({ ...base, payTo: oracleW.account.address, priceWei: reportPrice, minScore: 60, onPaid: rateBuyer("Oracle", oracleW) });

// --- AVAX Price Pro (accurate) ---
let proJobs = 0;
const pro = createPaidRoute(
  { ...base, payTo: proW.account.address, priceWei: price },
  {
    route: /^\/quote$/,
    usage: "GET /quote",
    description: "AVAX/USD quote (live median of Binance + CoinGecko)",
    minScore: null,
    produce: async () => {
      const m = await marketPrice();
      const at = Math.floor(Date.now() / 1000);
      proJobs++;
      if (proJobs % 2 === 1) {
        proW
          .serial(() => proW.client.requestValidation(BigInt(A.pricepro.agentId), auditW.account.address, formatQuoteJob(m.price, at)))
          .then((r) => log("PricePro", `asked Audit Lab to validate quote ${m.price} (request #${r.requestId})`))
          .catch((e) => log("PricePro", `validation request failed: ${(e as Error).message.split("\n")[0]}`));
      }
      log("PricePro", `served ${m.price} (${m.sources.join("+")})`);
      return { pair: "AVAX/USD", price: m.price, sources: m.sources, at };
    },
    onPaid: rateBuyer("PricePro", proW),
  },
);

// --- FastQuote (sloppy on purpose) ---
let fastQuote: () => number = () => Number.NaN;
const fast = createPaidRoute(
  { ...base, payTo: fastW.account.address, priceWei: price },
  {
    route: /^\/quote$/,
    usage: "GET /quote",
    description: "AVAX/USD quote (cached)",
    minScore: null,
    produce: async () => {
      const p = fastQuote();
      log("FastQuote", `served ${p} (stale cache)`);
      return { pair: "AVAX/USD", price: p, sources: ["cache"], at: Math.floor(Date.now() / 1000) };
    },
    onPaid: rateBuyer("FastQuote", fastW),
  },
);

// --- AIDA Audit Lab: validator loop ---
const answered = new Set<string>();
// Only the known price sellers may ask for validation, and at most AUDIT_PER_MIN answers per minute (gas griefing guard).
const AUDIT_FOR = new Set([A.pricepro.agentId, A.fastquote.agentId]);
const AUDIT_PER_MIN = Number(process.env.AUDIT_PER_MIN ?? 6);
let auditWindow = { start: Date.now(), n: 0 };
async function auditTick() {
  const agents = (await reader.list()).filter((a) => AUDIT_FOR.has(a.agentId.toString()));
  for (const a of agents) {
    const vs = await reader.validations(a.agentId);
    for (const v of vs) {
      const id = v.requestId.toString();
      if (v.responded || answered.has(id) || v.validator.toLowerCase() !== auditW.account.address.toLowerCase()) continue;
      if (Date.now() - auditWindow.start > 60_000) auditWindow = { start: Date.now(), n: 0 };
      if (auditWindow.n >= AUDIT_PER_MIN) return;
      auditWindow.n++;
      answered.add(id);
      const job = parseQuoteJob(v.requestURI);
      const ref = await chainlinkPrice(pub as never);
      const score = job ? accuracyScore(job.price, ref.price) : 0;
      try {
        await auditW.serial(() => auditW.client.respondValidation(v.requestId, score, `chainlink://AVAX-USD/${ref.price}/${ref.updatedAt}`));
        log("AuditLab", `validation #${id} for ${a.card?.name}: quote ${job?.price ?? "?"} vs Chainlink ${ref.price.toFixed(4)} → ${score}`);
      } catch (e) {
        answered.delete(id);
        log("AuditLab", `respond #${id} failed: ${(e as Error).message.split("\n")[0]}`);
      }
    }
  }
}

// --- HTTP ---
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "X-Agent-Id, X-PAYMENT, Content-Type", "Access-Control-Expose-Headers": "X-PAYMENT-RESPONSE" };
function serve(port: number, name: string, info: Record<string, unknown>, handle?: (path: string, h: Record<string, string>, url?: URL, method?: string) => Promise<PaidResponse>, control = false) {
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
      else if (path === "/" || path === "/status" || !handle) out = { status: 200, body: { agent: name, chainId: 43113, ...info } };
      else out = await handle(path, req.headers as Record<string, string>, url, req.method);
    } catch (e) {
      out = { status: 500, body: { error: `internal error: ${(e as Error).message.split("\n")[0]}` } };
    }
    if (path !== "/" && path !== "/status" && path !== "/log") log(name, `${req.method} ${path} caller=${req.headers["x-agent-id"] ?? "-"} → ${out.status}`);
    res.writeHead(out.status, { "Content-Type": "application/json", ...headers, ...(out.headers ?? {}) });
    res.end(JSON.stringify(out.body, null, 2));
  }).listen(port, "127.0.0.1");
}

const p = (k: string) => A[k];
serve(p("oracle").port, "AIDA Trust Oracle", { agentId: p("oracle").agentId, payTo: oracleW.account.address, priceWei: reportPrice.toString(), minScore: 60 }, oracle.handle);
serve(p("pricepro").port, "AVAX Price Pro", { agentId: p("pricepro").agentId, payTo: proW.account.address, priceWei: price.toString() }, pro.handle);
serve(p("fastquote").port, "FastQuote", { agentId: p("fastquote").agentId, payTo: fastW.account.address, priceWei: price.toString() }, fast.handle);
serve(p("audit").port, "AIDA Audit Lab", { agentId: p("audit").agentId, validator: auditW.account.address, reference: "Chainlink AVAX/USD on Fuji" });
// --- Treasury Bot: run on demand from the web app (GET /run?rounds=N), stream its log (GET /log?since=i) ---
const events: (BuyerEvent & { i: number; t: string })[] = [];
let running = false;
const WEB_ORIGINS = (process.env.WEB_ORIGINS ?? "http://127.0.0.1:5181,http://localhost:5181").split(",");
const buyerHandle = async (path: string, h: Record<string, string>, url?: URL, method = "GET"): Promise<PaidResponse> => {
  const origin = h["origin"];
  if (path === "/log") {
    const since = Number(url?.searchParams.get("since") ?? 0);
    return { status: 200, body: { running, events: events.filter((e) => e.i >= since) } };
  }
  if (path === "/run") {
    if (method !== "POST") return { status: 405, body: { error: "POST /run" } };
    if (!origin || !WEB_ORIGINS.includes(origin)) return { status: 403, body: { error: "origin not allowed" } };
    if (running) return { status: 409, body: { error: "Treasury Bot is already running" } };
    const rounds = Math.min(10, Math.max(1, Number(url?.searchParams.get("rounds") ?? 4)));
    running = true;
    const start = events.length;
    runBuyer({ rounds, report: true, emit: (e) => { events.push({ ...e, i: events.length, t: ts() }); log("Treasury", e.text); } })
      .catch((e) => events.push({ level: "err", text: `run failed: ${(e as Error).message.split("\n")[0]}`, i: events.length, t: ts() }))
      .finally(() => (running = false));
    return { status: 202, body: { started: true, rounds, since: start } };
  }
  return { status: 404, body: { error: "use GET /run?rounds=N or GET /log?since=i" } };
};
serve(p("buyer").port, "Treasury Bot", { agentId: p("buyer").agentId, role: "buyer", run: "POST /run?rounds=N (web app origin only)", log: "GET /log?since=i" }, buyerHandle, true);

const boot = await marketPrice();
fastQuote = sloppyQuoter(boot.price);
setInterval(() => auditTick().catch((e) => log("AuditLab", `tick failed: ${(e as Error).message.split("\n")[0]}`)), 8000);
log("network", `AIDA agents live on Fuji — oracle :${p("oracle").port}, pricepro :${p("pricepro").port}, fastquote :${p("fastquote").port}, audit :${p("audit").port}`);
