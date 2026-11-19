import { useEffect, useState } from "react";
import type { AgentView, PolicyView } from "@aida/sdk";
import { formatEther } from "viem";
import { deployment, errMsg, explorerAddr, explorerTx, readClient, useWallet } from "./aida.tsx";
import { short } from "./ui.tsx";

const avax = (wei: bigint, d = 4) => Number(formatEther(wei)).toFixed(d);

/** Polls an agent's AgentPolicy. null = no policy (or no AgentPolicy in this deployment). */
export function usePolicy(agentId: bigint | null, every = 4000) {
  const [policy, setPolicy] = useState<PolicyView | null | undefined>(undefined);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (agentId === null || !deployment?.policy) return setPolicy(null);
    let live = true;
    const tick = () =>
      readClient!
        .policy(agentId)
        .then((p) => live && setPolicy(p))
        .catch(() => {});
    tick();
    const t = setInterval(tick, every);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [agentId, every, nonce]);
  return { policy, refresh: () => setNonce((n) => n + 1) };
}

/** AgentPolicy state + the guardian's kill switch. */
export function PolicyCard({ agentId, agents }: { agentId: bigint; agents: AgentView[] }) {
  const { policy, refresh } = usePolicy(agentId);
  const w = useWallet();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; tx?: string } | null>(null);
  if (!deployment?.policy) return null;
  if (policy === undefined) return <div className="policy-card skeleton" aria-busy="true" />;
  if (policy === null) return null;

  const names = new Map(agents.flatMap((a) => [[a.owner.toLowerCase(), a.card?.name ?? `#${a.agentId}`], [(a.card?.wallet ?? "").toLowerCase(), a.card?.name ?? `#${a.agentId}`]]));
  const used = policy.dailyCap === 0n ? 0 : Math.min(100, Number((policy.spentToday * 10000n) / policy.dailyCap) / 100);
  const me = w.wallet?.account.address.toLowerCase();
  const isGuardian = me === policy.guardian.toLowerCase();
  const isOperator = me === policy.operator.toLowerCase();
  const canPause = isGuardian || isOperator;
  const addr = explorerAddr(deployment.policy);

  async function toggle() {
    if (!w.client) return;
    setBusy(true);
    setMsg(null);
    try {
      const tx = await w.client.setPolicyPaused(agentId, !policy!.paused);
      setMsg({ text: policy!.paused ? "Resumed" : "Paused", tx });
      refresh();
    } catch (e) {
      setMsg({ text: errMsg(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={`policy-card ${policy.paused ? "is-paused" : ""}`} aria-label="Agent policy">
      <div className="policy-top">
        <span className="policy-title">
          AgentPolicy
          {addr && (
            <a className="mono dim" href={addr} target="_blank" rel="noreferrer">
              {short(deployment.policy)} ↗
            </a>
          )}
        </span>
        <span className={`state-pill ${policy.paused ? "off" : "on"}`}>
          <span className={`dot ${policy.paused ? "risky" : "trusted pulse"}`} />
          {policy.paused ? "PAUSED" : "ACTIVE"}
        </span>
      </div>

      <div className="cap">
        <div className="cap-nums">
          <b>{avax(policy.spentToday)}</b>
          <span className="dim"> / {avax(policy.dailyCap, 3)} AVAX today</span>
        </div>
        <div className="cap-bar" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={used} aria-label="Daily cap used">
          <span style={{ width: `${used}%` }} className={used > 85 ? "hot" : ""} />
        </div>
      </div>

      <dl className="policy-grid">
        <div>
          <dt className="label mono">PER PAYMENT</dt>
          <dd>≤ {avax(policy.perPaymentCap, 3)}</dd>
        </div>
        <div>
          <dt className="label mono">BALANCE</dt>
          <dd>{avax(policy.balance)}</dd>
        </div>
        <div>
          <dt className="label mono">GUARDIAN</dt>
          <dd className="mono">{short(policy.guardian)}</dd>
        </div>
      </dl>

      <div className="allow">
        <span className="label mono">WHITELIST</span>
        <div className="chips">
          {policy.recipients.map((r) => (
            <span key={r} className="chip" title={r}>
              {names.get(r.toLowerCase()) ?? short(r)}
            </span>
          ))}
        </div>
      </div>

      <div className="kill">
        <button className={policy.paused ? "solid-cta" : "kill-btn"} onClick={toggle} disabled={!canPause || busy} title={canPause ? "" : "Guardian or operator wallet only"}>
          {busy ? "Confirming…" : policy.paused ? "Resume agent" : "Kill switch"}
        </button>
        <span className="dim small">{isGuardian ? "you are the guardian" : isOperator ? "you are the operator: pause and resume only" : "guardian only"}</span>
        {msg && (
          <span className="small muted">
            {msg.text}
            {msg.tx && explorerTx(msg.tx) && (
              <>
                {" "}
                <a href={explorerTx(msg.tx)!} target="_blank" rel="noreferrer">
                  tx ↗
                </a>
              </>
            )}
          </span>
        )}
      </div>
    </section>
  );
}
