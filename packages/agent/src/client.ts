// CLI demo of a caller agent: node src/client.ts --as <agentId> --target <agentId> [--rate <0-100>]
// Env: CALLER_PRIVATE_KEY (owner of --as), ORACLE_URL, CHAIN_ID, RPC_URL
import { parseArgs } from "node:util";
import { createWalletClient, formatEther, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { AidaClient, callPaidAgent, nonceToData } from "@aida/sdk";
import { loadConfig } from "./config.ts";

const { values } = parseArgs({ options: { as: { type: "string" }, target: { type: "string" }, rate: { type: "string" } } });
if (!values.as || !values.target) throw new Error("usage: --as <callerAgentId> --target <agentId> [--rate 0-100]");
const key = process.env.CALLER_PRIVATE_KEY as Hex | undefined;
if (!key) throw new Error("CALLER_PRIVATE_KEY is required");

const { chain, dep, rpc, pub } = loadConfig();
const wallet = createWalletClient({ account: privateKeyToAccount(key), chain, transport: http(rpc) });
const aida = new AidaClient(pub, dep, wallet);
const oracleUrl = process.env.ORACLE_URL ?? "http://127.0.0.1:8787";
const callerId = BigInt(values.as);

const result = await callPaidAgent(`${oracleUrl}/report/${values.target}`, callerId, async (req) => {
  console.log(`402 Payment Required → paying ${formatEther(BigInt(req.maxAmountRequired))} AVAX to ${req.payTo}`);
  const hash = await wallet.sendTransaction({ to: req.payTo, value: BigInt(req.maxAmountRequired), data: nonceToData(req.nonce) });
  await pub.waitForTransactionReceipt({ hash });
  return hash;
});
for (const s of result.steps) {
  if (s.kind === "request") console.log(`HTTP ${s.status}`, JSON.stringify(s.body).slice(0, 200));
  else console.log(`paid tx ${s.txHash}`);
}
if (!result.ok) process.exit(2);
const report = (result.body as { report: { verdict: string; target: { card: { name: string } | null; average: string; count: string } } }).report;
console.log(`\nREPORT: ${report.target.card?.name ?? "?"} → verdict ${report.verdict.toUpperCase()} (avg ${report.target.average}, ${report.target.count} reviews)`);
if (values.rate && dep.oracleAgentId) {
  const tx = await aida.giveFeedback(BigInt(dep.oracleAgentId), Number(values.rate), "trust-report");
  const s = await aida.summary(BigInt(dep.oracleAgentId));
  console.log(`Rated Oracle ${values.rate}/100 (tx ${tx}) → Oracle now avg ${s.average} from ${s.count} reviews`);
}
