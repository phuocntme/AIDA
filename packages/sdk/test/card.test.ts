import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CARD_TYPE, decodeCardURI, encodeCardURI, validateCard } from "../src/card.ts";

const good = {
  type: CARD_TYPE,
  name: "Trợ lý dịch VN",
  description: "Dịch Anh–Việt cho agent khác",
  endpoints: [{ name: "A2A", endpoint: "https://agent.example/a2a" }],
  wallet: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
};

describe("validateCard (R2)", () => {
  it("accepts a valid card", () => {
    assert.deepEqual(validateCard(good), { ok: true, card: good });
  });

  it("rejects missing name, bad wallet, non-http endpoint, wrong type", () => {
    const r = validateCard({ ...good, type: "x", name: "", wallet: "0x123", endpoints: [{ name: "a", endpoint: "ftp://x" }] });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.ok(r.errors.some((e) => e.includes("type")));
    assert.ok(r.errors.some((e) => e.includes("name")));
    assert.ok(r.errors.some((e) => e.includes("wallet")));
    assert.ok(r.errors.some((e) => e.includes("endpoint")));
  });

  it("rejects a description over 500 chars and non-objects", () => {
    assert.equal(validateCard({ ...good, description: "x".repeat(501) }).ok, false);
    assert.equal(validateCard(null).ok, false);
    assert.equal(validateCard("card").ok, false);
  });
});

describe("card URI encoding (R2)", () => {
  it("round-trips through a base64 data URI, including Vietnamese text", () => {
    const uri = encodeCardURI(good);
    assert.ok(uri.startsWith("data:application/json;base64,"));
    assert.deepEqual(decodeCardURI(uri), { ok: true, card: good });
  });

  it("returns an error (never throws) for garbage URIs", () => {
    assert.equal(decodeCardURI("data:application/json;base64,!!!").ok, false);
    assert.equal(decodeCardURI("ipfs://unsupported").ok, false);
  });
});
