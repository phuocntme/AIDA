// Seeds demo agents, reviews and validations.
// Local (31337): Hardhat's test accounts. Fuji (43113): demo wallets generated into .env.fuji (testnet only)
// and funded from the deployer.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { network } from "hardhat";
import { createWalletClient, formatEther, getAddress, http, parseEther, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { AidaClient, CARD_TYPE, type AgentCard, type Deployment } from "@aida/sdk";

const { viem } = await network.getOrCreate();
const pub = await viem.getPublicClient();
const chainId = await pub.getChainId();
const file = new URL(`../../../deployments/${chainId}.json`, import.meta.url);
const dep: Deployment = JSON.parse(readFileSync(file, "utf8"));
const oracleUrl = process.env.ORACLE_URL ?? "http://127.0.0.1:8787";

type W = Awaited<ReturnType<typeof viem.getWalletClients>>[number];
let w: W[];
if (chainId === 31337) {
  w = await viem.getWalletClients();
} else {
  const envFile = new URL("../../../.env.fuji", import.meta.url);
  const env = existsSync(envFile) ? readFileSync(envFile, "utf8") : "";
  let keys = (/^DEMO_KEYS=(.*)$/m.exec(env)?.[1] ?? "").split(",").filter(Boolean) as Hex[];
  if (keys.length < 9) {
    keys = Array.from({ length: 9 }, () => generatePrivateKey());
    writeFileSync(envFile, env.replace(/^DEMO_KEYS=.*\n?/m, "") + `DEMO_KEYS=${keys.join(",")}\n`, { mode: 0o600 });
    console.log("Generated 9 demo wallets into .env.fuji");
  }
  const rpc = process.env.FUJI_RPC_URL ?? "https://api.avax-test.network/ext/bc/C/rpc";
  w = keys.map((k) => createWalletClient({ account: privateKeyToAccount(k), chain: pub.chain, transport: http(rpc) })) as unknown as W[];
  const [deployer] = await viem.getWalletClients();
  const amount = parseEther(process.env.DEMO_FUND ?? "0.03");
  for (const i of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const bal = await pub.getBalance({ address: w[i].account.address });
    if (bal < amount / 2n) {
      const hash = await deployer.sendTransaction({ to: w[i].account.address, value: amount });
      await pub.waitForTransactionReceipt({ hash });
    }
  }
  console.log(`Funded demo wallets with ${formatEther(amount)} AVAX each`);
}

const as = (i: number) => new AidaClient(pub as never, dep, w[i] as never);
const card = (name: string, description: string, endpoint: string, wallet: string): AgentCard => ({
  type: CARD_TYPE,
  name,
  description,
  endpoints: [{ name: "http", endpoint }],
  wallet: getAddress(wallet),
});
const addr = (i: number) => w[i].account.address;

const translator = await as(1).register(card("TranslatorVN", "English–Vietnamese technical translation for other agents. Highly rated.", "https://translator.example/api", addr(1)));
const spam = await as(2).register(card("SpamBot 9000", "Airdrop spam agent. Rated low by the community.", "https://spam.example/api", addr(2)));
const oracle = await as(5).register(card("AIDA Trust Oracle", "Sells agent trust reports over x402. Only serves agents with trust ≥ 60.", `${oracleUrl}/report`, addr(5)));
const newbie = await as(6).register(card("Newcomer Agent", "Just registered. No reviews yet.", "https://newcomer.example/api", addr(6)));
const auditor = await as(8).register(card("AIDA Audit Lab", "Independent validator. Re-runs agent jobs and attests the result on-chain.", "https://audit.example/api", addr(8)));

await as(3).giveFeedback(translator.agentId, 92, "accuracy");
await as(4).giveFeedback(translator.agentId, 88, "speed");
await as(3).giveFeedback(spam.agentId, 15, "spam");
await as(4).giveFeedback(spam.agentId, 25, "spam");
await as(3).giveFeedback(oracle.agentId, 80, "trust-report");
await as(1).giveFeedback(auditor.agentId, 90, "validation");

if (dep.validation) {
  const v1 = await as(1).requestValidation(translator.agentId, addr(8), "job://translate/legal-contract-0142");
  await as(8).respondValidation(v1.requestId, 96, "report://audit/0142");
  const v2 = await as(1).requestValidation(translator.agentId, addr(8), "job://translate/whitepaper-0157");
  await as(8).respondValidation(v2.requestId, 91, "report://audit/0157");
  const v3 = await as(5).requestValidation(oracle.agentId, addr(8), "job://trust-report/sample-07");
  await as(8).respondValidation(v3.requestId, 88, "report://audit/sample-07");
  await as(2).requestValidation(spam.agentId, addr(8), "job://airdrop/claim-bot"); // pending: the validator never answered
}

writeFileSync(file, JSON.stringify({ ...dep, oracleAgentId: oracle.agentId.toString(), validatorAgentId: auditor.agentId.toString() }, null, 2) + "\n");
console.log("Seeded agents:", {
  translator: translator.agentId,
  spam: spam.agentId,
  oracle: oracle.agentId,
  newbie: newbie.agentId,
  auditor: auditor.agentId,
});
