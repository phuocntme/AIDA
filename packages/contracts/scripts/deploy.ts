// Deploys AIDA's contracts and writes deployments/<chainId>.json.
//   Fuji (43113): PaidReviews, AgentPolicy and ValidationRegistry on top of the canonical ERC-8004 registries and
//                 the Chainlink AVAX/USD feed. No identity registry is deployed.
//   Local (31337): the same three, plus local stand-ins for the identity registry, the reputation registry and
//                 the price feed.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { network } from "hardhat";
import type { Hex } from "viem";
import { toFeedUnits } from "@aida/sdk";
import { FUJI, deployCore } from "./lib.ts";

const { viem } = await network.getOrCreate();
const pub = await viem.getPublicClient();
const chainId = await pub.getChainId();
const [deployer] = await viem.getWalletClients();

let ext: { identity: Hex; feed: Hex; erc8004Reputation: Hex };
if (chainId === 43113) {
  ext = { ...FUJI };
} else {
  const identity = await viem.deployContract("LocalIdentityRegistry");
  const feed = await viem.deployContract("MockPriceFeed", [toFeedUnits(Number(process.env.LOCAL_FEED_PRICE ?? 7))]);
  const rep = await viem.deployContract("MockReputationRegistry");
  ext = { identity: identity.address, feed: feed.address, erc8004Reputation: rep.address };
}
// Fuji: a fixed small tip. The node's tip suggestion swings between 150 wei and 2 gwei; 1000 wei is included within a block or two.
const fees = chainId === 43113 ? { maxPriorityFeePerGas: 1000n, maxFeePerGas: 1_000_000_000n } : {};
const core = await deployCore(viem as never, pub as never, deployer.account.address, ext, fees);
const dir = new URL("../../../deployments/", import.meta.url);
mkdirSync(dir, { recursive: true });
// Agent identities live in the ERC-8004 registry, not in AIDA's contracts: a redeploy on Fuji keeps them.
const old = existsSync(new URL(`${chainId}.json`, dir)) ? JSON.parse(readFileSync(new URL(`${chainId}.json`, dir), "utf8")) : {};
const keep = chainId === 43113 && old.identity?.toLowerCase() === ext.identity.toLowerCase() && old.agents ? { agents: old.agents } : {};
const dep = { chainId, ...ext, ...core, guardian: deployer.account.address, ...keep };
writeFileSync(new URL(`${chainId}.json`, dir), JSON.stringify(dep, null, 2) + "\n");
console.log(`Deployed on chain ${chainId}:`, dep);
