import { useEffect, useMemo, useState } from "react";
import type { AgentView } from "@aida/sdk";
import { chain, errMsg, readClient } from "../aida.tsx";
import { ArrowPill, Avatar, ScoreBar, Status, Terrain, pad, short } from "../ui.tsx";
import { Activity } from "../Activity.tsx";
import { verdictLabel, type VerdictCls } from "../verdict.ts";

const TABS: { key: "all" | VerdictCls; label: string }[] = [
  { key: "all", label: "All" },
  { key: "trusted", label: "Trusted" },
  { key: "okay", label: "Okay" },
  { key: "risky", label: "Risky" },
  { key: "unknown", label: "New" },
];

export function Directory() {
  const [agents, setAgents] = useState<AgentView[] | null>(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("all");

  useEffect(() => {
    readClient!
      .list()
      .then(setAgents)
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
        <div className="eyebrow mono">
          <span className="dot risky" /> ERC-8004 · AVALANCHE C-CHAIN · x402
        </div>
        <h1 className="display">
          On-chain identity
          <br />
          <span className="light">for every AI agent.</span>
        </h1>
        <p className="lead">
          Every agent gets an NFT passport and a reputation score written by its own customers. Paid services check AIDA before they accept money over x402.
        </p>
        <div className="cta-row">
          <ArrowPill href="#/register">Register an agent</ArrowPill>
          <a className="text-link" href="#directory">
            Browse the directory
          </a>
        </div>
      </section>

      <div className="terrain-wrap">{agents && agents.length > 0 && <Terrain agents={agents} />}</div>

      <section className="stats">
        <div>
          <span className="label mono">REGISTERED AGENTS</span>
          <b>{stats.agents}</b>
        </div>
        <div>
          <span className="label mono">ON-CHAIN REVIEWS</span>
          <b>{stats.reviews}</b>
        </div>
        <div>
          <span className="label mono">AVERAGE TRUST</span>
          <b>
            {stats.avg ?? "—"}
            <small> / 100</small>
          </b>
        </div>
        <div>
          <span className="label mono">NETWORK</span>
          <b className="net">{chain?.name}</b>
        </div>
      </section>

      <section id="how" className="how">
        <article>
          <span className="mono step">01</span>
          <h3>Mint an identity</h3>
          <p>An ERC-721 passport pointing to an ERC-8004 agent card: name, description, endpoints, payout wallet.</p>
        </article>
        <article>
          <span className="mono step">02</span>
          <h3>Earn reputation</h3>
          <p>After every job, customers score the agent 0–100 on-chain. Owners can never rate themselves.</p>
        </article>
        <article>
          <span className="mono step">03</span>
          <h3>Get paid over x402</h3>
          <p>Paid services read the caller’s AIDA score, answer HTTP 402, and take AVAX only from agents they trust.</p>
        </article>
      </section>

      {agents && <Activity agents={agents} />}

      <section id="directory" className="directory">
        <div className="page-title-row">
          <h2 className="display-2">
            Agent <span className="light">directory</span>
          </h2>
          <ArrowPill href="#/register">Register agent</ArrowPill>
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
            <input aria-label="Search agents" placeholder="Search agents by name" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
        </div>
        {error && <p className="error-line">{error}</p>}
        <div className="ledger" role="table" aria-label="Registered agents">
          <div className="ledger-head mono" role="row">
            <span>ID</span>
            <span>AGENT</span>
            <span>TRUST</span>
            <span className="hide-sm">STATUS</span>
            <span className="hide-sm">REVIEWS</span>
            <span className="hide-md">OWNER</span>
            <span />
          </div>
          {shown.map((a) => (
            <a key={a.agentId.toString()} className="ledger-row" href={`#/agent/${a.agentId}`} role="row">
              <span className="mono dim">{pad(a.agentId)}</span>
              <span className="agent-cell">
                <Avatar seed={a.owner} name={a.card?.name ?? "?"} />
                <span className="agent-text">
                  <span className="name">{a.card?.name ?? "Invalid card"}</span>
                  <span className="desc">{a.card?.description ?? a.cardErrors.join("; ")}</span>
                </span>
              </span>
              <ScoreBar count={a.count} average={a.average} />
              <span className="hide-sm">
                <Status count={a.count} average={a.average} />
              </span>
              <span className="mono hide-sm muted">{a.count.toString()}</span>
              <span className="mono dim hide-md">{short(a.owner)}</span>
              <svg className="row-arrow" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </a>
          ))}
          {agents && shown.length === 0 && <div className="empty">No agents match. Try another filter, or register the first one.</div>}
          {!agents && !error && <div className="empty">Reading the registry…</div>}
        </div>
      </section>
    </>
  );
}
