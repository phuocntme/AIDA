import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentView, Hex } from "@aida/sdk";
import { createTools, type Registry } from "../src/tools.ts";

const card = (name: string, description = "") => ({
  type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1" as const,
  name,
  description,
  endpoints: [{ name: "http", endpoint: `https://${name.toLowerCase().replace(/\W+/g, "")}.example/api` }],
  wallet: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Hex,
});
const view = (id: bigint, name: string, count: bigint, average: bigint, description = ""): AgentView => ({
  agentId: id,
  owner: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  uri: "data:",
  card: card(name, description),
  cardErrors: [],
  count,
  average,
});

const agents = [view(1n, "AVAX Price Pro", 2n, 90n, "signed AVAX/USD quote"), view(2n, "FastQuote", 2n, 20n, "cached quote"), view(4n, "Newcomer", 0n, 0n)];
const ALLOWED = "0x00000000000000000000000000000000000000b2";
const simulated: { to: string; amount: bigint; from: string }[] = [];
const registry: Registry = {
  list: async () => agents,
  resolve: async (id) => agents.find((a) => a.agentId === id) ?? null,
  feedback: async () => [{ reviewerAgentId: 5n, client: "0x90F79bf6EB2c4f870365E785982E1f101E93b906", score: 92, checked: true, tag: "price-accuracy", timestamp: 1n, quote: 7, feedPrice: 7, feedUpdatedAt: 1n, ref: "0x00" }],
  validations: async () => [],
  policy: async (id) => (id === 1n ? ({ agentId: 1n, agent: "0x00000000000000000000000000000000000000a1", paused: false } as never) : null),
  simulatePolicyPay: async (_id, to, amount, from) => {
    simulated.push({ to, amount, from });
    if (to.toLowerCase() !== ALLOWED) throw new Error("RecipientNotAllowed");
    if (amount > 2000n) throw new Error("OverPerPaymentCap");
  },
};

describe("MCP tools", () => {
  it("search_agents filters by text and minimum trust, best first", async () => {
    const t = createTools(registry);
    const all = await t.searchAgents({});
    assert.deepEqual(
      all.map((a) => a.name),
      ["AVAX Price Pro", "FastQuote", "Newcomer"],
    );
    const trusted = await t.searchAgents({ minTrust: 60 });
    assert.deepEqual(
      trusted.map((a) => a.name),
      ["AVAX Price Pro"],
    );
    const text = await t.searchAgents({ query: "cached" });
    assert.deepEqual(
      text.map((a) => a.agentId),
      ["2"],
    );
  });

  it("get_agent returns card, trust, reviews; errors for unknown ids", async () => {
    const t = createTools(registry);
    const a = await t.getAgent({ agentId: "1" });
    assert.equal(a.name, "AVAX Price Pro");
    assert.equal(a.trust.average, 90);
    assert.deepEqual(a.reviews, [{ reviewerAgentId: "5", score: 92, chainlinkChecked: true, tag: "price-accuracy" }]);
    await assert.rejects(t.getAgent({ agentId: "99" }), /not registered/);
    await assert.rejects(t.getAgent({ agentId: "abc" }), /agentId/);
  });

  it("check_trust gives an allow/deny decision with a reason", async () => {
    const t = createTools(registry);
    assert.deepEqual(await t.checkTrust({ agentId: "1", minTrust: 60 }), { agentId: "1", name: "AVAX Price Pro", decision: "allow", reason: "trust 90 ≥ 60 (2 reviews)" });
    assert.equal((await t.checkTrust({ agentId: "2", minTrust: 60 })).decision, "deny");
    assert.match((await t.checkTrust({ agentId: "4" })).reason, /no reviews/);
  });

  it("check_payment asks AgentPolicy from the agent's own address and never writes", async () => {
    const t = createTools(registry, { revertName: (e) => (e as Error).message });
    const ok = await t.checkPayment({ agentId: "1", to: ALLOWED, amountWei: "500" });
    assert.equal(ok.decision, "allow");
    assert.deepEqual(simulated.at(-1), { to: ALLOWED, amount: 500n, from: "0x00000000000000000000000000000000000000a1" });
    const stranger = await t.checkPayment({ agentId: "1", to: "0x00000000000000000000000000000000000000ee", amountWei: "500" });
    assert.equal(stranger.decision, "deny");
    assert.match(stranger.reason, /RecipientNotAllowed/);
    const tooMuch = await t.checkPayment({ agentId: "1", to: ALLOWED, amountWei: "5000" });
    assert.match(tooMuch.reason, /OverPerPaymentCap/);
    assert.equal((await t.checkPayment({ agentId: "2", to: ALLOWED, amountWei: "1" })).reason, "this agent has no AgentPolicy");
    await assert.rejects(t.checkPayment({ agentId: "1", to: "nope", amountWei: "1" }), /0x address/);
    await assert.rejects(t.checkPayment({ agentId: "1", to: ALLOWED, amountWei: "-1" }), /amountWei/);
  });

});
