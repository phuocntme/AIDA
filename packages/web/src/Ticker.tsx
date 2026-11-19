import { useEffect, useState } from "react";
import type { ActivityItem, AgentView } from "@aida/sdk";
import { readClient } from "./aida.tsx";
import { short } from "./ui.tsx";

export function ago(ts?: bigint) {
  if (!ts) return "";
  const s = Math.max(0, Math.floor(Date.now() / 1000) - Number(ts));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

const cls = (n?: number) => (n === undefined ? "" : n >= 80 ? "trusted" : n >= 60 ? "okay" : "risky");

/** Scrolling strip of the latest on-chain events (reviews, audits), like an exchange ticker. */
export function Ticker() {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [agents, setAgents] = useState<AgentView[]>([]);
  useEffect(() => {
    let live = true;
    const tick = async () => {
      try {
        const [a, i] = await Promise.all([readClient!.list(), readClient!.activity(14)]);
        if (live) {
          setAgents(a);
          setItems(i.filter((x) => x.kind !== "validation-requested"));
        }
      } catch {
        /* keep the last good strip */
      }
    };
    tick();
    const t = setInterval(tick, 20000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);
  if (!items.length) return <div className="ticker" aria-hidden="true" />;
  const name = new Map(agents.map((a) => [a.agentId, a.card?.name ?? `#${a.agentId}`]));
  const byOwner = new Map(agents.map((a) => [a.owner.toLowerCase(), a.card?.name ?? `#${a.agentId}`]));
  const who = (x: string) => (/^0x0+$/.test(x) ? "Validator" : (byOwner.get(x.toLowerCase()) ?? short(x)));
  const row = items.map((i, n) => (
    <a key={n} className="tick" href={`#/agent/${i.agentId}`}>
      <span className={`tk k-${i.kind}`}>{i.kind === "feedback" ? (i.checked ? "CHAINLINK-CHECKED" : "PAID REVIEW") : "AUDIT"}</span>
      <span>
        {who(i.actor)} → {name.get(i.agentId)} <b className={cls(i.score)}>{i.score}</b>
      </span>
      <span className="dim">{ago(i.timestamp)}</span>
    </a>
  ));
  return (
    <div className="ticker" aria-label="Latest on-chain activity">
      <div className="ticker-track">
        {row}
        {row}
      </div>
    </div>
  );
}
