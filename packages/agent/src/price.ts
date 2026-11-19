// Price data for the AVAX/USD agents. The on-chain reference (Chainlink AVAX/USD) is read through the SDK
// (`AidaClient.feedPrice`) and, for reviews, by the PaidReviews contract itself.

/** Same limit as PaidReviews.MAX_FEED_AGE: an older Chainlink answer is not used to judge anyone. */
export const MAX_FEED_AGE_S = 3600;
export const feedIsFresh = (updatedAt: number, now = Date.now() / 1000) => now - updatedAt <= MAX_FEED_AGE_S;

/**
 * 100 for an exact quote, minus 12 points per 1% deviation from the reference, floored at 0.
 * Same rule as PaidReviews.scoreFor; used off-chain by Audit Lab. Review scores come from the contract.
 */
export function accuracyScore(quoted: number, reference: number): number {
  if (!Number.isFinite(quoted) || !Number.isFinite(reference) || quoted <= 0 || reference <= 0) return 0;
  const devPct = (Math.abs(quoted - reference) / reference) * 100;
  return Math.max(0, Math.min(100, Math.round(100 - devPct * 12)));
}

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round(((s[m - 1] + s[m]) / 2) * 1e8) / 1e8;
}

export const formatQuoteJob = (price: number, ts: number) => `quote://AVAX-USD/${price}/${ts}`;
export function parseQuoteJob(uri: string): { price: number; ts: number } | null {
  const m = /^quote:\/\/AVAX-USD\/(\d+(?:\.\d+)?)\/(\d+)$/.exec(uri);
  return m ? { price: Number(m[1]), ts: Number(m[2]) } : null;
}

/** Live market price: median of the public sources that answer within 4 s. */
export async function marketPrice(fetchImpl: typeof fetch = fetch): Promise<{ price: number; sources: string[] }> {
  const get = async (name: string, url: string, pick: (j: any) => number) => {
    const r = await fetchImpl(url, { signal: AbortSignal.timeout(4000) });
    const v = pick(await r.json());
    if (!Number.isFinite(v) || v <= 0) throw new Error(`${name}: bad value`);
    return { name, v };
  };
  const results = await Promise.allSettled([
    get("binance", "https://api.binance.com/api/v3/ticker/price?symbol=AVAXUSDT", (j) => Number(j.price)),
    get("coingecko", "https://api.coingecko.com/api/v3/simple/price?ids=avalanche-2&vs_currencies=usd", (j) => Number(j["avalanche-2"]?.usd)),
  ]);
  const ok = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  if (ok.length === 0) throw new Error("no price source answered");
  return { price: median(ok.map((o) => o.v)), sources: ok.map((o) => o.name) };
}

/**
 * A deliberately sloppy provider (demo toggle, disclosed in the README): a stale base price that is always off
 * by 4-9%, up or down. It signs what it serves, so the contract scores it low.
 */
export function sloppyQuoter(base: number, rng: () => number = Math.random) {
  return () => {
    const skew = (0.04 + rng() * 0.05) * (rng() < 0.5 ? -1 : 1);
    return Math.round(base * (1 + skew) * 1e4) / 1e4;
  };
}
