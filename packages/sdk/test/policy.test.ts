import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { encodeAbiParameters, encodeEventTopics } from "viem";
import { agentPolicyAbi } from "../src/abi.ts";
import { buildRequirements, nonceToData, verifyPolicyPayment } from "../src/x402.ts";

const POLICY = "0x1111111111111111111111111111111111111111";
const PAY_TO = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const HASH = ("0x" + "cd".repeat(32)) as `0x${string}`;
const req = buildRequirements({ payTo: PAY_TO, price: 500n, chainId: 43113, network: "avalanche-fuji", resource: "/quote", nonce: "n7" });

function paidLog(o: Partial<{ address: string; agentId: bigint; to: string; amount: bigint; ref: `0x${string}` }> = {}) {
  const e = { address: POLICY, agentId: 5n, to: PAY_TO, amount: 500n, ref: nonceToData("n7"), ...o };
  const topics = encodeEventTopics({ abi: agentPolicyAbi, eventName: "Paid", args: { agentId: e.agentId, to: e.to as `0x${string}` } });
  const data = encodeAbiParameters([{ type: "uint256" }, { type: "bytes32" }], [e.amount, e.ref]);
  return { address: e.address, topics: topics as `0x${string}`[], data };
}
const chain = (logs: ReturnType<typeof paidLog>[], status = "success") => ({
  getTransaction: async () => ({ to: POLICY, value: 0n, from: PAY_TO }),
  getTransactionReceipt: async () => ({ status, logs }),
});
const pay = { txHash: HASH, nonce: "n7" };

describe("verifyPolicyPayment (L4: payments through AgentPolicy)", () => {
  it("accepts a matching Paid event from the policy contract", async () => {
    assert.deepEqual(await verifyPolicyPayment(chain([paidLog()]), pay, req, POLICY, 5n, new Set()), { ok: true });
  });
  it("rejects a reused tx hash", async () => {
    const used = new Set<string>();
    await verifyPolicyPayment(chain([paidLog()]), pay, req, POLICY, 5n, used);
    assert.equal((await verifyPolicyPayment(chain([paidLog()]), pay, req, POLICY, 5n, used)).ok, false);
  });
  const bad: [string, ReturnType<typeof paidLog>][] = [
    ["another agent paid", paidLog({ agentId: 9n })],
    ["wrong recipient", paidLog({ to: "0x0000000000000000000000000000000000000002" })],
    ["too little", paidLog({ amount: 499n })],
    ["other nonce", paidLog({ ref: nonceToData("other") })],
    ["event from another contract", paidLog({ address: "0x2222222222222222222222222222222222222222" })],
  ];
  for (const [name, log] of bad) {
    it(`rejects: ${name}`, async () => {
      const used = new Set<string>();
      const r = await verifyPolicyPayment(chain([log]), pay, req, POLICY, 5n, used);
      assert.equal(r.ok, false);
      assert.equal(used.size, 0, "failed checks release the tx hash");
    });
  }
  it("rejects a reverted tx and a direct transfer without a Paid event", async () => {
    assert.equal((await verifyPolicyPayment(chain([paidLog()], "reverted"), pay, req, POLICY, 5n, new Set())).ok, false);
    assert.equal((await verifyPolicyPayment(chain([]), pay, req, POLICY, 5n, new Set())).ok, false);
  });
  it("rejects a nonce that differs from the challenge", async () => {
    assert.equal((await verifyPolicyPayment(chain([paidLog()]), { txHash: HASH, nonce: "zz" }, req, POLICY, 5n, new Set())).ok, false);
  });
});
