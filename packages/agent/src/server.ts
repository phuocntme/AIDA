// HTTP wrapper for the Trust Oracle. Env: CHAIN_ID, RPC_URL, PORT, PRICE_WEI, MIN_SCORE, PAY_TO, ORACLE_AGENT_ID
import { createServer } from "node:http";
import { parseEther, type Hex } from "viem";
import { loadConfig } from "./config.ts";
import { createOracle } from "./oracle.ts";

const { chainId, chain, dep, pub, aida } = loadConfig();
const port = Number(process.env.PORT ?? 8787);
const oracleId = BigInt(process.env.ORACLE_AGENT_ID ?? dep.oracleAgentId ?? 0);
if (!oracleId) throw new Error("ORACLE_AGENT_ID not set and no oracleAgentId in deployment file (run seed)");
const payTo = (process.env.PAY_TO as Hex | undefined) ?? (await aida.ownerOf(oracleId));

const priceWei = process.env.PRICE_WEI ? BigInt(process.env.PRICE_WEI) : parseEther("0.01");
const oracle = createOracle({
  registry: aida,
  chain: pub as never,
  payTo,
  priceWei,
  minScore: Number(process.env.MIN_SCORE ?? 60),
  chainId,
  network: chainId === 43113 ? "avalanche-fuji" : "localhost",
});

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "X-Agent-Id, X-PAYMENT, Content-Type",
  "Access-Control-Expose-Headers": "X-PAYMENT-RESPONSE",
};

createServer(async (req, res) => {
  if (req.method === "OPTIONS") return void res.writeHead(204, cors).end();
  const path = new URL(req.url ?? "/", "http://x").pathname;
  let out;
  try {
    if (req.method !== "GET") out = { status: 405, body: { error: "GET only" } };
    else if (path === "/") out = { status: 200, body: { agent: "AIDA Trust Oracle", agentId: oracleId.toString(), chainId, payTo, priceWei: priceWei.toString(), minScore: Number(process.env.MIN_SCORE ?? 60), usage: "GET /report/:agentId with X-Agent-Id" } };
    else out = await oracle.handle(path, req.headers as Record<string, string>);
  } catch (e) {
    console.error("oracle error", e);
    out = { status: 500, body: { error: `internal error: ${(e as Error).message.split("\n")[0]}` } };
  }
  console.log(`${new Date().toISOString()} ${req.method} ${path} caller=${req.headers["x-agent-id"] ?? "-"} -> ${out.status}`);
  res.writeHead(out.status, { "Content-Type": "application/json", ...cors, ...(out.headers ?? {}) });
  res.end(JSON.stringify(out.body, null, 2));
}).listen(port, "127.0.0.1", () => console.log(`AIDA Trust Oracle (agent #${oracleId}) on http://127.0.0.1:${port} — chain ${chain.name}, payTo ${payTo}`));
