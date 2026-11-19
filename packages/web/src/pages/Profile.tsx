import { useCallback, useEffect, useState } from "react";
import type { AgentView, FeedbackView, PolicyView, ValidationView } from "@aida/sdk";
import { formatEther } from "viem";
import { deployment, errMsg, explorerAddr, readClient, useWallet } from "../aida.tsx";
import { TrustChart, pad, short } from "../ui.tsx";
import { usePolicy } from "../Policy.tsx";
import { verdictLabel } from "../verdict.ts";

const SHOW = 6;

export function Profile({ agentId }: { agentId: bigint }) {
  const [agent, setAgent] = useState<AgentView | null | undefined>(undefined);
  const [feedback, setFeedback] = useState<FeedbackView[]>([]);
  const [validations, setValidations] = useState<ValidationView[]>([]);
  const [error, setError] = useState("");
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [allReviews, setAllReviews] = useState(false);
  const { policy } = usePolicy(agentId, 15000);

  useEffect(() => {
    readClient!
      .list()
      .then((all) => setNames(new Map(all.map((a) => [a.owner.toLowerCase(), a.card?.name ?? `#${a.agentId}`]))))
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    try {
      const a = await readClient!.resolve(agentId);
      setAgent(a);
      if (a) {
        const [f, v] = await Promise.all([readClient!.feedback(agentId), readClient!.validations(agentId)]);
        setFeedback(f);
        setValidations(v);
      }
    } catch (e) {
      setError(`Could not read agent: ${errMsg(e)}`);
    }
  }, [agentId]);

  useEffect(() => {
    load();
  }, [load]);

  if (error) return <p className="page error-line">{error}</p>;
  if (agent === undefined) return <p className="page muted">Loading…</p>;
  if (agent === null) return <p className="page error-line">Agent #{agentId.toString()} is not registered.</p>;

  const v = verdictLabel(agent.count, agent.average);
  return (
    <section className="page profile">
      <a href="#/" className="back">
        ← Agents
      </a>
      <div className="profile-grid">
        <div>
          <h1 className="display-2 profile-name">{agent.card?.name ?? "Invalid card"}</h1>
          {policy && (
            <a href="#/economy" className={`policy-badge ${policy.paused ? "off" : ""}`}>
              <span className={`dot ${policy.paused ? "risky" : "trusted"}`} />
              AgentPolicy · {policy.paused ? "paused" : "active"} · cap {Number(formatEther(policy.dailyCap)).toFixed(3)} AVAX/day
            </a>
          )}
          <p className="lead">{agent.card?.description}</p>
          {agent.cardErrors.length > 0 && <p className="error-line">Invalid agent card: {agent.cardErrors.join("; ")}</p>}

          <div className="kpis">
            <div title={v.text}>
              <span className="mono label">
                <span className={`dot ${v.cls}`} /> {v.text.toUpperCase()}
              </span>
              <b className={`big ${v.cls}`}>{agent.count === 0n ? "—" : agent.average.toString()}</b>
            </div>
            <div>
              <span className="mono label">REVIEWS</span>
              <span className="kpi-text">{agent.count.toString()}</span>
            </div>
            <div>
              <span className="mono label">AUDITS</span>
              <span className="kpi-text">{validations.filter((x) => x.responded).length}</span>
            </div>
          </div>

          <TrustChart points={feedback} />

          <details className="more">
            <summary className="mono label">#{pad(agent.agentId)} · {short(agent.owner)}</summary>
            <dl className="details">
              <dt>Owner</dt>
              <dd className="mono">{agent.owner}</dd>
              <dt>Payout wallet</dt>
              <dd className="mono">{agent.card?.wallet}</dd>
              <dt>Endpoint</dt>
              <dd className="mono">{agent.card?.endpoints.map((e) => e.endpoint).join(", ")}</dd>
            </dl>
          </details>

          <h2 className="section-h">Reviews</h2>
          {feedback.length === 0 && <p className="muted">None yet.</p>}
          <div className="reviews">
            {feedback
              .slice()
              .reverse()
              .slice(0, allReviews ? undefined : SHOW)
              .map((f, i) => (
                <div key={i} className="review-row" title={f.tag || undefined}>
                  <b className={f.score >= 80 ? "trusted" : f.score >= 60 ? "okay" : "risky"}>{f.score}</b>
                  <span className="who-col">
                    {names.get(f.client.toLowerCase()) ?? short(f.client)}
                    <span className="review-proof dim">
                      {f.checked ? `quote ${f.quote.toFixed(4)} · Chainlink ${f.feedPrice.toFixed(4)}` : `paid · ${f.tag}`}
                    </span>
                  </span>
                  <span className="dim when">{new Date(Number(f.timestamp) * 1000).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                </div>
              ))}
          </div>
          {feedback.length > SHOW && (
            <button className="link more-btn" onClick={() => setAllReviews(!allReviews)}>
              {allReviews ? "Less" : `All ${feedback.length}`}
            </button>
          )}

          <h2 className="section-h">Audits</h2>
          <Validations agent={agent} items={validations} onChange={load} />
        </div>
        <Evidence agent={agent} feedback={feedback} policy={policy} />
      </div>
    </section>
  );
}

/** Where this agent's record lives: the canonical ERC-8004 registries and AIDA's own contracts. */
function Evidence({ agent, feedback, policy }: { agent: AgentView; feedback: FeedbackView[]; policy: PolicyView | null | undefined }) {
  const [mirror, setMirror] = useState<{ count: number; average: number } | null>(null);
  useEffect(() => {
    readClient!
      .erc8004Summary(agent.agentId)
      .then(setMirror)
      .catch(() => {});
  }, [agent.agentId, feedback.length]);
  const d = deployment!;
  const a = (addr: string, text: string) => {
    const href = explorerAddr(addr);
    return href ? (
      <a className="mono" href={href} target="_blank" rel="noreferrer">
        {text} ↗
      </a>
    ) : (
      <span className="mono">{text}</span>
    );
  };
  return (
    <aside className="oracle evidence">
      <div className="oracle-head">
        <h2 className="oracle-h">On-chain record</h2>
      </div>
      <dl className="evidence-list">
        <div>
          <dt className="label mono">ERC-8004 IDENTITY</dt>
          <dd>
            <b>#{agent.agentId.toString()}</b> {a(d.identity, short(d.identity))}
          </dd>
        </div>
        <div>
          <dt className="label mono">REVIEWS · CHAINLINK-CHECKED</dt>
          <dd>
            <b>
              {agent.count.toString()} · {agent.checked.toString()}
            </b>{" "}
            {a(d.reviews, "PaidReviews")}
          </dd>
        </div>
        {d.erc8004Reputation && (
          <div>
            <dt className="label mono">COPY IN ERC-8004 REPUTATION</dt>
            <dd>
              <b>{mirror ? `${mirror.count} · avg ${Math.round(mirror.average)}` : "—"}</b> {a(d.erc8004Reputation, short(d.erc8004Reputation))}
            </dd>
          </div>
        )}
        {policy && (
          <div>
            <dt className="label mono">PAID THROUGH POLICY</dt>
            <dd>
              <b>
                {policy.payments.toString()} payments · {Number(formatEther(policy.totalPaid)).toFixed(4)} AVAX
              </b>{" "}
              {a(d.policy, "AgentPolicy")}
            </dd>
          </div>
        )}
      </dl>
      <p className="dim small">One payment, one review. For a price quote the contract computes the score from the seller's signed quote and Chainlink.</p>
    </aside>
  );
}

function Validations({ agent, items, onChange }: { agent: AgentView; items: ValidationView[]; onChange: () => void }) {
  const w = useWallet();
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [all, setAll] = useState(false);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    readClient!.list().then((all) => setNames(new Map(all.map((a) => [a.owner.toLowerCase(), a.card?.name ?? `#${a.agentId}`]))));
  }, []);
  const me = w.wallet?.account.address.toLowerCase();
  const isOwner = me === agent.owner.toLowerCase();
  const validatorId = deployment?.validatorAgentId;

  async function request() {
    if (!w.client || !validatorId) return;
    setBusy(true);
    setMsg("");
    try {
      const validator = await readClient!.ownerOf(BigInt(validatorId));
      const r = await w.client.requestValidation(agent.agentId, validator, `job://${agent.card?.name.toLowerCase().replace(/\W+/g, "-") ?? "agent"}/${Date.now()}`);
      setMsg(`Validation #${r.requestId} requested from AIDA Audit Lab.`);
      onChange();
    } catch (e) {
      setMsg(`Failed: ${errMsg(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function respond(v: ValidationView) {
    if (!w.client) return;
    const score = scores[v.requestId.toString()] ?? 90;
    setBusy(true);
    setMsg("");
    try {
      await w.client.respondValidation(v.requestId, score, `report://audit/${v.requestId}`);
      setMsg(`Validation #${v.requestId} answered with ${score}/100.`);
      onChange();
    } catch (e) {
      setMsg(`Failed: ${errMsg(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="validations">
      {items.length === 0 && <p className="muted">None yet.</p>}
      {items
        .slice()
        .reverse()
        .slice(0, all ? undefined : SHOW)
        .map((v) => {
          const mine = me === v.validator.toLowerCase() && !v.responded;
          return (
            <div key={v.requestId.toString()} className="validation-row" title={`#${v.requestId} · ${v.requestURI}`}>
              {v.responded ? (
                <b className={v.response >= 80 ? "trusted" : v.response >= 60 ? "okay" : "risky"}>{v.response}</b>
              ) : (
                <span className="pending mono">PENDING</span>
              )}
              <span className="who-col">{names.get(v.validator.toLowerCase()) ?? short(v.validator)}</span>
              {mine && (
                <span className="respond">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    aria-label="Validation score"
                    value={scores[v.requestId.toString()] ?? 90}
                    onChange={(e) => setScores({ ...scores, [v.requestId.toString()]: Number(e.target.value) })}
                  />
                  <button className="ghost-cta" disabled={busy} onClick={() => respond(v)}>
                    Attest
                  </button>
                </span>
              )}
            </div>
          );
        })}
      {items.length > SHOW && (
        <button className="link more-btn" onClick={() => setAll(!all)}>
          {all ? "Less" : `All ${items.length}`}
        </button>
      )}
      {isOwner && validatorId && (
        <button className="ghost-cta request-btn" disabled={busy} onClick={request}>
          {busy ? "Sending…" : "Request audit"}
        </button>
      )}
      {msg && <p className="small muted">{msg}</p>}
    </div>
  );
}
