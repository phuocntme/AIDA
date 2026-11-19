// Puts the five demo agents on-chain (idempotent). No reviews or scores are written here: reputation only comes
// from paid jobs afterwards.
//   1. each agent registers its own ERC-8004 identity from its own wallet and lists it in the AIDA directory
//   2. Treasury Bot puts itself under an AgentPolicy whose guardian is the human key (this script's signer)
//   3. the guardian whitelists the sellers and funds the policy
// Fuji: agent keys from .env.fuji, guardian key from .env.guardian. Local: Hardhat's public test keys.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { network } from "hardhat";
import { createWalletClient, formatEther, getAddress, http, parseEther, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { AidaClient, CARD_TYPE, localKey, type AgentCard, type AgentRole, type Deployment } from "@aida/sdk";

const { viem } = await network.getOrCreate();
const pub = await viem.getPublicClient();
const chainId = await pub.getChainId();
const file = new URL(`../../../deployments/${chainId}.json`, import.meta.url);
const dep: Deployment = JSON.parse(readFileSync(file, "utf8"));
const fuji = chainId === 43113;
const env = fuji ? readFileSync(new URL("../../../.env.fuji", import.meta.url), "utf8") : "";
const key = (role: AgentRole): Hex => {
  if (!fuji) return localKey(role);
  const m = new RegExp(`^AGENT_KEY_${role}=(0x[0-9a-fA-F]{64})$`, "m").exec(env);
  if (!m) throw new Error(`AGENT_KEY_${role} missing in .env.fuji`);
  return m[1] as Hex;
};
const rpc = fuji ? (process.env.FUJI_RPC_URL ?? "https://avalanche-fuji-c-chain-rpc.publicnode.com") : "http://127.0.0.1:8545";
const host = process.env.AGENT_HOST ?? "http://127.0.0.1";
const minGas = parseEther(fuji ? "0.001" : "1");

const agents: { role: AgentRole; id: string; port: number; name: string; description: string; path: string }[] = [
  { role: "ORACLE", id: "oracle", port: 8790, name: "AIDA Trust Oracle", description: "Sells trust reports on any AIDA agent (x402-style, native AVAX). Serves callers with trust ≥ 60, or newcomers whose funded AgentPolicy has a guardian it knows.", path: "/report" },
  { role: "PRICEPRO", id: "pricepro", port: 8791, name: "AVAX Price Pro", description: "Signed AVAX/USD quote, median of Binance and CoinGecko at request time. Fresher than the on-chain feed's heartbeat.", path: "/quote" },
  { role: "FASTQUOTE", id: "fastquote", port: 8792, name: "FastQuote", description: "Cheap signed AVAX/USD quote. Fast, caches aggressively.", path: "/quote" },
  { role: "AUDIT", id: "audit", port: 8793, name: "AIDA Audit Lab", description: "Independent validator: re-checks AVAX/USD quotes against Chainlink and attests on-chain.", path: "/status" },
  { role: "BUYER", id: "buyer", port: 8794, name: "Treasury Bot", description: "Buyer agent: finds price agents on AIDA, pays through its AgentPolicy, has every quote scored on-chain against Chainlink.", path: "/status" },
];

const [guardian] = await viem.getWalletClients();
const wait = (hash: Hex) => pub.waitForTransactionReceipt({ hash, timeout: 240_000 });
const out: NonNullable<Deployment["agents"]> = {};
const reader = new AidaClient(pub as never, dep);
const existing = await reader.list();
for (const a of agents) {
  const account = privateKeyToAccount(key(a.role));
  const endpoint = `${host}:${a.port}${a.path}`;
  const mine = existing.find((x) => x.owner.toLowerCase() === account.address.toLowerCase());
  if (mine) {
    out[a.id] = { agentId: mine.agentId.toString(), address: account.address, port: a.port, endpoint };
    console.log(`#${mine.agentId} ${a.name}: already registered`);
    continue;
  }
  if ((await pub.getBalance({ address: account.address })) < minGas) await wait(await guardian.sendTransaction({ to: account.address, value: minGas }));
  const wallet = createWalletClient({ account, chain: pub.chain, transport: http(rpc) });
  const client = new AidaClient(pub as never, dep, wallet as never);
  // An identity this wallet already owns in the ERC-8004 registry (from an earlier deployment) is only listed again.
  const known = dep.agents?.[a.id];
  if (known && (await reader.ownerOf(BigInt(known.agentId)).catch(() => null))?.toLowerCase() === account.address.toLowerCase()) {
    out[a.id] = { agentId: known.agentId, address: account.address, port: a.port, endpoint };
    console.log(`#${known.agentId} ${a.name}: existing ERC-8004 identity, enroll ${await client.enroll(BigInt(known.agentId))}`);
    continue;
  }
  const card: AgentCard = { type: CARD_TYPE, name: a.name, description: a.description, endpoints: [{ name: "x402-style", endpoint }], wallet: getAddress(account.address) };
  const r = await client.register(card);
  out[a.id] = { agentId: r.agentId.toString(), address: account.address, port: a.port, endpoint };
  console.log(`#${r.agentId} ${a.name}: ${account.address} register ${r.txHash} enroll ${r.enrollTx}`);
}
const next: Deployment = { ...dep, guardian: guardian.account.address, oracleAgentId: out.oracle.agentId, validatorAgentId: out.audit.agentId, agents: out };
writeFileSync(file, JSON.stringify(next, null, 2) + "\n");

// --- AgentPolicy for Treasury Bot ---
const DAILY = parseEther(process.env.POLICY_DAILY_CAP ?? (fuji ? "0.03" : "1"));
const PER_PAYMENT = parseEther(process.env.POLICY_PER_PAYMENT ?? "0.002");
const FUND = parseEther(process.env.POLICY_FUND ?? (fuji ? "0.02" : "1"));
const botId = BigInt(out.buyer.agentId);
const bot = new AidaClient(pub as never, next, createWalletClient({ account: privateKeyToAccount(key("BUYER")), chain: pub.chain, transport: http(rpc) }) as never);
const human = new AidaClient(pub as never, next, guardian as never);
if (!(await reader.policy(botId))) {
  console.log(`Treasury Bot #${botId} is now behind the policy (guardian ${guardian.account.address}) tx ${await bot.createPolicy(botId, guardian.account.address, DAILY, PER_PAYMENT)}`);
}
let p = (await reader.policy(botId))!;
for (const k of ["pricepro", "fastquote", "oracle"]) {
  const to = out[k].address as Hex;
  if (p.recipients.some((r) => r.toLowerCase() === to.toLowerCase())) continue;
  if (k === "fastquote" && process.env.SKIP_FASTQUOTE) continue;
  console.log(`whitelisted ${k} ${to} tx ${await human.setPolicyRecipient(botId, to, true)}`);
}
// Optional pause-only operator (the key behind the demo signer): named by the guardian, given a little gas.
const opFile = new URL("../../../.env.operator", import.meta.url);
if (fuji && existsSync(opFile)) {
  const opKey = /^OPERATOR_PRIVATE_KEY=(0x[0-9a-fA-F]{64})$/m.exec(readFileSync(opFile, "utf8"))?.[1] as Hex | undefined;
  if (opKey) {
    const op = privateKeyToAccount(opKey).address;
    if (p.operator.toLowerCase() !== op.toLowerCase()) console.log(`operator (pause only) ${op} tx ${await human.setPolicyOperator(botId, op)}`);
    if ((await pub.getBalance({ address: op })) < parseEther("0.0002")) await wait(await guardian.sendTransaction({ to: op, value: parseEther("0.0005") }));
  }
}
if (p.balance < FUND) console.log(`guardian deposited ${formatEther(FUND - p.balance)} AVAX tx ${await human.depositToPolicy(botId, FUND - p.balance)}`);
p = (await reader.policy(botId))!;
console.log(`policy: balance ${formatEther(p.balance)} · daily cap ${formatEther(p.dailyCap)} · per payment ${formatEther(p.perPaymentCap)} · paused ${p.paused} · whitelist ${p.recipients.length}`);
console.log("guardian left:", formatEther(await pub.getBalance({ address: guardian.account.address })), "AVAX");
