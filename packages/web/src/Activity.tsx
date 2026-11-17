import { useEffect, useState } from "react";
import type { ActivityItem, AgentView } from "@aida/sdk";
import { CHAIN_ID, explorerTx, readClient } from "./aida.tsx";
import { short } from "./ui.tsx";

function ago(ts?: bigint) {
  if (!ts) return "";
  const s = Math.max(0, Math.floor(Date.now() / 1000) - Number(ts));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const scoreCls = (n?: number) => (n === undefined ? "" : n >= 80 ? "trusted" : n >= 60 ? "okay" : "risky");

/** Live feed of registry events, polled every 6 s. */
export function Activity({ agents }: { agents: AgentView[] }) {
  const [items, setItems] = useState<ActivityItem[] | null>(null);
  const [err, setErr] = useState("");
  const names = new Map(agents.map((a) => [a.agentId, a.card?.name ?? `#${a.agentId}`]));
  const byOwner = new Map(agents.map((a) => [a.owner.toLowerCase(), a.card?.name ?? `#${a.agentId}`]));
  const who = (addr: string) => byOwner.get(addr.toLowerCase()) ?? short(addr);

  useEffect(() => {
    let live = true;
    const tick = () =>
      readClient!
        .activity(10)
        .then((x) => live && (setItems(x), setErr("")))
        .catch((e) => live && setErr(String((e as Error).message).split("\n")[0]));
    const every = CHAIN_ID === 31337 ? 6000 : 15000;
    tick();
    const t = setInterval(tick, every);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);

  return (
    <section className="activity" aria-live="polite">
      <div className="activity-head">
        <h2 className="display-3">
          Live <span className="light">on-chain activity</span>
        </h2>
        <span className="mono label">
          <span className="dot trusted pulse" /> LIVE FROM CHAIN
        </span>
      </div>
      {err && !items && <p className="error-line small">Could not read events: {err}</p>}
      <div className="activity-list">
        {(items ?? []).map((i) => {
          const name = names.get(i.agentId) ?? `#${i.agentId}`;
          const link = i.txHash ? explorerTx(i.txHash) : null;
          return (
            <a key={`${i.kind}-${i.agentId}-${i.logIndex}-${i.timestamp}`} className="activity-row" href={`#/agent/${i.agentId}`}>
              <span className="mono dim when">{ago(i.timestamp)}</span>
              <span className={`kind mono k-${i.kind}`}>
                {i.kind === "registered" ? "MINT" : i.kind === "feedback" ? "REVIEW" : i.kind === "validated" ? "ATTEST" : "REQUEST"}
              </span>
              <span className="what">
                {i.kind === "registered" && (
                  <>
                    <b>{name}</b> minted an identity
                  </>
                )}
                {i.kind === "feedback" && (
                  <>
                    <b>{who(i.actor)}</b> rated <b>{name}</b> <span className={scoreCls(i.score)}>{i.score}</span>
                  </>
                )}
                {i.kind === "validation-requested" && (
                  <>
                    <b>{name}</b> asked <b>{who(i.actor)}</b> to validate a job
                  </>
                )}
                {i.kind === "validated" && (
                  <>
                    a validator attested <b>{name}</b>’s work <span className={scoreCls(i.score)}>{i.score}</span>
                  </>
                )}
              </span>
              <span className="mono dim tx">{link ? "snowtrace ↗" : i.txHash ? short(i.txHash) : "on-chain"}</span>
            </a>
          );
        })}
        {items && items.length === 0 && <div className="empty">No events yet.</div>}
      </div>
    </section>
  );
}
