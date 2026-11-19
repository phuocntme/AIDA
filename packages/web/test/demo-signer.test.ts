import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { encodeFunctionData } from "viem";
import { agentPolicyAbi } from "@aida/sdk";
import { checkSignerRequest, type SignerConfig, type SignerRequest } from "../demo-signer.ts";

const POLICY = "0xe6bdbc6c22440a64ef8ab984cc01d82d5de1e961";
const cfg: SignerConfig = { token: "t".repeat(48), origins: ["http://127.0.0.1:5181", "http://localhost:5181"], policy: POLICY, agentId: 312n };
const call = (functionName: string, args: unknown[]) => encodeFunctionData({ abi: agentPolicyAbi, functionName, args } as never);
const pause = call("setPaused", [312n, true]);
const req = (over: Partial<SignerRequest> & { h?: Record<string, string | undefined>; msg?: unknown } = {}): SignerRequest => ({
  method: over.method ?? "POST",
  headers: { origin: "http://127.0.0.1:5181", "content-type": "application/json", "x-aida-signer-token": cfg.token, ...over.h },
  body: over.body ?? JSON.stringify(over.msg ?? { action: "send", to: POLICY, data: pause }),
});
const status = (r: SignerRequest) => {
  const d = checkSignerRequest(r, cfg);
  return d.ok ? 200 : d.status;
};

describe("demo signer request checks", () => {
  it("accepts setPaused for the demo agent from the page's own origin with the token", () => {
    assert.deepEqual(checkSignerRequest(req(), cfg), { ok: true, action: "send", to: POLICY, data: pause });
    assert.equal(status(req({ msg: { action: "send", to: POLICY, data: call("setPaused", [312n, false]) } })), 200);
    assert.deepEqual(checkSignerRequest(req({ msg: { action: "address" } }), cfg), { ok: true, action: "address" });
  });
  it("refuses a missing or wrong token", () => {
    assert.equal(status(req({ h: { "x-aida-signer-token": undefined } })), 401);
    assert.equal(status(req({ h: { "x-aida-signer-token": "x".repeat(48) } })), 401);
    assert.equal(status(req({ h: { "x-aida-signer-token": "short" } })), 401);
  });
  it("refuses a missing, foreign or cross-site origin", () => {
    assert.equal(status(req({ h: { origin: undefined } })), 403);
    assert.equal(status(req({ h: { origin: "https://evil.example" } })), 403);
    assert.equal(status(req({ h: { origin: "http://127.0.0.1:5181.evil.example" } })), 403);
    assert.equal(status(req({ h: { "sec-fetch-site": "cross-site" } })), 403);
  });
  it("refuses anything that is not a JSON POST", () => {
    assert.equal(status(req({ method: "GET" })), 405);
    assert.equal(status(req({ h: { "content-type": "text/plain" } })), 415);
    assert.equal(status(req({ h: { "content-type": undefined } })), 415);
    assert.equal(status(req({ body: "not json" })), 400);
  });
  it("signs nothing but setPaused: no withdraw, limits, whitelist, guardian, operator or pay", () => {
    const stranger = "0x000000000000000000000000000000000000dEaD";
    const others = [
      call("withdraw", [312n, 1n]),
      call("setLimits", [312n, 10n ** 18n, 10n ** 18n]),
      call("setRecipient", [312n, stranger, true]),
      call("setGuardian", [312n, stranger]),
      call("setOperator", [312n, stranger]),
      call("rebindAgent", [312n]),
      call("pay", [312n, stranger, 1n, `0x${"00".repeat(32)}`]),
      "0xdeadbeef",
    ];
    for (const data of others) assert.equal(status(req({ msg: { action: "send", to: POLICY, data } })), 403, data.slice(0, 10));
  });
  it("refuses another agent's policy and another contract", () => {
    assert.equal(status(req({ msg: { action: "send", to: POLICY, data: call("setPaused", [1n, true]) } })), 403);
    assert.equal(status(req({ msg: { action: "send", to: "0x000000000000000000000000000000000000dEaD", data: pause } })), 403);
    assert.equal(status(req({ msg: { action: "sign", to: POLICY, data: pause } })), 400);
  });
});
