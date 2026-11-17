// Price data for the AVAX/USD agents and the on-chain reference (Chainlink on Fuji) used to judge them.
import { parseAbi, type PublicClient } from "viem";

/** Chainlink AVAX / USD aggregator on Avalanche Fuji. */
export const CHAINLINK_AVAX_USD_FUJI = "0x5498BB86BC934c8D34FDA08E81D444153d0D06aD" as const;
const aggregatorAbi = parseAbi(["function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)", "function decimals() view returns (uint8)"]);

/** 100 for an exact quote, minus 12 points per 1% deviation from the reference, floored at 0. */
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

/** A deliberately sloppy provider: a stale base price skewed by up to ±9% per call. */
export function sloppyQuoter(base: number, rng: () => number = Math.random) {
  return () => Math.round(base * (1 + (rng() * 2 - 1) * 0.09) * 1e4) / 1e4;
}

export async function chainlinkPrice(pub: PublicClient): Promise<{ price: number; updatedAt: number }> {
  const [d, r] = await Promise.all([
    pub.readContract({ address: CHAINLINK_AVAX_USD_FUJI, abi: aggregatorAbi, functionName: "decimals" }),
    pub.readContract({ address: CHAINLINK_AVAX_USD_FUJI, abi: aggregatorAbi, functionName: "latestRoundData" }),
  ]);
  return { price: Number(r[1]) / 10 ** d, updatedAt: Number(r[3]) };
}
