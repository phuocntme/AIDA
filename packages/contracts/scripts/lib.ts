// Shared deploy step: PaidReviews and AgentPolicy point at each other through immutables, so PaidReviews is
// given the address AgentPolicy will get (deployer's next nonce). Nobody keeps an admin key.
import { getContractAddress, type Hex } from "viem";

export const FUJI = {
  identity: "0x8004A818BFB912233c491871b3d84c89A494BD9e", // canonical ERC-8004 Identity Registry (v2.0.0)
  erc8004Reputation: "0x8004B663056A597Dffe9eCcC1965A193B7388713", // canonical ERC-8004 Reputation Registry
  feed: "0x5498BB86BC934c8D34FDA08E81D444153d0D06aD", // Chainlink AVAX / USD
} as const;

type Viem = { deployContract(name: string, args?: unknown[], config?: Record<string, unknown>): Promise<{ address: Hex }> };
type Pub = { getTransactionCount(a: { address: Hex; blockTag?: "pending" }): Promise<number> };

export async function deployCore(viem: Viem, pub: Pub, deployer: Hex, ext: { identity: Hex; feed: Hex; erc8004Reputation: Hex }, fees: Record<string, unknown> = {}) {
  const nonce = await pub.getTransactionCount({ address: deployer, blockTag: "pending" });
  const predicted = getContractAddress({ from: deployer, nonce: BigInt(nonce + 1) });
  const reviews = await viem.deployContract("PaidReviews", [ext.identity, predicted, ext.feed, ext.erc8004Reputation], fees);
  const policy = await viem.deployContract("AgentPolicy", [ext.identity, reviews.address], fees);
  if (policy.address.toLowerCase() !== predicted.toLowerCase()) throw new Error(`AgentPolicy landed at ${policy.address}, expected ${predicted}: redeploy`);
  const validation = await viem.deployContract("ValidationRegistry", [ext.identity], fees);
  return { reviews: reviews.address, policy: policy.address, validation: validation.address };
}
