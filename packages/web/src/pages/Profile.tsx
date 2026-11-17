import { useCallback, useEffect, useState } from "react";
import { callPaidAgent, nonceToData, type AgentView, type FeedbackView, type PaidCallStep, type ValidationView } from "@aida/sdk";
import { formatEther } from "viem";
import { ORACLE_URL, chain, deployment, errMsg, explorerTx, publicClient, readClient, useWallet } from "../aida.tsx";
import { pad, short } from "../ui.tsx";
import { verdictLabel } from "../verdict.ts";

export function Profile({ agentId }: { agentId: bigint }) {
  const [agent, setAgent] = useState<AgentView | null | undefined>(undefined);
  const [feedback, setFeedback] = useState<FeedbackView[]>([]);
  const [validations, setValidations] = useState<ValidationView[]>([]);
  const [error, setError] = useState("");

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
        ← Directory
      </a>
      <div className="profile-grid">
        <div>
          <div className="mono label">AGENT #{pad(agent.agentId)} · ERC-721 · {chain?.name.toUpperCase()}</div>
          <h1 className="display-2 profile-name">{agent.card?.name ?? "Invalid card"}</h1>
          <p className="lead">{agent.card?.description}</p>
          {agent.cardErrors.length > 0 && <p className="error-line">Invalid agent card: {agent.cardErrors.join("; ")}</p>}

          <div className="kpis">
            <div>
              <span className="mono label">TRUST</span>
              <b className={`big ${v.cls}`}>
                {agent.count === 0n ? "—" : agent.average.toString()}
                <small> /100</small>
              </b>
            </div>
            <div>
              <span className="mono label">STATUS</span>
              <span className="kpi-text">
                <span className={`dot ${v.cls}`} />
                {v.text}
              </span>
            </div>
            <div>
              <span className="mono label">REVIEWS</span>
              <span className="kpi-text">{agent.count.toString()}</span>
            </div>
            <div>
              <span className="mono label">VALIDATED</span>
              <span className="kpi-text">
                {validations.filter((x) => x.responded).length}
                {validations.some((x) => x.responded) && (
                  <span className="kpi-sub">
                    avg {Math.round(validations.filter((x) => x.responded).reduce((t, x) => t + x.response, 0) / validations.filter((x) => x.responded).length)}
                  </span>
                )}
              </span>
            </div>
          </div>

          <dl className="details">
            <dt>Owner</dt>
            <dd className="mono">{agent.owner}</dd>
            <dt>Payout wallet</dt>
            <dd className="mono">{agent.card?.wallet}</dd>
            <dt>Endpoint</dt>
            <dd className="mono">{agent.card?.endpoints.map((e) => e.endpoint).join(", ")}</dd>
          </dl>

          <h2 className="section-h">On-chain reviews</h2>
          {feedback.length === 0 && <p className="muted">No reviews yet.</p>}
          <div className="reviews">
            {feedback
              .slice()
              .reverse()
              .map((f, i) => (
                <div key={i} className="review-row">
                  <b className={f.score >= 80 ? "trusted" : f.score >= 60 ? "okay" : "risky"}>{f.score}</b>
                  <span className="mono muted">{f.tag || "—"}</span>
                  <span className="mono dim">{short(f.client)}</span>
                  <span className="dim when">{new Date(Number(f.timestamp) * 1000).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</span>
                </div>
              ))}
          </div>
          <RateForm agent={agent} onDone={load} />

          <h2 className="section-h">Independent validations</h2>
          <p className="muted small-p section-sub">ERC-8004 Validation Registry: the owner asks a validator to re-check a job; the validator answers once, on-chain.</p>
          <Validations agent={agent} items={validations} onChange={load} />
        </div>
        <OraclePanel target={agent} onFeedback={load} />
      </div>
    </section>
  );
}

function RateForm({ agent, onDone }: { agent: AgentView; onDone: () => void }) {
  const w = useWallet();
  const [score, setScore] = useState(80);
  const [tag, setTag] = useState("quality");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const own = w.wallet?.account.address.toLowerCase() === agent.owner.toLowerCase();

  async function rate() {
    if (!w.client) return setMsg("Connect a wallet or pick a demo account first.");
    setBusy(true);
    setMsg("");
    try {
      const tx = await w.client.giveFeedback(agent.agentId, score, tag);
      setMsg(`Recorded ${score}/100 on-chain (tx ${short(tx)}).`);
      onDone();
    } catch (e) {
      setMsg(`Failed: ${errMsg(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rate">
      <span className="mono label">RATE THIS AGENT</span>
      <div className="rate-row">
        <input type="range" min={0} max={100} value={score} onChange={(e) => setScore(Number(e.target.value))} aria-label="Score" />
        <b className="rate-score">{score}</b>
        <input className="tag-input mono" value={tag} onChange={(e) => setTag(e.target.value)} maxLength={31} aria-label="Tag" />
        <button className="ghost-cta" onClick={rate} disabled={busy || own} title={own ? "Owners cannot rate their own agent" : ""}>
          {busy ? "Sending…" : "Submit review"}
        </button>
      </div>
      {own && <p className="dim small">You own this agent — the contract blocks self-reviews (SelfFeedback).</p>}
      {msg && <p className="small muted">{msg}</p>}
    </div>
  );
}

function OraclePanel({ target, onFeedback }: { target: AgentView; onFeedback: () => void }) {
  const w = useWallet();
  const [myAgents, setMyAgents] = useState<AgentView[]>([]);
  const [loadingAgents, setLoadingAgents] = useState(false);
  const [price, setPrice] = useState<string | null>(null);
  const [callerId, setCallerId] = useState("");
  const [steps, setSteps] = useState<PaidCallStep[]>([]);
  const [report, setReport] = useState<{ verdict: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const oracleId = deployment?.oracleAgentId;

  useEffect(() => {
    setSteps([]);
    setReport(null);
    setMsg("");
    if (!w.wallet) return setMyAgents([]);
    const me = w.wallet.account.address.toLowerCase();
    setLoadingAgents(true);
    readClient!
      .list()
      .then((all) => {
        const mine = all.filter((a) => a.owner.toLowerCase() === me);
        setMyAgents(mine);
        setCallerId(mine[0]?.agentId.toString() ?? "");
      })
      .finally(() => setLoadingAgents(false));
  }, [w.wallet, target.agentId]);

  useEffect(() => {
    fetch(`${ORACLE_URL}/`)
      .then((r) => r.json())
      .then((info: { priceWei?: string }) => info.priceWei && setPrice(formatEther(BigInt(info.priceWei))))
      .catch(() => setPrice(null));
  }, []);

  async function buy() {
    if (!w.wallet) return setMsg("Connect a wallet or pick a demo account first.");
    if (!callerId) return setMsg("This wallet owns no agent yet — register one first.");
    setBusy(true);
    setSteps([]);
    setReport(null);
    setMsg("");
    try {
      const r = await callPaidAgent(`${ORACLE_URL}/report/${target.agentId}`, BigInt(callerId), async (req) => {
        const hash = await w.wallet!.sendTransaction({ to: req.payTo, value: BigInt(req.maxAmountRequired), data: nonceToData(req.nonce) });
        await publicClient.waitForTransactionReceipt({ hash });
        return hash;
      });
      setSteps(r.steps);
      if (r.ok) setReport((r.body as { report: { verdict: string } }).report);
    } catch (e) {
      setMsg(`${errMsg(e)} — is the Trust Oracle running at ${ORACLE_URL}?`);
    } finally {
      setBusy(false);
    }
  }

  async function rateOracle(score: number) {
    if (!w.client || !oracleId) return;
    try {
      await w.client.giveFeedback(BigInt(oracleId), score, "trust-report");
      setMsg(`Rated the Trust Oracle ${score}/100 on-chain.`);
      onFeedback();
    } catch (e) {
      setMsg(`Failed: ${errMsg(e)}`);
    }
  }

  return (
    <aside className="oracle">
      <div className="oracle-top mono">
        <span>TRUST ORACLE · x402</span>
        <span>{price ? `${price} AVAX` : "OFFLINE"}</span>
      </div>
      <h2 className="oracle-h">
        Buy a trust report <span className="light">on this agent</span>
      </h2>
      <p className="muted small-p">
        The Oracle (agent #{oracleId}) checks your AIDA trust first. Below 60 → refused. Otherwise → HTTP 402, pay AVAX, get the report.
      </p>
      {w.wallet ? (
        <>
          <label className="field">
            <span className="mono label">CALL AS AGENT</span>
            <select value={callerId} onChange={(e) => setCallerId(e.target.value)}>
              {myAgents.length === 0 && <option value="">(this wallet owns no agent)</option>}
              {myAgents.map((a) => (
                <option key={a.agentId.toString()} value={a.agentId.toString()}>
                  #{pad(a.agentId)} {a.card?.name} — trust {a.count === 0n ? "—" : a.average.toString()}
                </option>
              ))}
            </select>
          </label>
          <button className="solid-cta" onClick={buy} disabled={busy || loadingAgents}>
            {loadingAgents ? "Loading your agents…" : busy ? "Working…" : `Buy report on #${pad(target.agentId)}`}
          </button>
        </>
      ) : (
        <p className="muted">Connect a wallet or pick a demo account to try it.</p>
      )}

      {steps.length > 0 && (
        <div className="terminal mono" aria-live="polite">
          <div>
            <span className="dim">→ </span>GET /report/{target.agentId.toString()} <span className="dim">X-Agent-Id: {callerId}</span>
          </div>
          {steps.map((s, i) =>
            s.kind === "paid" ? (
              <div key={i}>
                <span className="dim">$ </span>pay {formatEther(BigInt(s.requirement.maxAmountRequired))} AVAX · tx{" "}
                {explorerTx(s.txHash) ? (
                  <a href={explorerTx(s.txHash)!} target="_blank" rel="noreferrer">
                    {short(s.txHash)}
                  </a>
                ) : (
                  short(s.txHash)
                )}
              </div>
            ) : (
              <div key={i}>
                <span className="dim">← </span>
                <span className={`code c${s.status}`}>{s.status}</span> {describe(s.status, s.body as Record<string, unknown>)}
              </div>
            ),
          )}
        </div>
      )}

      {report && (
        <div className="verdict-row">
          <div>
            <span className="mono label">VERDICT</span>
            <div className={`verdict v-${report.verdict}`}>{report.verdict.toUpperCase()}</div>
          </div>
          <div className="rate-oracle">
            <span className="dim small">Rate Oracle</span>
            {[95, 70, 30].map((s) => (
              <button key={s} className="chip-btn" onClick={() => rateOracle(s)}>
                {s}
              </button>
            ))}
          </div>
        </div>
      )}
      {msg && <p className="small muted">{msg}</p>}
    </aside>
  );
}

function describe(status: number, body: Record<string, unknown>) {
  if (status === 403) return `Refused: ${body.reason ?? body.error}`;
  if (status === 402) return body.error ? `Payment rejected: ${body.error}` : "Payment Required";
  if (status === 200) return "report received";
  return String(body.error ?? "");
}

function Validations({ agent, items, onChange }: { agent: AgentView; items: ValidationView[]; onChange: () => void }) {
  const w = useWallet();
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [scores, setScores] = useState<Record<string, number>>({});
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
      {items.length === 0 && <p className="muted">No validations yet.</p>}
      {items
        .slice()
        .reverse()
        .map((v) => {
          const mine = me === v.validator.toLowerCase() && !v.responded;
          return (
            <div key={v.requestId.toString()} className="validation-row">
              <span className="mono dim">#{v.requestId.toString().padStart(3, "0")}</span>
              {v.responded ? (
                <b className={v.response >= 80 ? "trusted" : v.response >= 60 ? "okay" : "risky"}>{v.response}</b>
              ) : (
                <span className="pending mono">PENDING</span>
              )}
              <span className="mono muted job">{v.requestURI}</span>
              <span className="dim small">by {names.get(v.validator.toLowerCase()) ?? short(v.validator)}</span>
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
      {isOwner && validatorId && (
        <button className="ghost-cta request-btn" disabled={busy} onClick={request}>
          {busy ? "Sending…" : "Request validation from AIDA Audit Lab"}
        </button>
      )}
      {msg && <p className="small muted">{msg}</p>}
    </div>
  );
}
