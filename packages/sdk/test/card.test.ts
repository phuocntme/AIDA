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

  it("writes the ERC-8004 registration shape (services) and still reads older cards that say endpoints", () => {
    const file = JSON.parse(atob(encodeCardURI(good).split(",")[1]));
    assert.deepEqual(Object.keys(file).sort(), ["active", "description", "name", "services", "supportedTrust", "type", "wallet", "x402Support"]);
    assert.equal(file.services[0].endpoint, "https://agent.example/a2a");
    assert.equal(file.x402Support, false);
    const legacy = "data:application/json;base64," + btoa(JSON.stringify({ ...good, name: "Old card", description: "" }));
    const r = decodeCardURI(legacy);
    assert.equal(r.ok && r.card.endpoints[0].name, "A2A");
  });

  it("returns an error (never throws) for garbage URIs", () => {
    assert.equal(decodeCardURI("data:application/json;base64,!!!").ok, false);
    assert.equal(decodeCardURI("ipfs://unsupported").ok, false);
  });
});
