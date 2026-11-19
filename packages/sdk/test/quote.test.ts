import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import { fromFeedUnits, quoteDigest, quoteSigner, toFeedUnits } from "../src/client.ts";
import { nonceToData } from "../src/x402.ts";

const REVIEWS = "0x1111111111111111111111111111111111111111";
const seller = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const q = { agentId: 7n, quote: toFeedUnits(6.9587), quotedAt: 1_800_000_000, ref: nonceToData("n1") };

describe("signed quotes (what PaidReviews.reviewQuote verifies)", () => {
  it("converts USD to feed units and back", () => {
    assert.equal(toFeedUnits(6.9587), 695870000n);
    assert.equal(fromFeedUnits(695870000n), 6.9587);
  });
  it("recovers the seller from its signature", async () => {
    const signature = await seller.signMessage({ message: { raw: quoteDigest(REVIEWS, 43113, q) } });
    assert.equal(await quoteSigner(REVIEWS, 43113, { ...q, signature }), seller.address);
  });
  it("a changed price, payment, agent, chain or contract no longer recovers the seller", async () => {
    const signature = await seller.signMessage({ message: { raw: quoteDigest(REVIEWS, 43113, q) } });
    const variants = [
      quoteSigner(REVIEWS, 43113, { ...q, quote: q.quote + 1n, signature }),
      quoteSigner(REVIEWS, 43113, { ...q, ref: nonceToData("n2"), signature }),
      quoteSigner(REVIEWS, 43113, { ...q, agentId: 8n, signature }),
      quoteSigner(REVIEWS, 43114, { ...q, signature }),
      quoteSigner("0x2222222222222222222222222222222222222222", 43113, { ...q, signature }),
    ];
    for (const who of await Promise.all(variants)) assert.notEqual(who, seller.address);
  });
  it("returns null for a malformed signature", async () => {
    assert.equal(await quoteSigner(REVIEWS, 43113, { ...q, signature: "0x1234" }), null);
  });
});
