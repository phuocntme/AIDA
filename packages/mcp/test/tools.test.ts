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

const agents = [view(1n, "TranslatorVN", 2n, 90n, "translation"), view(2n, "SpamBot 9000", 2n, 20n, "airdrop spam"), view(4n, "Newcomer", 0n, 0n)];
const given: unknown[] = [];
const registry: Registry = {
  list: async () => agents,
  resolve: async (id) => agents.find((a) => a.agentId === id) ?? null,
  feedback: async () => [{ client: "0x90F79bf6EB2c4f870365E785982E1f101E93b906", score: 92, tag: "accuracy", uri: "", timestamp: 1n }],
  validations: async () => [],
  giveFeedback: async (id, score, tag) => {
    given.push({ id, score, tag });
    return "0xabc" as Hex;
  },
};

describe("MCP tools", () => {
  it("search_agents filters by text and minimum trust, best first", async () => {
    const t = createTools(registry, { canWrite: false });
    const all = await t.searchAgents({});
    assert.deepEqual(
      all.map((a) => a.name),
      ["TranslatorVN", "SpamBot 9000", "Newcomer"],
    );
    const trusted = await t.searchAgents({ minTrust: 60 });
    assert.deepEqual(
      trusted.map((a) => a.name),
      ["TranslatorVN"],
    );
    const text = await t.searchAgents({ query: "spam" });
    assert.deepEqual(
      text.map((a) => a.agentId),
      ["2"],
    );
  });

  it("get_agent returns card, trust, reviews; errors for unknown ids", async () => {
    const t = createTools(registry, { canWrite: false });
    const a = await t.getAgent({ agentId: "1" });
    assert.equal(a.name, "TranslatorVN");
    assert.equal(a.trust.average, 90);
    assert.equal(a.reviews.length, 1);
    await assert.rejects(t.getAgent({ agentId: "99" }), /not registered/);
    await assert.rejects(t.getAgent({ agentId: "abc" }), /agentId/);
  });

  it("check_trust gives an allow/deny decision with a reason", async () => {
    const t = createTools(registry, { canWrite: false });
    assert.deepEqual(await t.checkTrust({ agentId: "1", minTrust: 60 }), { agentId: "1", name: "TranslatorVN", decision: "allow", reason: "trust 90 ≥ 60 (2 reviews)" });
    assert.equal((await t.checkTrust({ agentId: "2", minTrust: 60 })).decision, "deny");
    assert.match((await t.checkTrust({ agentId: "4" })).reason, /no reviews/);
  });

  it("give_feedback writes only when a key is configured, and validates the score", async () => {
    const ro = createTools(registry, { canWrite: false });
    await assert.rejects(ro.giveFeedback({ agentId: "1", score: 90, tag: "speed" }), /AIDA_PRIVATE_KEY/);
    const rw = createTools(registry, { canWrite: true });
    await assert.rejects(rw.giveFeedback({ agentId: "1", score: 101, tag: "x" }), /0-100/);
    const r = await rw.giveFeedback({ agentId: "1", score: 88, tag: "speed" });
    assert.equal(r.txHash, "0xabc");
    assert.deepEqual(given.at(-1), { id: 1n, score: 88, tag: "speed" });
  });
});
