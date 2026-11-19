import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { encodePayment, nonceToData, type AgentView, type Hex } from "@aida/sdk";
import { createOracle, verdictFor, type OracleDeps } from "../src/oracle.ts";
import { createPaidRoute, guardedNewcomerOk } from "../src/paid.ts";

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
  checked: 0n,
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
    callerAuth: false, // the checks below are tested without signatures; authentication has its own suite (auth.test.ts)
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

describe("Paid route with AgentPolicy (L4)", () => {
  const POLICY = "0x1111111111111111111111111111111111111111" as Hex;
  it("rejects a direct transfer from an agent that runs behind a policy", async () => {
    const o = createOracle(deps({ policy: { address: POLICY, covers: async (id) => id === 1n } }));
    const challenge = await o.handle("/report/2", { "x-agent-id": "1" });
    const nonce = (challenge.body.accepts as { nonce: string }[])[0].nonce;
    lastNonce = nonce;
    const r = await o.handle("/report/2", { "x-agent-id": "1", "x-payment": encodePayment({ txHash: TX, nonce }) });
    assert.equal(r.status, 402);
    assert.match(String(r.body.error), /AgentPolicy Paid event/);
  });
  it("still accepts direct payments from agents without a policy", async () => {
    const o = createOracle(deps({ policy: { address: POLICY, covers: async () => false } }));
    const challenge = await o.handle("/report/2", { "x-agent-id": "1" });
    const nonce = (challenge.body.accepts as { nonce: string }[])[0].nonce;
    lastNonce = nonce;
    const r = await o.handle("/report/2", { "x-agent-id": "1", "x-payment": encodePayment({ txHash: TX, nonce }) });
    assert.equal(r.status, 200);
  });
});

describe("Trust Oracle gate for newcomers behind a policy", () => {
  const POLICY = "0x1111111111111111111111111111111111111111" as Hex;
  const GUARDIAN = "0x00000000000000000000000000000000000000aa" as Hex;
  const STRANGER = "0x00000000000000000000000000000000000000bb" as Hex;
  const BOT = "0x00000000000000000000000000000000000000cc" as Hex;
  const newcomer = view(4n, OWNER_SPAM, 0n, 0n);
  const info = (guardian: Hex, balance = 10n) => ({ guardian, agent: BOT, balance });
  const oracleWith = (i: ReturnType<typeof info> | null) => createOracle(deps({ admitGuarded: { guardians: [GUARDIAN] }, policy: { address: POLICY, covers: async () => i !== null, info: async () => i } }));

  it("admits a newcomer whose funded policy has a guardian this seller knows", async () => {
    assert.equal((await oracleWith(info(GUARDIAN)).handle("/report/1", { "x-agent-id": "4" })).status, 402);
    assert.deepEqual(guardedNewcomerOk(newcomer, info(GUARDIAN), [GUARDIAN], 10n), { ok: true });
  });
  it("refuses a fresh agent that guards itself: merely having a policy is not enough", async () => {
    assert.equal((await oracleWith(info(BOT)).handle("/report/1", { "x-agent-id": "4" })).status, 403);
    assert.equal((await oracleWith(info(OWNER_SPAM)).handle("/report/1", { "x-agent-id": "4" })).status, 403);
    // even if the self-guarding wallet were on the allowlist
    assert.match(String((guardedNewcomerOk(newcomer, info(BOT), [BOT], 10n) as { reason: string }).reason), /self-guarded/);
    assert.match(String((guardedNewcomerOk(newcomer, info(OWNER_SPAM), [OWNER_SPAM], 10n) as { reason: string }).reason), /self-guarded/);
  });
  it("refuses an unknown guardian, an unfunded policy and a caller without a policy", async () => {
    assert.equal((await oracleWith(info(STRANGER)).handle("/report/1", { "x-agent-id": "4" })).status, 403);
    assert.equal((await oracleWith(info(GUARDIAN, 9n)).handle("/report/1", { "x-agent-id": "4" })).status, 403);
    assert.equal((await oracleWith(null).handle("/report/1", { "x-agent-id": "4" })).status, 403);
  });
  it("a policy does not excuse a bad reputation", async () => {
    assert.equal((await oracleWith(info(GUARDIAN)).handle("/report/1", { "x-agent-id": "2" })).status, 403);
    assert.equal(guardedNewcomerOk(view(2n, OWNER_SPAM, 2n, 20n), info(GUARDIAN), [GUARDIAN], 10n).ok, false);
  });
});

describe("open payment challenges", () => {
  const quote = (over: Partial<OracleDeps> = {}) => createPaidRoute(deps(over), { route: /^\/quote$/, usage: "GET /quote", description: "q", minScore: null, produce: async () => ({ ok: true }) });
  const nonceOf = (r: { body: Record<string, unknown> }) => (r.body.accepts as { nonce: string }[])[0].nonce;

  it("spam never evicts a live challenge: the caller who already paid is still served", async () => {
    const route = quote({ limits: { maxOpen: 6, maxPerCaller: 3 } });
    const paidFor = nonceOf(await route.handle("/quote", { "x-agent-id": "1" }));
    // another caller id floods the route until it is refused, then a third fills the map
    const codes: number[] = [];
    for (let i = 0; i < 10; i++) codes.push((await route.handle("/quote", { "x-agent-id": "2" })).status);
    for (let i = 0; i < 10; i++) codes.push((await route.handle("/quote", { "x-agent-id": "4" })).status);
    assert.deepEqual(codes.slice(0, 4), [402, 402, 402, 429]);
    assert.ok(codes.includes(503), "a full map refuses new challenges instead of dropping live ones");
    lastNonce = paidFor;
    const served = await route.handle("/quote", { "x-agent-id": "1", "x-payment": encodePayment({ txHash: TX, nonce: paidFor }) });
    assert.equal(served.status, 200);
  });
  it("caps open challenges per caller id", async () => {
    const route = quote({ limits: { maxOpen: 100, maxPerCaller: 2 } });
    assert.equal((await route.handle("/quote", { "x-agent-id": "1" })).status, 402);
    assert.equal((await route.handle("/quote", { "x-agent-id": "1" })).status, 402);
    const third = await route.handle("/quote", { "x-agent-id": "1" });
    assert.equal(third.status, 429);
    assert.equal(third.headers?.["Retry-After"], "60");
    assert.equal((await route.handle("/quote", { "x-agent-id": "2" })).status, 402, "other callers are not affected");
  });
  it("expired challenges make room again and can no longer be paid", async () => {
    let t = 1_000_000;
    const route = quote({ limits: { maxOpen: 2, maxPerCaller: 2 }, now: () => t });
    const old = nonceOf(await route.handle("/quote", { "x-agent-id": "1" }));
    assert.equal((await route.handle("/quote", { "x-agent-id": "1" })).status, 402);
    assert.equal((await route.handle("/quote", { "x-agent-id": "2" })).status, 503);
    t += 10 * 60 * 1000 + 1;
    assert.equal((await route.handle("/quote", { "x-agent-id": "2" })).status, 402);
    lastNonce = old;
    const late = await route.handle("/quote", { "x-agent-id": "1", "x-payment": encodePayment({ txHash: TX, nonce: old }) });
    assert.equal(late.status, 402);
    assert.match(String(late.body.error), /unknown or expired nonce/);
  });
});

describe("paid route → produce", () => {
  it("hands the payment reference (keccak256 of the nonce) to the seller, so it can sign it into its quote", async () => {
    let got: { ref: Hex; txHash: Hex } | null = null;
    const route = createPaidRoute(deps(), { route: /^\/quote$/, usage: "GET /quote", description: "q", minScore: null, produce: async (_m, _c, paid) => ((got = paid), { ok: true }) });
    const challenge = await route.handle("/quote", { "x-agent-id": "1" });
    const nonce = (challenge.body.accepts as { nonce: string }[])[0].nonce;
    lastNonce = nonce;
    const r = await route.handle("/quote", { "x-agent-id": "1", "x-payment": encodePayment({ txHash: TX, nonce }) });
    assert.equal(r.status, 200);
    assert.deepEqual(got, { ref: nonceToData(nonce), txHash: TX });
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
