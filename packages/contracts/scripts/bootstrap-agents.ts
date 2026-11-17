// Registers the real AIDA agent network on Fuji. No reviews or scores are seeded: reputation only comes
// from real paid jobs afterwards. Each agent registers itself from its own wallet (keys in .env.fuji).
import { readFileSync, writeFileSync } from "node:fs";
import { network } from "hardhat";
import { createWalletClient, formatEther, getAddress, http, parseEther, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { AidaClient, CARD_TYPE, type AgentCard, type Deployment } from "@aida/sdk";

const { viem } = await network.getOrCreate();
const pub = await viem.getPublicClient();
const chainId = await pub.getChainId();
if (chainId !== 43113) throw new Error("bootstrap-agents is for Fuji (43113)");
const file = new URL(`../../../deployments/${chainId}.json`, import.meta.url);
const dep: Deployment = JSON.parse(readFileSync(file, "utf8"));
const env = readFileSync(new URL("../../../.env.fuji", import.meta.url), "utf8");
const key = (n: string) => {
  const m = new RegExp(`^AGENT_KEY_${n}=(0x[0-9a-fA-F]{64})$`, "m").exec(env);
  if (!m) throw new Error(`AGENT_KEY_${n} missing in .env.fuji`);
  return m[1] as Hex;
};
const rpc = process.env.FUJI_RPC_URL ?? "https://avalanche-fuji-c-chain-rpc.publicnode.com";
const host = process.env.AGENT_HOST ?? "http://127.0.0.1";

const agents = [
  { k: "ORACLE", port: 8790, fund: "0.002", name: "AIDA Trust Oracle", description: "Sells trust reports on any AIDA agent over x402. Only serves callers with trust ≥ 60.", path: "/report" },
  { k: "PRICEPRO", port: 8791, fund: "0.002", name: "AVAX Price Pro", description: "Live AVAX/USD quote over x402: median of Binance and CoinGecko at request time.", path: "/quote" },
  { k: "FASTQUOTE", port: 8792, fund: "0.002", name: "FastQuote", description: "Cheap AVAX/USD quote over x402. Fast, caches aggressively.", path: "/quote" },
  { k: "AUDIT", port: 8793, fund: "0.002", name: "AIDA Audit Lab", description: "Independent validator: re-checks AVAX/USD quotes against Chainlink on Fuji and attests on-chain.", path: "/status" },
  { k: "BUYER", port: 8794, fund: "0.015", name: "Treasury Bot", description: "Autonomous buyer agent: discovers price agents on AIDA, pays over x402, verifies against Chainlink, rates on-chain.", path: "/status" },
] as const;

const [deployer] = await viem.getWalletClients();
const out: Record<string, { agentId: string; address: string; port: number; endpoint: string }> = {};
// Idempotent: an agent wallet that already owns an identity is not registered twice.
const existing = await new AidaClient(pub as never, dep).list();
for (const a of agents) {
  const account = privateKeyToAccount(key(a.k));
  const endpoint = `${host}:${a.port}${a.path}`;
  const mine = existing.find((x) => x.owner.toLowerCase() === account.address.toLowerCase());
  if (mine) {
    out[a.k.toLowerCase()] = { agentId: mine.agentId.toString(), address: account.address, port: a.port, endpoint };
    console.log(`#${mine.agentId} ${a.name} — already registered`);
    continue;
  }
  const bal = await pub.getBalance({ address: account.address });
  const want = parseEther(a.fund);
  if (bal < want) {
    const hash = await deployer.sendTransaction({ to: account.address, value: want - bal });
    await pub.waitForTransactionReceipt({ hash, timeout: 240_000 });
  }
  const wallet = createWalletClient({ account, chain: pub.chain, transport: http(rpc) });
  const client = new AidaClient(pub as never, dep, wallet as never);
  const card: AgentCard = { type: CARD_TYPE, name: a.name, description: a.description, endpoints: [{ name: "x402", endpoint }], wallet: getAddress(account.address) };
  const { agentId } = await client.register(card);
  out[a.k.toLowerCase()] = { agentId: agentId.toString(), address: account.address, port: a.port, endpoint };
  console.log(`#${agentId} ${a.name} — ${account.address} — ${endpoint}`);
}

writeFileSync(file, JSON.stringify({ ...dep, oracleAgentId: out.oracle.agentId, validatorAgentId: out.audit.agentId, agents: out }, null, 2) + "\n");
console.log("deployer left:", formatEther(await pub.getBalance({ address: deployer.account.address })), "AVAX");
