import { mkdirSync, writeFileSync } from "node:fs";
import { network } from "hardhat";

const { viem } = await network.getOrCreate();
const pub = await viem.getPublicClient();
const chainId = await pub.getChainId();

const identity = await viem.deployContract("IdentityRegistry");
const reputation = await viem.deployContract("ReputationRegistry", [identity.address]);
const validation = await viem.deployContract("ValidationRegistry", [identity.address]);

const dep = { chainId, identity: identity.address, reputation: reputation.address, validation: validation.address };
const dir = new URL("../../../deployments/", import.meta.url);
mkdirSync(dir, { recursive: true });
writeFileSync(new URL(`${chainId}.json`, dir), JSON.stringify(dep, null, 2) + "\n");
console.log(`Deployed on chain ${chainId}:`, dep);
