import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentView } from "@aida/sdk";
import { chooseSeller } from "../src/buyer.ts";

const v = (id: bigint, count: bigint, average: bigint): AgentView => ({ agentId: id, owner: "0x0000000000000000000000000000000000000001", uri: "", card: null, cardErrors: [], count, average });

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
