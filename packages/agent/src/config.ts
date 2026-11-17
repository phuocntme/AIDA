import { readFileSync } from "node:fs";
import { createPublicClient, http } from "viem";
import { AidaClient, chains, type Deployment } from "@aida/sdk";

export function loadConfig() {
  const chainId = Number(process.env.CHAIN_ID ?? 31337);
  const chain = chains[chainId];
  if (!chain) throw new Error(`Unsupported CHAIN_ID ${chainId} (use 31337 or 43113)`);
  const depFile = new URL(`../../../deployments/${chainId}.json`, import.meta.url);
  let dep: Deployment;
  try {
    dep = JSON.parse(readFileSync(depFile, "utf8"));
  } catch {
    throw new Error(`No deployment for chain ${chainId} at ${depFile.pathname}. Run the deploy script first.`);
  }
  const rpc = process.env.RPC_URL ?? chain.rpcUrls.default.http[0];
  const pub = createPublicClient({ chain, transport: http(rpc) });
  return { chainId, chain, dep, rpc, pub, aida: new AidaClient(pub, dep) };
}
