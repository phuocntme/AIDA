// The SDK against the real contracts on Hardhat's in-process chain: the TypeScript signing and decoding paths
// must agree with the Solidity ones.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";
import { BaseError, ContractFunctionRevertedError, getAddress, parseEther, type Hex } from "viem";
import { AidaClient, CARD_TYPE, nonceToData, toFeedUnits, type AgentCard, type Deployment } from "@aida/sdk";
import { deployCore } from "../scripts/lib.ts";

const { viem, networkHelpers } = await network.create();
const revertName = (e: unknown) => {
  const r = e instanceof BaseError ? e.walk((x) => x instanceof ContractFunctionRevertedError) : null;
  return r instanceof ContractFunctionRevertedError ? r.data?.errorName : undefined;
};
const card = (name: string, wallet: string): AgentCard => ({ type: CARD_TYPE, name, description: "", endpoints: [{ name: "x402-style", endpoint: "http://127.0.0.1:8791/quote" }], wallet: getAddress(wallet) });

async function setup() {
  const pub = await viem.getPublicClient();
  const [guardianW, buyerW, sellerW, strangerW] = await viem.getWalletClients();
  const identity = await viem.deployContract("LocalIdentityRegistry");
  const feed = await viem.deployContract("MockPriceFeed", [toFeedUnits(7)]);
  const rep = await viem.deployContract("MockReputationRegistry");
  const ext = { identity: identity.address, feed: feed.address, erc8004Reputation: rep.address };
  const core = await deployCore(viem as never, pub as never, guardianW.account.address, ext);
  const dep: Deployment = { chainId: await pub.getChainId(), ...ext, ...core };
  const as = (w: typeof guardianW) => new AidaClient(pub as never, dep, w as never);
  const [guardian, buyer, seller, stranger] = [as(guardianW), as(buyerW), as(sellerW), as(strangerW)];
  const b = await buyer.register(card("Treasury Bot", buyerW.account.address));
  const s = await seller.register(card("AVAX Price Pro", sellerW.account.address));
  await buyer.createPolicy(b.agentId, guardianW.account.address, parseEther("0.01"), parseEther("0.002"));
  await guardian.setPolicyRecipient(b.agentId, sellerW.account.address, true);
  await guardian.depositToPolicy(b.agentId, parseEther("0.05"));
  return { dep, pub, rep, feed, guardian, buyer, seller, stranger, buyerId: b.agentId, sellerId: s.agentId, sellerAddr: getAddress(sellerW.account.address), strangerAddr: getAddress(strangerW.account.address) };
}

describe("SDK ↔ contracts", () => {
  it("register mints an ERC-8004 identity and lists it in the AIDA directory", async () => {
    const { buyer, buyerId, sellerId, sellerAddr } = await networkHelpers.loadFixture(setup);
    const list = await buyer.list();
    assert.deepEqual(list.map((a) => a.agentId), [buyerId, sellerId]);
    assert.equal(list[1].card?.name, "AVAX Price Pro");
    assert.equal(list[1].card?.endpoints[0].endpoint, "http://127.0.0.1:8791/quote");
    assert.equal(list[1].owner, sellerAddr);
    assert.equal(list[1].count, 0n);
    assert.equal(await buyer.resolve(999n), null);
  });

  it("one paid job: pay through the policy, the seller signs its quote, the contract scores it against the feed", async () => {
    const { buyer, seller, rep, dep, buyerId, sellerId, sellerAddr } = await networkHelpers.loadFixture(setup);
    const ref = nonceToData("nonce-1");
    await buyer.payViaPolicy(buyerId, sellerAddr, parseEther("0.0005"), ref);
    const now = Number((await (await viem.getPublicClient()).getBlock()).timestamp);
    const signed = await seller.signQuote({ agentId: sellerId, quote: toFeedUnits(7.07), quotedAt: now, ref });
    const r = await buyer.reviewQuote(signed);
    assert.equal(r.score, 88); // +1% from the 7.00 feed
    assert.equal(r.feedPrice, 7);
    assert.equal(r.mirrored, true);
    const [f] = await buyer.feedback(sellerId);
    assert.equal(f.reviewerAgentId, buyerId);
    assert.equal(f.checked, true);
    assert.equal(f.quote, 7.07);
    assert.equal(f.tag, "price-accuracy");
    assert.equal(f.ref, ref);
    assert.deepEqual(await buyer.summary(sellerId), { count: 1n, average: 88n, checked: 1n });
    assert.equal(await rep.read.count(), 1n);
    const [, client, value, , tag2] = await rep.read.entries([0n]);
    assert.equal(client, getAddress(dep.reviews));
    assert.equal(value, 88n);
    assert.equal(tag2, "aida-chainlink-checked");
    const p = (await buyer.policy(buyerId))!;
    assert.equal(p.payments, 1n);
    assert.equal(p.totalPaid, parseEther("0.0005"));
    assert.deepEqual(await buyer.payment(ref), { to: sellerAddr, agentId: buyerId, reviewed: true });
    const act = await buyer.activity();
    assert.equal(act[0].kind, "feedback");
    assert.equal(act[0].checked, true);
  });

  it("no payment, no review; and the reviewer cannot change what the seller signed", async () => {
    const { buyer, seller, buyerId, sellerId, sellerAddr } = await networkHelpers.loadFixture(setup);
    const now = Number((await (await viem.getPublicClient()).getBlock()).timestamp);
    const unpaid = await seller.signQuote({ agentId: sellerId, quote: toFeedUnits(7), quotedAt: now, ref: nonceToData("never-paid") });
    await assert.rejects(buyer.reviewQuote(unpaid), (e) => revertName(e) === "NoSuchPayment");
    await assert.rejects(buyer.review(nonceToData("never-paid"), sellerId, 0, "spam"), (e) => revertName(e) === "NoSuchPayment");
    const ref = nonceToData("nonce-2");
    await buyer.payViaPolicy(buyerId, sellerAddr, parseEther("0.0005"), ref);
    const signed = await seller.signQuote({ agentId: sellerId, quote: toFeedUnits(7), quotedAt: now, ref });
    await assert.rejects(buyer.reviewQuote({ ...signed, quote: toFeedUnits(1) }), (e) => revertName(e) === "BadSellerSignature");
    assert.equal((await buyer.reviewQuote(signed)).score, 100);
    await assert.rejects(buyer.reviewQuote(signed), (e) => revertName(e) === "AlreadyReviewed");
  });

  it("the policy refuses an unlisted recipient, an over-cap amount and a paused agent, by name", async () => {
    const { buyer, guardian, buyerId, sellerAddr, strangerAddr, pub } = await networkHelpers.loadFixture(setup);
    await assert.rejects(buyer.simulatePolicyPay(buyerId, strangerAddr, parseEther("0.0005")), (e) => revertName(e) === "RecipientNotAllowed");
    await assert.rejects(buyer.simulatePolicyPay(buyerId, sellerAddr, parseEther("0.05")), (e) => revertName(e) === "OverPerPaymentCap");
    // the same question asked without the agent's key (read-only client, `from` = the agent's address)
    const reader = new AidaClient(pub as never, buyer.dep);
    const agent = (await buyer.policy(buyerId))!.agent;
    await assert.rejects(reader.simulatePolicyPay(buyerId, strangerAddr, parseEther("0.0005"), agent), (e) => revertName(e) === "RecipientNotAllowed");
    await reader.simulatePolicyPay(buyerId, sellerAddr, parseEther("0.0005"), agent);
    // sent anyway (a compromised bot would): mined as a reverted transaction, no money moves
    const before = (await buyer.policy(buyerId))!.balance;
    const forced = await buyer.forcePolicyPay(buyerId, strangerAddr, parseEther("0.0005"), nonceToData("attack") as Hex);
    assert.equal(forced.reverted, true);
    assert.equal((await buyer.policy(buyerId))!.balance, before);
    await guardian.setPolicyPaused(buyerId, true);
    await assert.rejects(buyer.simulatePolicyPay(buyerId, sellerAddr, parseEther("0.0005")), (e) => revertName(e) === "AgentPaused");
    await assert.rejects(buyer.setPolicyPaused(buyerId, false), (e) => revertName(e) === "NotGuardian");
  });
});
