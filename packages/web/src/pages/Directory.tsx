import { useEffect, useMemo, useState } from "react";
import type { AgentView } from "@aida/sdk";
import { deployment, errMsg, readClient } from "../aida.tsx";
import { Avatar, ScoreBar, Status, Terrain } from "../ui.tsx";
import { Activity } from "../Activity.tsx";
import { verdictLabel, type VerdictCls } from "../verdict.ts";

/** What an agent without reviews is, so a buyer or a validator does not read as "untrusted". */
function roleOf(a: AgentView, guarded: Set<string>): string | undefined {
  if (a.count > 0n) return undefined;
  if (guarded.has(a.agentId.toString())) return "Buyer";
  if (deployment?.validatorAgentId === a.agentId.toString()) return "Validator";
  return undefined;
}

const TABS: { key: "all" | VerdictCls; label: string }[] = [
  { key: "all", label: "All" },
  { key: "trusted", label: "Trusted" },
  { key: "risky", label: "Risky" },
];

export function Directory() {
  const [agents, setAgents] = useState<AgentView[] | null>(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("all");

  const [guarded, setGuarded] = useState<Set<string>>(new Set());
  useEffect(() => {
    readClient!
      .list()
      .then(async (list) => {
        setAgents(list);
        const ps = await Promise.all(list.map((a) => readClient!.policy(a.agentId).catch(() => null)));
        setGuarded(new Set(ps.flatMap((p) => (p ? [p.agentId.toString()] : []))));
      })
      .catch((e) => setError(`Could not read the registry: ${errMsg(e)}`));
  }, []);

  const list = agents ?? [];
  const stats = useMemo(() => {
    const rated = list.filter((a) => a.count > 0n);
    return {
      agents: list.length,
      reviews: list.reduce((s, a) => s + Number(a.count), 0),
      avg: rated.length ? Math.round(rated.reduce((s, a) => s + Number(a.average), 0) / rated.length) : null,
    };
  }, [list]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: list.length, trusted: 0, okay: 0, risky: 0, unknown: 0 };
    for (const a of list) c[verdictLabel(a.count, a.average).cls]++;
    return c;
  }, [list]);

  const shown = list.filter(
    (a) => (a.card?.name ?? "").toLowerCase().includes(q.trim().toLowerCase()) && (tab === "all" || verdictLabel(a.count, a.average).cls === tab),
  );

  return (
    <>
      <section className="hero">
        <h1 className="display">Check before you pay</h1>
        <p className="hero-sub">AI agents on Avalanche. Scores are written only after a payment and computed on-chain from Chainlink.</p>
      </section>

      <div className="terrain-wrap">{agents && agents.length > 0 && <Terrain agents={agents} tag={(a) => roleOf(a, guarded)} />}</div>

      <section className="stats">
        <div>
          <span className="label mono">AGENTS</span>
          <b>{stats.agents}</b>
        </div>
        <div>
          <span className="label mono">PAID REVIEWS</span>
          <b>{stats.reviews}</b>
        </div>
        <div>
          <span className="label mono">AVG TRUST</span>
          <b>{stats.avg ?? "—"}</b>
        </div>
      </section>

      <section id="directory" className="directory">
        <div className="page-title-row">
          <h2 className="display-2">Agents</h2>
        </div>
        <div className="tabs-row">
          <div className="tabs" role="tablist">
            {TABS.map((t) => (
              <button key={t.key} role="tab" aria-selected={tab === t.key} className={tab === t.key ? "on" : ""} onClick={() => setTab(t.key)}>
                {t.label} <span className="mono dim">{counts[t.key] ?? 0}</span>
              </button>
            ))}
          </div>
          <label className="search">
            <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" fill="none" />
              <path d="M11 11l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <input aria-label="Search agents" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
        </div>
        {error && <p className="error-line">{error}</p>}
        <div className="ledger" role="table" aria-label="Registered agents">
          <div className="ledger-head mono" role="row">
            <span>AGENT</span>
            <span>TRUST</span>
            <span className="hide-sm">STATUS</span>
            <span className="hide-sm">REVIEWS</span>
            <span />
          </div>
          {shown.map((a) => (
            <a key={a.agentId.toString()} className="ledger-row" href={`#/agent/${a.agentId}`} role="row">
              <span className="agent-cell" title={a.card?.description ?? a.cardErrors.join("; ")}>
                <Avatar seed={a.owner} name={a.card?.name ?? "?"} />
                <span className="agent-text">
                  <span className="name">
                    {a.card?.name ?? "Invalid card"}
                    {guarded.has(a.agentId.toString()) && (
                      <span className="mini-chip" title="Payments go through AgentPolicy (caps, whitelist, kill switch)">
                        policy
                      </span>
                    )}
                  </span>
                </span>
              </span>
              <ScoreBar count={a.count} average={a.average} />
              <span className="hide-sm">
                <Status count={a.count} average={a.average} role={roleOf(a, guarded)} />
              </span>
              <span className="mono hide-sm muted">{a.count.toString()}</span>
              <svg className="row-arrow" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </a>
          ))}
          {agents && shown.length === 0 && <div className="empty">No agents match.</div>}
          {!agents && !error && <div className="empty">Loading…</div>}
        </div>
      </section>

      {agents && <Activity agents={agents} />}
    </>
  );
}
