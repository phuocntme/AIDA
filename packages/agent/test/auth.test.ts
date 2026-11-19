// Caller authentication on the paid route: a 402 challenge (and a slot in an agent's quota) is only given to a
// request signed by the wallet that owns that agent identity.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import { callAuthDigest, encodeCallAuth, encodePayment, nonceToData, type AgentView, type Hex } from "@aida/sdk";
import { createPaidRoute, type PaidDeps } from "../src/paid.ts";

const victim = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const attacker = privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a");
const PAY_TO = "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc" as Hex;
const TX = ("0x" + "cd".repeat(32)) as Hex;
const AUD = "http://127.0.0.1:8791";
const view = (agentId: bigint, owner: Hex): AgentView => ({ agentId, owner, uri: "data:", card: null, cardErrors: [], count: 0n, average: 0n, checked: 0n });
const agents = new Map([[7n, view(7n, victim.address)], [9n, view(9n, attacker.address)]]);
let lastNonce = "";
let clock = 1_800_000_000_000;
let n = 0;

function route(over: Partial<PaidDeps> = {}) {
  const d: PaidDeps = {
    registry: { resolve: async (id) => agents.get(id) ?? null, feedback: async () => [] },
    chain: { getTransaction: async () => ({ to: PAY_TO, value: 10n, from: victim.address, input: nonceToData(lastNonce) }), getTransactionReceipt: async () => ({ status: "success" }) },
    callerAuth: { audience: AUD, maxFailuresPerMinute: 1000 },
    payTo: PAY_TO,
    priceWei: 10n,
    chainId: 43113,
    network: "avalanche-fuji",
    limits: { maxOpen: 100, maxPerCaller: 2 },
    now: () => clock,
    ...over,
  };
  return createPaidRoute(d, { route: /^\/quote$/, usage: "GET /quote", description: "q", minScore: null, produce: async () => ({ ok: true }) });
}
/** A fresh X-Agent-Auth header, by default exactly what the real agent would send. */
async function auth(o: { key?: typeof victim; agentId?: bigint; audience?: string; path?: string; chainId?: number; ts?: number } = {}) {
  const ts = o.ts ?? Math.floor(clock / 1000);
  const nonce = (++n).toString(16).padStart(24, "0");
  const digest = callAuthDigest({ chainId: o.chainId ?? 43113, agentId: o.agentId ?? 7n, audience: o.audience ?? AUD, path: o.path ?? "/quote" }, ts, nonce);
  return encodeCallAuth({ ts, nonce, sig: await (o.key ?? victim).signMessage({ message: { raw: digest } }) });
}
const call = (r: ReturnType<typeof route>, header: string | undefined, extra: Record<string, string> = {}, client = "10.0.0.1") => r.handle("/quote", { "x-agent-id": "7", ...(header ? { "x-agent-auth": header } : {}), ...extra }, client);

describe("caller authentication (X-Agent-Auth)", () => {
  it("gives a challenge to the wallet that owns the agent", async () => {
    const res = await call(route(), await auth());
    assert.equal(res.status, 402);
  });

  it("refuses a request with no signature, a wrong key, or a signature made for something else", async () => {
    const r = route();
    const bad: [string, string | undefined][] = [
      ["no header", undefined],
      ["not base64 JSON", "@@@"],
      ["another wallet claims agent 7", await auth({ key: attacker })],
      ["the attacker's own agent id, replayed as 7", await auth({ key: attacker, agentId: 9n })],
      ["signed for another seller", await auth({ audience: "http://127.0.0.1:8792" })],
      ["signed for another path", await auth({ path: "/report/1" })],
      ["signed for another chain", await auth({ chainId: 43114 })],
      ["stale", await auth({ ts: Math.floor(clock / 1000) - 121 })],
      ["from the future", await auth({ ts: Math.floor(clock / 1000) + 121 })],
    ];
    for (const [name, header] of bad) {
      const res = await call(r, header);
      assert.equal(res.status, 401, name);
      assert.equal(res.body.accepts, undefined, `${name}: no challenge is issued`);
    }
  });

  it("a signed header cannot be replayed", async () => {
    const r = route();
    const header = await auth();
    assert.equal((await call(r, header)).status, 402);
    const again = await call(r, header);
    assert.equal(again.status, 401);
    assert.match(String(again.body.reason), /already used/);
  });

  it("a re-encoded copy of a used signature (high-s, flipped v, upper-case hex) is still a replay", async () => {
    const r = route();
    const header = await auth();
    assert.equal((await call(r, header)).status, 402);
    const { ts, nonce, sig } = JSON.parse(Buffer.from(header, "base64").toString()) as { ts: number; nonce: string; sig: `0x${string}` };
    const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
    const rHex = sig.slice(2, 66);
    const sFlipped = (N - BigInt(`0x${sig.slice(66, 130)}`)).toString(16).padStart(64, "0");
    const vFlipped = (parseInt(sig.slice(130, 132), 16) === 27 ? 28 : 27).toString(16);
    const variants = [`0x${rHex}${sFlipped}${vFlipped}`, `0x${sig.slice(2).toUpperCase()}`];
    for (const v of variants) {
      const res = await call(r, encodeCallAuth({ ts, nonce, sig: v as `0x${string}` }));
      assert.equal(res.status, 401, v);
      assert.equal(res.body.accepts, undefined, "no second challenge for the same authorisation");
    }
  });

  it("a spoofer cannot use up another agent's challenge slots; the real agent is still served", async () => {
    const r = route(); // 2 open challenges per agent
    for (let i = 0; i < 25; i++) {
      assert.equal((await call(r, undefined, {}, "6.6.6.6")).status, 401);
      assert.equal((await call(r, await auth({ key: attacker }), {}, "6.6.6.6")).status, 401);
    }
    // agent 7 still has both of its slots
    const first = await call(r, await auth());
    assert.equal(first.status, 402);
    assert.equal((await call(r, await auth())).status, 402);
    assert.equal((await call(r, await auth())).status, 429, "only the agent's own signed requests count against its quota");
    // and it can pay the first challenge and be served
    const nonce = (first.body.accepts as { nonce: string }[])[0].nonce;
    lastNonce = nonce;
    const served = await call(r, await auth(), { "x-payment": encodePayment({ txHash: TX, nonce }) });
    assert.equal(served.status, 200);
  });

  it("the attacker filling its own agent's slots does not touch another agent", async () => {
    const r = route();
    const asAttacker = async () => r.handle("/quote", { "x-agent-id": "9", "x-agent-auth": await auth({ key: attacker, agentId: 9n }) }, "6.6.6.6");
    assert.deepEqual([(await asAttacker()).status, (await asAttacker()).status, (await asAttacker()).status], [402, 402, 429]);
    assert.equal((await call(r, await auth())).status, 402);
  });

  it("unauthenticated requests are limited per client address, not per claimed agent", async () => {
    const r = route({ callerAuth: { audience: AUD, maxFailuresPerMinute: 3 } });
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await call(r, undefined, {}, "6.6.6.6")).status);
    assert.deepEqual(codes, [401, 401, 401, 429, 429]);
    assert.equal((await call(r, await auth(), {}, "10.0.0.1")).status, 402, "another address, same agent id: served");
    clock += 61_000;
    assert.equal((await call(r, undefined, {}, "6.6.6.6")).status, 401, "the window resets after a minute");
    clock -= 61_000;
  });
});
