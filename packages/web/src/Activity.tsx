import { useEffect, useState } from "react";
import type { ActivityItem, AgentView } from "@aida/sdk";
import { CHAIN_ID, readClient } from "./aida.tsx";
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
        .activity(5)
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
        <h2 className="display-3">Activity</h2>
      </div>
      {err && !items && <p className="error-line small">Could not read events: {err}</p>}
      <div className="activity-list">
        {(items ?? []).map((i) => {
          const name = names.get(i.agentId) ?? `#${i.agentId}`;
          return (
            <a key={`${i.kind}-${i.agentId}-${i.logIndex}-${i.timestamp}`} className="activity-row" href={`#/agent/${i.agentId}`}>
              <span className="mono dim when">{ago(i.timestamp)}</span>
              <span className={`kind mono k-${i.kind}`}>
                {i.kind === "feedback" ? "REVIEW" : i.kind === "validated" ? "AUDIT" : "REQUEST"}
              </span>
              <span className="what">
                {i.kind === "feedback" && (
                  <>
                    <b>{who(i.actor)}</b> paid <b>{name}</b>, {i.checked ? "Chainlink score" : "rated"} <span className={scoreCls(i.score)}>{i.score}</span>
                  </>
                )}
                {i.kind === "validation-requested" && (
                  <>
                    <b>{name}</b> → <b>{who(i.actor)}</b>
                  </>
                )}
                {i.kind === "validated" && (
                  <>
                    <b>{/^0x0+$/.test(i.actor) ? "Validator" : who(i.actor)}</b> audited <b>{name}</b> <span className={scoreCls(i.score)}>{i.score}</span>
                  </>
                )}
              </span>
            </a>
          );
        })}
        {items && items.length === 0 && <div className="empty">No events yet.</div>}
      </div>
    </section>
  );
}
