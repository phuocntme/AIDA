import { useEffect, useRef, useState } from "react";
import type { AgentView } from "@aida/sdk";
import { createPublicClient, formatEther, http } from "viem";
import { avalanche } from "viem/chains";
import { CHAIN_ID, deployment, errMsg, explorerTx, readClient } from "../aida.tsx";
import { Avatar, ScoreBar, Status, short } from "../ui.tsx";
import { PolicyCard, usePolicy } from "../Policy.tsx";
import { PolicyLedger } from "../Ledger.tsx";

type Ev = {
  i: number;
  t: string;
  run: number;
  kind: "run" | "attack";
  level: "head" | "info" | "ok" | "warn" | "err";
  text: string;
  step?: string;
  title?: string;
  note?: string;
  tx?: string;
  ms?: number;
  inclusionMs?: number;
  feeWei?: string;
  gasUsed?: string;
  amountWei?: string;
  score?: number;
};

const buyer = deployment?.agents?.buyer;
const BUYER_URL = buyer ? new URL(buyer.endpoint).origin : null;
/** Gas of one AgentPolicy.pay, measured on Fuji; replaced by this page's own runs once there is one. */
const PAY_GAS = 96_000n;

const BADGE: Record<string, string> = {
  start: "START",
  skip: "SKIPPED",
  hire: "HIRED",
  paid: "PAID",
  quote: "QUOTE",
  score: "SCORE",
  report: "REPORT",
  refused: "REFUSED",
  done: "DONE",
  attack: "INJECTED",
  rules: "RULE ENGINE",
  blocked: "CONTRACT",
  safe: "RESULT",
};

/** Reads the C-Chain mainnet base fee once, to show what a payment would cost there. */
function useMainnetBaseFee() {
  const [fee, setFee] = useState<bigint | null>(null);
  useEffect(() => {
    if (CHAIN_ID !== 43113) return;
    createPublicClient({ chain: avalanche, transport: http("https://api.avax.network/ext/bc/C/rpc") })
      .getBlock()
      .then((b) => setFee(b.baseFeePerGas ?? null))
      .catch(() => {});
  }, []);
  return fee;
}

/** The agent network live: Treasury Bot buys quotes through its policy, the contract scores them, and the attack is refused. */
export function Economy() {
  const [agents, setAgents] = useState<AgentView[]>([]);
  const [events, setEvents] = useState<Ev[]>([]);
  const [running, setRunning] = useState<false | "run" | "attack">(false);
  const [err, setErr] = useState("");
  const since = useRef(0);
  const box = useRef<HTMLOListElement>(null);

  useEffect(() => {
    let live = true;
    const tick = async () => {
      try {
        const list = await readClient!.list();
        if (live) setAgents(list);
      } catch {
        /* keep last good state; next tick retries */
      }
    };
    tick();
    const t = setInterval(tick, 5000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    if (!BUYER_URL) return;
    let live = true;
    const poll = async () => {
      try {
        const r = await fetch(`${BUYER_URL}/log?since=${since.current}`).then((x) => x.json());
        if (!live) return;
        setRunning(r.running);
        if (r.events.length) {
          since.current = r.events[r.events.length - 1].i + 1;
          setEvents((old) => [...old, ...r.events].slice(-300));
        }
        setErr("");
      } catch {
        if (live) setErr("Agent network offline. Start it with pnpm demo:fuji.");
      }
    };
    poll();
    const t = setInterval(poll, 1000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    box.current?.scrollTo({ top: box.current.scrollHeight, behavior: "smooth" });
  }, [events]);

  async function start(what: "run" | "attack") {
    try {
      const r = await fetch(`${BUYER_URL}/${what}${what === "run" ? "?rounds=3" : ""}`, { method: "POST" });
      if (r.status === 409) setErr("Treasury Bot is busy.");
      else if (!r.ok) setErr((await r.json()).error ?? "request refused");
      else setRunning(what);
    } catch (e) {
      setErr(errMsg(e));
    }
  }

  const sellers = agents.filter((a) => a.card?.endpoints.some((e) => e.endpoint.endsWith("/quote")));
  const lastRun = events.length ? events[events.length - 1].run : 0;
  const shown = events.filter((e) => e.run === lastRun);
  const attack = shown[0]?.kind === "attack";

  return (
    <section className="page economy">
      <h1 className="display-2">Agent economy</h1>
      <PayStats events={events} />

      <div className="economy-grid">
        <div>
          <h2 className="section-h first">Sellers</h2>
          <div className="mini-ledger">
            {sellers.map((a) => (
              <a key={a.agentId.toString()} className="mini-row" href={`#/agent/${a.agentId}`}>
                <Avatar seed={a.owner} name={a.card?.name ?? "?"} size={40} />
                <span className="agent-text">
                  <span className="name">{a.card?.name}</span>
                </span>
                <ScoreBar count={a.count} average={a.average} />
                <Status count={a.count} average={a.average} />
              </a>
            ))}
          </div>
          {buyer && <PolicyCard agentId={BigInt(buyer.agentId)} agents={agents} />}
          <PolicyLedger />
        </div>

        <aside className={`console ${attack ? "is-attack" : ""}`}>
          <div className="console-top">
            <span className="console-name">Treasury Bot</span>
            <span className={`dot ${running ? "trusted pulse" : ""}`} aria-label={running ? "running" : "idle"} />
            <span className="console-actions">
              <button className="attack-btn" onClick={() => start("attack")} disabled={Boolean(running) || !BUYER_URL} title="Tell the bot to overspend and to pay a stranger">
                {running === "attack" ? "Attacking…" : "Attack"}
              </button>
              <button className="solid-cta" onClick={() => start("run")} disabled={Boolean(running) || !BUYER_URL}>
                {running === "run" ? "Running…" : "Run"}
              </button>
            </span>
          </div>
          {err && <p className="error-line small">{err}</p>}
          <ol className="timeline" ref={box} aria-live="polite">
            {shown.length === 0 && (
              <li className="tl-empty">
                <b>Run</b> buys three quotes through the policy. <b>Attack</b> tries to overspend.
              </li>
            )}
            {shown.map((e) => (
              <Row key={e.i} e={e} />
            ))}
          </ol>
        </aside>
      </div>
    </section>
  );
}

function Row({ e }: { e: Ev }) {
  const link = e.tx ? explorerTx(e.tx) : null;
  if (e.level === "head" && e.step !== "attack") return <li className="tl-head mono">{(e.title ?? e.text).toUpperCase()}</li>;
  const tone = e.step === "score" && e.score !== undefined ? (e.score >= 80 ? "ok" : e.score >= 60 ? "warn" : "err") : e.level;
  return (
    <li className={`tl-row tone-${tone} step-${e.step ?? "info"}`} title={e.t}>
      <span className="tl-badge mono">{BADGE[e.step ?? ""] ?? "INFO"}</span>
      <span className="tl-main">
        <b className="tl-title">{e.title ?? e.text}</b>
        {e.note && <span className="tl-note">{e.note}</span>}
      </span>
      {e.tx &&
        (link ? (
          <a className="tl-tx mono" href={link} target="_blank" rel="noreferrer" title={e.tx}>
            tx ↗
          </a>
        ) : (
          <span className="tl-tx mono dim">{short(e.tx)}</span>
        ))}
    </li>
  );
}

/** Top tiles. Payments and volume are read from AgentPolicy; time and gas come from this session's payments. */
function PayStats({ events }: { events: Ev[] }) {
  const { policy } = usePolicy(buyer ? BigInt(buyer.agentId) : null, 5000);
  const baseFee = useMainnetBaseFee();
  const paid = events.filter((e) => e.step === "paid" && e.ms !== undefined);
  const n = paid.length;
  const avgS = n ? paid.reduce((t, e) => t + e.ms!, 0) / n / 1000 : null;
  const incl = paid.filter((e) => e.inclusionMs !== undefined);
  const avgIncl = incl.length ? incl.reduce((t, e) => t + e.inclusionMs!, 0) / incl.length / 1000 : null;
  const gas = n && paid[0].gasUsed ? paid.reduce((t, e) => t + BigInt(e.gasUsed ?? 0), 0n) / BigInt(n) : PAY_GAS;
  const mainnet = baseFee ? Number(formatEther(gas * baseFee)) : null;
  return (
    <section className="paystats" aria-label="Payment stats">
      <div>
        <span className="label mono">PAYMENTS THROUGH POLICY</span>
        <b>{policy ? policy.payments.toString() : "—"}</b>
      </div>
      <div>
        <span className="label mono">PAID</span>
        <b>
          {policy ? Number(formatEther(policy.totalPaid)).toFixed(4) : "—"}
          {policy && <small> AVAX</small>}
        </b>
      </div>
      <div>
        <span className="label mono">CONFIRMED IN</span>
        <b>
          {avgS === null ? "—" : avgS.toFixed(1)}
          {avgS !== null && <small> s</small>}
        </b>
        <span className="sub dim">{avgIncl !== null ? `in a block after ${avgIncl.toFixed(1)} s` : "run to measure"}</span>
      </div>
      <div>
        <span className="label mono">NETWORK FEE PER PAYMENT</span>
        <b>
          {mainnet === null ? "< 0.000001" : `≈ ${mainnet.toFixed(5)}`}
          <small> AVAX</small>
        </b>
        <span className="sub dim">{mainnet === null ? "on Fuji today" : "at today's C-Chain mainnet price · under 0.000001 on Fuji"}</span>
      </div>
    </section>
  );
}
