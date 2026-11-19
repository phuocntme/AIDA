// Guardian CLI for Treasury Bot's AgentPolicy.
//   pnpm guardian status | pause | resume | deposit <avax> | withdraw <avax> | limits <dailyAvax> <perPaymentAvax>
//               | allow <address|agent> | deny <address|agent> | operator <address>   (pause-only key; 0x0…0 removes it)
// Fuji: signs with GUARDIAN_PRIVATE_KEY from .env.guardian, a file the agent process never reads.
// In production the guardian is a wallet on another device (Core, a hardware wallet); the second file only
// lets the demo run on one laptop. Local chain (CHAIN_ID=31337): Hardhat's public test key #0.
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, formatEther, http, isAddress, parseEther, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { AidaClient, chains, localKey, type Deployment } from "@aida/sdk";
import { FUJI_RPC } from "./config.ts";

const root = new URL("../../../", import.meta.url);
const chainId = Number(process.env.CHAIN_ID ?? 43113);
const fuji = chainId === 43113;
const dep: Deployment = JSON.parse(readFileSync(new URL(`deployments/${chainId}.json`, root), "utf8"));
const key = fuji ? (/^GUARDIAN_PRIVATE_KEY=(0x[0-9a-fA-F]{64})$/m.exec(readFileSync(new URL(".env.guardian", root), "utf8"))?.[1] as Hex | undefined) : localKey("GUARDIAN");
if (!key) throw new Error("GUARDIAN_PRIVATE_KEY missing in .env.guardian");
const rpc = fuji ? (process.env.FUJI_RPC_URL ?? FUJI_RPC) : (process.env.RPC_URL ?? "http://127.0.0.1:8545");
const pub = createPublicClient({ chain: chains[chainId], transport: http(rpc, { retryCount: 4 }) });
const wallet = createWalletClient({ account: privateKeyToAccount(key), chain: chains[chainId], transport: http(rpc) });
const aida = new AidaClient(pub as never, dep, wallet as never);
const bot = BigInt(dep.agents!.buyer.agentId);
const [cmd = "status", a1, a2] = process.argv.slice(2);
const link = (tx: string) => (fuji ? `https://testnet.snowtrace.io/tx/${tx}` : tx);
const addr = (x?: string): Hex => {
  const named = x ? dep.agents?.[x]?.address : undefined;
  if (named) return named as Hex;
  if (!x || !isAddress(x)) throw new Error(`need an address or one of: ${Object.keys(dep.agents ?? {}).join(", ")}`);
  return x;
};

if (cmd === "pause" || cmd === "resume") console.log(`${cmd}d Treasury Bot #${bot}: ${link(await aida.setPolicyPaused(bot, cmd === "pause"))}`);
else if (cmd === "deposit") console.log(`deposited ${a1} AVAX: ${link(await aida.depositToPolicy(bot, parseEther(a1 ?? "")))}`);
else if (cmd === "withdraw") console.log(`withdrew ${a1} AVAX to the guardian: ${link(await aida.withdrawFromPolicy(bot, parseEther(a1 ?? "")))}`);
else if (cmd === "limits") console.log(`limits set: ${link(await aida.setPolicyLimits(bot, parseEther(a1 ?? ""), parseEther(a2 ?? "")))}`);
else if (cmd === "allow" || cmd === "deny") console.log(`${cmd} ${addr(a1)}: ${link(await aida.setPolicyRecipient(bot, addr(a1), cmd === "allow"))}`);
else if (cmd === "operator") {
  if (!a1 || !isAddress(a1)) throw new Error("operator needs an address");
  console.log(`operator set to ${a1}: ${link(await aida.setPolicyOperator(bot, a1))}`);
} else if (cmd !== "status") throw new Error(`unknown command ${cmd}`);

const p = await aida.policy(bot);
if (!p) throw new Error("Treasury Bot has no policy (run the bootstrap script)");
console.log(
  `AgentPolicy ${dep.policy} · agent #${bot} · ${p.paused ? "PAUSED" : "active"} · ${formatEther(p.spentToday)}/${formatEther(p.dailyCap)} AVAX today · per payment ≤ ${formatEther(p.perPaymentCap)} · balance ${formatEther(p.balance)} · ${p.payments} payments · operator ${/^0x0+$/.test(p.operator) ? "none" : p.operator} · whitelist ${p.recipients.join(", ")}`,
);
console.log(`guardian ${wallet.account.address} · wallet balance ${formatEther(await pub.getBalance({ address: wallet.account.address }))} AVAX`);
