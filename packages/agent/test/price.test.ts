import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { accuracyScore, formatQuoteJob, marketPrice, median, parseQuoteJob, sloppyQuoter, feedIsFresh } from "../src/price.ts";

describe("accuracyScore", () => {
  it("is 100 for an exact quote and drops 12 points per 1% deviation, floored at 0", () => {
    assert.equal(accuracyScore(8.31, 8.31), 100);
    assert.equal(accuracyScore(8.3515, 8.31), 94); // +0.5%
    assert.equal(accuracyScore(8.0607, 8.31), 64); // -3%
    assert.equal(accuracyScore(9.06, 8.31), 0); // +9%
  });
  it("rejects non-positive or non-finite prices with 0", () => {
    assert.equal(accuracyScore(0, 8.31), 0);
    assert.equal(accuracyScore(Number.NaN, 8.31), 0);
    assert.equal(accuracyScore(8.31, 0), 0);
  });
});

describe("median", () => {
  it("works for odd and even lists", () => {
    assert.equal(median([3, 1, 2]), 2);
    assert.equal(median([8.3, 8.4]), 8.35);
  });
});

describe("quote job URI", () => {
  it("round-trips price and timestamp", () => {
    const uri = formatQuoteJob(8.3123, 1794500000);
    assert.equal(uri, "quote://AVAX-USD/8.3123/1794500000");
    assert.deepEqual(parseQuoteJob(uri), { price: 8.3123, ts: 1794500000 });
  });
  it("returns null for anything else", () => {
    assert.equal(parseQuoteJob("job://x"), null);
    assert.equal(parseQuoteJob("quote://AVAX-USD/abc/1"), null);
  });
});

describe("marketPrice", () => {
  it("takes the median of the sources that answered", async () => {
    const fake = (async (url: string) => {
      if (String(url).includes("binance")) return new Response(JSON.stringify({ price: "8.40" }));
      if (String(url).includes("coingecko")) return new Response(JSON.stringify({ "avalanche-2": { usd: 8.3 } }));
      throw new Error("down");
    }) as typeof fetch;
    const r = await marketPrice(fake);
    assert.equal(r.price, 8.35);
    assert.deepEqual(r.sources.sort(), ["binance", "coingecko"]);
  });
  it("throws when no source answers", async () => {
    const down = (async () => {
      throw new Error("down");
    }) as typeof fetch;
    await assert.rejects(marketPrice(down), /no price source/);
  });
});

describe("sloppyQuoter", () => {
  it("keeps a stale base price and is always 4-9% off, up or down", () => {
    const seq = [0, 0, 1, 1, 0.5, 0.2];
    let i = 0;
    const q = sloppyQuoter(10, () => seq[i++ % seq.length]);
    assert.equal(q(), 9.6); // -4%
    assert.equal(q(), 10.9); // +9%
    assert.equal(q(), 9.35); // -6.5%
    const r = sloppyQuoter(10);
    for (let n = 0; n < 200; n++) assert.ok(Math.abs(r() - 10) >= 0.4 - 1e-9);
  });
});

describe("feedIsFresh", () => {
  it("accepts a Chainlink answer up to one hour old", () => {
    assert.equal(feedIsFresh(1000, 1000 + 3600), true);
    assert.equal(feedIsFresh(1000, 1000 + 3601), false);
  });
});
