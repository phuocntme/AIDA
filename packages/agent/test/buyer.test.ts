import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentView } from "@aida/sdk";
import { chooseSeller, parseSignedQuote } from "../src/buyer.ts";

const v = (id: bigint, count: bigint, average: bigint): AgentView => ({ agentId: id, owner: "0x0000000000000000000000000000000000000001", uri: "", card: null, cardErrors: [], count, average, checked: 0n });

describe("chooseSeller (Treasury Bot policy)", () => {
  it("tries a newcomer before anyone else", () => {
    const r = chooseSeller([v(2n, 3n, 99n), v(3n, 0n, 0n)], new Set(), 1);
    assert.equal(r.pick?.agentId, 3n);
    assert.match(r.why, /newcomer/);
  });
  it("hires the most trusted seller otherwise", () => {
    const r = chooseSeller([v(2n, 3n, 99n), v(3n, 1n, 86n)], new Set([2n, 3n]), 2);
    assert.equal(r.pick?.agentId, 2n);
  });
  it("re-checks the runner-up every third round while it has few reviews", () => {
    const r = chooseSeller([v(2n, 3n, 99n), v(3n, 1n, 86n)], new Set([2n, 3n]), 3);
    assert.equal(r.pick?.agentId, 3n);
    assert.match(r.why, /runner-up/);
  });
  it("never hires a seller below 60 after 2+ reviews, and reports the skip", () => {
    const r = chooseSeller([v(2n, 3n, 99n), v(3n, 2n, 41n)], new Set([2n, 3n]), 3);
    assert.equal(r.pick?.agentId, 2n);
    assert.deepEqual(
      r.skipped.map((s) => s.agentId),
      [3n],
    );
  });
  it("returns null when nobody is trustworthy", () => {
    const r = chooseSeller([v(3n, 2n, 20n)], new Set([3n]), 1);
    assert.equal(r.pick, null);
  });
});

import { checkPayment, endpointAllowed } from "../src/buyer.ts";
import type { PaymentRequirement } from "@aida/sdk";

describe("Treasury Bot spending policy", () => {
  const seller = { ...v(2n, 3n, 99n), owner: "0x00000000000000000000000000000000000000aa" as const, card: { type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1" as const, name: "P", description: "", endpoints: [], wallet: "0x00000000000000000000000000000000000000bb" as const } };
  const req = (o: Partial<PaymentRequirement> = {}): PaymentRequirement => ({ scheme: "exact", network: "avalanche-fuji", chainId: 43113, asset: "native", maxAmountRequired: "500000000000000", payTo: "0x00000000000000000000000000000000000000BB", resource: "/quote", nonce: "n", ...o });
  const policy = { maxWei: 1_000_000_000_000_000n, budgetWei: 2_000_000_000_000_000n, chainId: 43113 };
  it("accepts a price within the cap, paid to the seller's registered wallet, on Fuji", () => {
    assert.deepEqual(checkPayment(req(), seller, policy, 0n), { ok: true });
    assert.deepEqual(checkPayment(req({ payTo: "0x00000000000000000000000000000000000000aa" }), seller, policy, 0n), { ok: true });
  });
  it("refuses an over-cap price, a foreign payTo, a wrong chain, or a blown budget", () => {
    assert.match((checkPayment(req({ maxAmountRequired: "2000000000000000" }), seller, policy, 0n) as { reason: string }).reason, /cap/);
    assert.match((checkPayment(req({ payTo: "0x00000000000000000000000000000000000000cc" }), seller, policy, 0n) as { reason: string }).reason, /payTo/);
    assert.match((checkPayment(req({ chainId: 1 }), seller, policy, 0n) as { reason: string }).reason, /chain/);
    assert.match((checkPayment(req(), seller, policy, 1_800_000_000_000_000n) as { reason: string }).reason, /budget/);
  });
});

describe("endpointAllowed", () => {
  it("only allows http(s) URLs on allowlisted hosts", () => {
    assert.equal(endpointAllowed("http://127.0.0.1:8791/quote", ["127.0.0.1"]), true);
    assert.equal(endpointAllowed("http://169.254.169.254/latest", ["127.0.0.1"]), false);
    assert.equal(endpointAllowed("file:///etc/passwd", ["127.0.0.1"]), false);
    assert.equal(endpointAllowed("not a url", ["127.0.0.1"]), false);
  });
});

import { ContractFunctionRevertedError, encodeErrorResult } from "viem";
import { agentPolicyAbi } from "@aida/sdk";
import { policyReason } from "../src/buyer.ts";

describe("policyReason (AgentPolicy reverts → log line)", () => {
  const revert = (errorName: "AgentPaused" | "OverDailyCap" | "RecipientNotAllowed", args: readonly unknown[]) =>
    new ContractFunctionRevertedError({ abi: agentPolicyAbi, functionName: "pay", data: encodeErrorResult({ abi: agentPolicyAbi, errorName, args } as never) });
  it("names the kill switch, the daily cap and the whitelist", () => {
    assert.equal(policyReason(revert("AgentPaused", [5n])), "paused by guardian (kill switch)");
    assert.equal(policyReason(revert("OverDailyCap", [1n, 2n, 3n])), "daily spending cap reached");
    assert.equal(policyReason(revert("RecipientNotAllowed", [5n, "0x0000000000000000000000000000000000000001"])), "recipient not on the whitelist");
  });
  it("returns null for errors that are not policy reverts", () => {
    assert.equal(policyReason(new Error("network down")), null);
  });
});

describe("parseSignedQuote (untrusted seller response)", () => {
  const ref = ("0x" + "ab".repeat(32)) as `0x${string}`;
  const sig = "0x" + "11".repeat(65);
  it("turns a well-formed response into what PaidReviews.reviewQuote takes", () => {
    assert.deepEqual(parseSignedQuote({ price: 6.9587, at: 1800000000, signature: sig }, 7n, ref), { agentId: 7n, quote: 695870000n, quotedAt: 1800000000, ref, signature: sig });
  });
  it("returns null for a missing or malformed price, time or signature", () => {
    for (const body of [null, {}, { price: "abc", at: 1, signature: sig }, { price: -1, at: 1, signature: sig }, { price: 7, at: 1.5, signature: sig }, { price: 7, at: 1, signature: "0x12" }, { price: 7, at: 1 }]) {
      assert.equal(parseSignedQuote(body, 7n, ref), null);
    }
  });
});
