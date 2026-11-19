// Which chain the agents run on, and which keys they may read.
//   CHAIN_ID=43113 (default): Avalanche Fuji, agent keys from .env.fuji
//   CHAIN_ID=31337: local Hardhat node, Hardhat's public test keys
// The guardian key is deliberately NOT available here: the agent process never reads .env.guardian.
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { AidaClient, chains, localKey, type AgentRole, type Deployment } from "@aida/sdk";

const root = new URL("../../../", import.meta.url);
export const FUJI_RPC = "https://avalanche-fuji-c-chain-rpc.publicnode.com";

export function loadNetwork() {
  const chainId = Number(process.env.CHAIN_ID ?? 43113);
  const chain = chains[chainId];
  if (!chain) throw new Error(`Unsupported CHAIN_ID ${chainId} (use 43113 or 31337)`);
  let dep: Deployment;
  try {
    dep = JSON.parse(readFileSync(new URL(`deployments/${chainId}.json`, root), "utf8"));
  } catch {
    throw new Error(`deployments/${chainId}.json not found: run the deploy script first`);
  }
  if (!dep.agents) throw new Error(`deployments/${chainId}.json has no agents: run the bootstrap script first`);
  const fuji = chainId === 43113;
  const rpc = fuji ? (process.env.FUJI_RPC_URL ?? FUJI_RPC) : (process.env.RPC_URL ?? "http://127.0.0.1:8545");
  const env = fuji ? readFileSync(new URL(".env.fuji", root), "utf8") : "";
  const key = (role: AgentRole): Hex => {
    if (!fuji) return localKey(role);
    const k = new RegExp(`^AGENT_KEY_${role}=(0x[0-9a-fA-F]{64})$`, "m").exec(env)?.[1];
    if (!k) throw new Error(`AGENT_KEY_${role} missing in .env.fuji`);
    return k as Hex;
  };
  const pub = createPublicClient({ chain, transport: http(rpc, { retryCount: 4 }), pollingInterval: fuji ? 500 : 100 });
  /** A wallet + SDK client for one agent. Its transactions are queued so concurrent jobs never collide on nonces. */
  const agent = (role: AgentRole) => {
    const account = privateKeyToAccount(key(role));
    const wallet = createWalletClient({ account, chain, transport: http(rpc) });
    const client = new AidaClient(pub as never, dep, wallet as never);
    let queue: Promise<unknown> = Promise.resolve();
    const serial = <T,>(fn: () => Promise<T>) => {
      const run = queue.then(fn, fn);
      queue = run.catch(() => undefined);
      return run;
    };
    return { account, wallet, client, serial };
  };
  return {
    chainId,
    chain,
    dep: dep as Deployment & { agents: NonNullable<Deployment["agents"]> },
    rpc,
    pub,
    fuji,
    network: fuji ? "avalanche-fuji" : "localhost",
    reader: new AidaClient(pub as never, dep),
    agent,
    explorerTx: (h: string) => (fuji ? `https://testnet.snowtrace.io/tx/${h}` : h),
  };
}
