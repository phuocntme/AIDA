import { useEffect, useState } from "react";
import { toFunctionSelector } from "viem";
import { agentPolicyAbi } from "@aida/sdk";
import { CHAIN_ID, deployment, explorerTx } from "./aida.tsx";
import { ago } from "./Ticker.tsx";
import { short } from "./ui.tsx";

type Tx = { hash: string; at: number; ok: boolean; from: string; method: string };

const NAMES = new Map(agentPolicyAbi.filter((x) => x.type === "function").map((f) => [toFunctionSelector(f), f.name]));
const LABEL: Record<string, string> = { pay: "Payment", setPaused: "Kill switch", setRecipient: "Whitelist", setLimits: "Limits", deposit: "Deposit", withdraw: "Withdraw", createPolicy: "Policy created", rebindAgent: "Rebind", setGuardian: "Guardian" };

/**
 * Every transaction sent to AgentPolicy, including the ones the contract reverted. A reverted transaction emits
 * no event, so this list cannot be built from logs: it comes from the Avalanche Data API (Glacier), keyless.
 */
export function PolicyLedger() {
  const [rows, setRows] = useState<Tx[] | null>(null);
  useEffect(() => {
    if (CHAIN_ID !== 43113 || !deployment) return;
    let live = true;
    const tick = () =>
      fetch(`https://glacier-api.avax.network/v1/chains/43113/addresses/${deployment!.policy}/transactions?pageSize=12`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((j: { transactions?: { nativeTransaction: { txHash: string; blockTimestamp: number; txStatus: string; from: { address: string }; method?: { methodHash?: string } } }[] }) => {
          if (!live) return;
          setRows(
            (j.transactions ?? []).map(({ nativeTransaction: n }) => ({
              hash: n.txHash,
              at: n.blockTimestamp,
              ok: n.txStatus === "1",
              from: n.from.address,
              method: NAMES.get((n.method?.methodHash ?? "") as `0x${string}`) ?? "deploy",
            })),
          );
        })
        .catch(() => live && setRows((r) => r ?? []));
    tick();
    const t = setInterval(tick, 12000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);
  if (CHAIN_ID !== 43113 || !rows || rows.length === 0) return null;
  return (
    <section className="ledger-mini" aria-label="AgentPolicy transactions">
      <h2 className="section-h">Policy transactions</h2>
      <div className="lm-list">
        {rows.slice(0, 7).map((r) => (
          <a key={r.hash} className={`lm-row ${r.ok ? "" : "bad"}`} href={explorerTx(r.hash) ?? "#"} target="_blank" rel="noreferrer">
            <span className={`dot ${r.ok ? "trusted" : "risky"}`} />
            <span className="lm-what">{r.ok ? (LABEL[r.method] ?? r.method) : `${LABEL[r.method] ?? r.method} reverted`}</span>
            <span className="mono dim lm-from">{short(r.from)}</span>
            <span className="mono dim lm-when">{ago(BigInt(r.at))}</span>
            <span className="mono dim">↗</span>
          </a>
        ))}
      </div>
      <p className="dim small">Avalanche Data API · includes reverted transactions, which emit no events</p>
    </section>
  );
}
