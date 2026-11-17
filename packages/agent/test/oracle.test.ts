import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { encodePayment, nonceToData, type AgentView, type Hex } from "@aida/sdk";
import { createOracle, verdictFor, type OracleDeps } from "../src/oracle.ts";

const OWNER_TRUSTED = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Hex;
const OWNER_SPAM = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as Hex;
const PAY_TO = "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc" as Hex;
const TX = ("0x" + "cd".repeat(32)) as Hex;
let lastNonce = "";

const view = (agentId: bigint, owner: Hex, count: bigint, average: bigint): AgentView => ({
  agentId,
  owner,
  uri: "data:",
  card: null,
  cardErrors: [],
  count,
  average,
});

const agents = new Map<bigint, AgentView>([
  [1n, view(1n, OWNER_TRUSTED, 2n, 90n)],
  [2n, view(2n, OWNER_SPAM, 2n, 20n)],
  [4n, view(4n, OWNER_SPAM, 0n, 0n)],
]);

function deps(over: Partial<OracleDeps> = {}): OracleDeps {
  return {
    registry: {
      resolve: async (id) => agents.get(id) ?? null,
      feedback: async () => [],
    },
    chain: {
      getTransaction: async () => ({ to: PAY_TO, value: 10n, from: OWNER_TRUSTED, input: nonceToData(lastNonce) }),
      getTransactionReceipt: async () => ({ status: "success" }),
    },
    payTo: PAY_TO,
    priceWei: 10n,
    minScore: 60,
    chainId: 31337,
    network: "localhost",
    ...over,
  };
}

describe("Trust Oracle gate + x402 (R6)", () => {
  it("400 when X-Agent-Id is missing or not a number", async () => {
    const o = createOracle(deps());
    assert.equal((await o.handle("/report/1", {})).status, 400);
    assert.equal((await o.handle("/report/1", { "x-agent-id": "abc" })).status, 400);
  });

  it("404 for unknown caller or target, and for unknown paths", async () => {
    const o = createOracle(deps());
    assert.equal((await o.handle("/report/1", { "x-agent-id": "99" })).status, 404);
    assert.equal((await o.handle("/report/99", { "x-agent-id": "1" })).status, 404);
    assert.equal((await o.handle("/nope", { "x-agent-id": "1" })).status, 404);
  });

  it("403 with the reason when the caller's reputation is too low or empty", async () => {
    const o = createOracle(deps());
    const low = await o.handle("/report/1", { "x-agent-id": "2" });
    assert.equal(low.status, 403);
    assert.match(String(low.body.reason), /reputation 20 < 60/);
    const none = await o.handle("/report/1", { "x-agent-id": "4" });
    assert.equal(none.status, 403);
    assert.match(String(none.body.reason), /no reputation/);
  });

  it("402 with an x402 requirement for a trusted caller without payment", async () => {
    const o = createOracle(deps());
    const r = await o.handle("/report/2", { "x-agent-id": "1" });
    assert.equal(r.status, 402);
    const accepts = r.body.accepts as { payTo: string; maxAmountRequired: string; nonce: string; resource: string }[];
    assert.equal(r.body.x402Version, 1);
    assert.equal(accepts[0].payTo, PAY_TO);
    assert.equal(accepts[0].maxAmountRequired, "10");
    assert.equal(accepts[0].resource, "/report/2");
    assert.ok(accepts[0].nonce.length > 8);
  });

  it("200 with a report after a valid payment; replay is refused", async () => {
    const o = createOracle(deps());
    const challenge = await o.handle("/report/2", { "x-agent-id": "1" });
    const nonce = (challenge.body.accepts as { nonce: string }[])[0].nonce;
    lastNonce = nonce;
    const header = encodePayment({ txHash: TX, nonce });
    const ok = await o.handle("/report/2", { "x-agent-id": "1", "x-payment": header });
    assert.equal(ok.status, 200);
    assert.equal((ok.body.report as { verdict: string }).verdict, "risky");
    assert.ok(ok.headers?.["X-PAYMENT-RESPONSE"]);
    const replay = await o.handle("/report/2", { "x-agent-id": "1", "x-payment": header });
    assert.equal(replay.status, 402);
    assert.match(String(replay.body.error), /unknown or expired nonce|already used/);
  });

  it("402 with the reason when the payment is invalid (e.g. paid by someone else)", async () => {
    const o = createOracle(
      deps({
        chain: {
          getTransaction: async () => ({ to: PAY_TO, value: 10n, from: OWNER_SPAM, input: nonceToData(lastNonce) }),
          getTransactionReceipt: async () => ({ status: "success" }),
        },
      }),
    );
    const challenge = await o.handle("/report/2", { "x-agent-id": "1" });
    const nonce = (challenge.body.accepts as { nonce: string }[])[0].nonce;
    lastNonce = nonce;
    const r = await o.handle("/report/2", { "x-agent-id": "1", "x-payment": encodePayment({ txHash: TX, nonce }) });
    assert.equal(r.status, 402);
    assert.match(String(r.body.error), /payer/);
  });

  it("a nonce issued for one resource cannot pay for another", async () => {
    const o = createOracle(deps());
    const challenge = await o.handle("/report/2", { "x-agent-id": "1" });
    const nonce = (challenge.body.accepts as { nonce: string }[])[0].nonce;
    lastNonce = nonce;
    const r = await o.handle("/report/1", { "x-agent-id": "1", "x-payment": encodePayment({ txHash: TX, nonce }) });
    assert.equal(r.status, 402);
  });
});

describe("verdictFor", () => {
  it("maps reputation to a verdict", () => {
    assert.equal(verdictFor(0n, 0n), "unknown");
    assert.equal(verdictFor(3n, 85n), "trusted");
    assert.equal(verdictFor(3n, 65n), "ok");
    assert.equal(verdictFor(3n, 20n), "risky");
  });
});
