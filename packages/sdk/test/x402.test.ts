import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildRequirements,
  decodePayment,
  encodePayment,
  gateByReputation,
  nonceToData,
  verifyPayment,
  type PaymentRequirement,
} from "../src/x402.ts";

const PAY_TO = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const PAYER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const HASH = ("0x" + "ab".repeat(32)) as `0x${string}`;

const req: PaymentRequirement = buildRequirements({
  payTo: PAY_TO,
  price: 1000n,
  chainId: 31337,
  network: "localhost",
  resource: "/report/1",
  nonce: "n1",
});

function fakeChain(over: Partial<{ to: string; value: bigint; from: string; status: string; input: string }> = {}) {
  const tx = { to: PAY_TO, value: 1000n, from: PAYER, status: "success", input: nonceToData("n1"), ...over };
  return {
    getTransaction: async () => ({ to: tx.to, value: tx.value, from: tx.from, input: tx.input as `0x${string}` }),
    getTransactionReceipt: async () => ({ status: tx.status }),
  };
}

describe("gateByReputation (R6)", () => {
  it("refuses agents with no feedback or average below the minimum", () => {
    assert.deepEqual(gateByReputation({ count: 0n, average: 0n }, 60), { ok: false, reason: "no reputation yet (0 feedback)" });
    assert.deepEqual(gateByReputation({ count: 3n, average: 20n }, 60), { ok: false, reason: "reputation 20 < 60" });
  });
  it("accepts agents at or above the minimum", () => {
    assert.deepEqual(gateByReputation({ count: 2n, average: 60n }, 60), { ok: true });
  });
});

describe("x402 requirements + payment header (R6)", () => {
  it("builds a 402 body with one native 'exact' requirement", () => {
    assert.equal(req.scheme, "exact");
    assert.equal(req.asset, "native");
    assert.equal(req.maxAmountRequired, "1000");
    assert.equal(req.payTo, PAY_TO);
  });
  it("round-trips the X-PAYMENT header and rejects garbage", () => {
    const h = encodePayment({ txHash: HASH, nonce: "n1" });
    assert.deepEqual(decodePayment(h), { ok: true, payment: { txHash: HASH, nonce: "n1" } });
    assert.equal(decodePayment("not-base64-json").ok, false);
    assert.equal(decodePayment(encodePayment({ txHash: "0x12" as `0x${string}`, nonce: "n1" })).ok, false);
  });
});

describe("verifyPayment (R6)", () => {
  it("reserves the tx hash before awaiting, so concurrent double-spend fails", async () => {
    const seen = used();
    const [a, b] = await Promise.all([
      verifyPayment(fakeChain(), { txHash: HASH, nonce: "n1" }, req, PAYER, seen),
      verifyPayment(fakeChain(), { txHash: HASH, nonce: "n1" }, req, PAYER, seen),
    ]);
    assert.equal([a.ok, b.ok].filter(Boolean).length, 1);
  });
  const used = () => new Set<string>();
  it("accepts a successful payment of the right amount to payTo from the expected payer", async () => {
    const r = await verifyPayment(fakeChain(), { txHash: HASH, nonce: "n1" }, req, PAYER, used());
    assert.deepEqual(r, { ok: true });
  });
  it("rejects wrong recipient, low value, wrong payer, failed tx, wrong nonce, replay", async () => {
    const cases: [ReturnType<typeof fakeChain>, string][] = [
      [fakeChain({ to: PAYER }), "recipient"],
      [fakeChain({ value: 999n }), "amount"],
      [fakeChain({ from: PAY_TO }), "payer"],
      [fakeChain({ status: "reverted" }), "failed"],
      [fakeChain({ input: "0x" }), "calldata"],
    ];
    for (const [chain, word] of cases) {
      const r = await verifyPayment(chain, { txHash: HASH, nonce: "n1" }, req, PAYER, used());
      assert.equal(r.ok, false);
      if (!r.ok) assert.ok(r.reason.includes(word), `${r.reason} should mention ${word}`);
    }
    const wrongNonce = await verifyPayment(fakeChain(), { txHash: HASH, nonce: "zz" }, req, PAYER, used());
    assert.equal(wrongNonce.ok, false);
    const seen = used();
    assert.equal((await verifyPayment(fakeChain(), { txHash: HASH, nonce: "n1" }, req, PAYER, seen)).ok, true);
    const replay = await verifyPayment(fakeChain(), { txHash: HASH, nonce: "n1" }, req, PAYER, seen);
    assert.equal(replay.ok, false);
    if (!replay.ok) assert.ok(replay.reason.includes("already used"));
  });
  it("returns an error (never throws) when the chain lookup fails", async () => {
    const broken = {
      getTransaction: async () => {
        throw new Error("not found");
      },
      getTransactionReceipt: async () => ({ status: "success" }),
    };
    const seen = used();
    const r = await verifyPayment(broken, { txHash: HASH, nonce: "n1" }, req, PAYER, seen);
    assert.equal(r.ok, false);
    assert.equal(seen.size, 0, "a failed verification must release the reserved tx hash");
  });
});

describe("caller authentication helpers", async () => {
  const { privateKeyToAccount } = await import("viem/accounts");
  const { callAuthDigest, callAuthSigner, decodeCallAuth, encodeCallAuth, callPaidAgent: call } = await import("../src/x402.ts");
  const agent = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
  const scope = { chainId: 43113, agentId: 312n, audience: "http://127.0.0.1:8791", path: "/quote" };
  const nonce = "00112233445566778899aabb";

  it("recovers the agent's wallet only for the exact scope that was signed", async () => {
    const sig = await agent.signMessage({ message: { raw: callAuthDigest(scope, 1_800_000_000, nonce) } });
    const a = { ts: 1_800_000_000, nonce, sig };
    assert.equal(await callAuthSigner(scope, a), agent.address);
    assert.equal(await callAuthSigner({ ...scope, audience: "HTTP://127.0.0.1:8791" }, a), agent.address, "the audience is case-insensitive");
    for (const other of [{ ...scope, agentId: 1n }, { ...scope, audience: "http://127.0.0.1:8792" }, { ...scope, path: "/report/1" }, { ...scope, chainId: 43114 }]) {
      assert.notEqual(await callAuthSigner(other, a), agent.address);
    }
    assert.notEqual(await callAuthSigner(scope, { ...a, ts: a.ts + 1 }), agent.address);
  });

  it("decodes a header and rejects a bad shape or a timestamp outside the window", () => {
    const header = encodeCallAuth({ ts: 1000, nonce, sig: `0x${"11".repeat(65)}` });
    assert.equal(decodeCallAuth(header, 1000).ok, true);
    assert.equal(decodeCallAuth(header, 1120).ok, true);
    assert.equal(decodeCallAuth(header, 1121).ok, false);
    assert.equal(decodeCallAuth(undefined, 1000).ok, false);
    assert.equal(decodeCallAuth("@@@", 1000).ok, false);
    assert.equal(decodeCallAuth(encodeCallAuth({ ts: 1000, nonce: "x", sig: "0x12" as never }), 1000).ok, false);
  });

  it("callPaidAgent signs every request when given a signer", async () => {
    const seen: (string | null)[] = [];
    let i = 0;
    const fakeFetch = (async (_url: string, init: { headers: Record<string, string> }) => {
      seen.push(init.headers["X-Agent-Auth"] ?? null);
      return new Response(JSON.stringify(i++ === 0 ? { accepts: [{ scheme: "exact", asset: "native", maxAmountRequired: "1", payTo: "0x0000000000000000000000000000000000000001", nonce: "n", resource: "/quote", chainId: 43113, network: "x" }] } : { ok: true }), { status: i === 1 ? 402 : 200 });
    }) as never;
    let calls = 0;
    const r = await call("http://127.0.0.1:8791/quote", 312n, async () => `0x${"ab".repeat(32)}`, fakeFetch, async (to) => `${to.audience}${to.path}#${++calls}`);
    assert.equal(r.ok, true);
    assert.deepEqual(seen, ["http://127.0.0.1:8791/quote#1", "http://127.0.0.1:8791/quote#2"]);
  });
});
