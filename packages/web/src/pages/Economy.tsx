import { useEffect, useRef, useState } from "react";
import type { AgentView } from "@aida/sdk";
import { deployment, errMsg, explorerTx, readClient } from "../aida.tsx";
import { Avatar, ScoreBar, Status, pad, short } from "../ui.tsx";

type Ev = { i: number; t: string; level: "head" | "info" | "ok" | "warn" | "err"; text: string; tx?: string };

const buyer = deployment?.agents?.buyer;
const BUYER_URL = buyer ? new URL(buyer.endpoint).origin : null;

/** Live view of the real agent network: Treasury Bot hires price agents over x402 on Fuji while trust updates. */
export function Economy() {
  const [agents, setAgents] = useState<AgentView[]>([]);
  const [validated, setValidated] = useState<Record<string, number>>({});
  const [events, setEvents] = useState<Ev[]>([]);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState("");
  const since = useRef(0);
  const logBox = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    const tick = async () => {
      try {
        const list = await readClient!.list();
        const v = await Promise.all(list.map(async (a) => [a.agentId.toString(), (await readClient!.validations(a.agentId)).filter((x) => x.responded).length] as const));
        if (live) {
          setAgents(list);
          setValidated(Object.fromEntries(v));
        }
      } catch {
        /* keep last good state; next tick retries */
      }
    };
    tick();
    const t = setInterval(tick, 4000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    if (!BUYER_URL) return;
    let live = true;
    let first = true;
    const poll = async () => {
      try {
        const r = await fetch(`${BUYER_URL}/log?since=${since.current}`).then((x) => x.json());
        if (!live) return;
        setRunning(r.running);
        // Show only runs that happen while this page is open (unless one is in progress).
        if (first && !r.running && r.events.length) {
          since.current = r.events[r.events.length - 1].i + 1;
          first = false;
          return;
        }
        first = false;
        if (r.events.length) {
          since.current = r.events[r.events.length - 1].i + 1;
          setEvents((old) => [...old, ...r.events].slice(-200));
        }
        setErr("");
      } catch {
        if (live) setErr(`The agent network is not reachable at ${BUYER_URL}. Start it with pnpm agents:fuji.`);
      }
    };
    poll();
    const t = setInterval(poll, 1200);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    logBox.current?.scrollTo({ top: logBox.current.scrollHeight, behavior: "smooth" });
  }, [events]);

  async function run() {
    try {
      const r = await fetch(`${BUYER_URL}/run?rounds=4`, { method: "POST" });
      if (r.status === 409) setErr("Treasury Bot is already running.");
      else setRunning(true);
    } catch (e) {
      setErr(errMsg(e));
    }
  }

  const sellers = agents.filter((a) => a.card?.endpoints.some((e) => e.endpoint.endsWith("/quote")));
  const others = agents.filter((a) => !sellers.includes(a));

  return (
    <section className="page economy">
      <div className="eyebrow mono">
        <span className="dot trusted pulse" /> LIVE ON AVALANCHE FUJI
      </div>
      <h1 className="display-2">
        Agents hiring agents, <span className="light">in real time.</span>
      </h1>
      <p className="lead">
        Treasury Bot needs an AVAX/USD price. It finds sellers on AIDA, pays them over x402, checks every quote against Chainlink and rates the seller on-chain. No demo
        accounts, no seeded scores: every number below comes from a real transaction.
      </p>

      <div className="economy-grid">
        <div>
          <h2 className="section-h first">AVAX/USD sellers</h2>
          <div className="mini-ledger">
            {sellers.map((a) => (
              <a key={a.agentId.toString()} className="mini-row" href={`#/agent/${a.agentId}`}>
                <Avatar seed={a.owner} name={a.card?.name ?? "?"} size={40} />
                <span className="agent-text">
                  <span className="name">{a.card?.name}</span>
                  <span className="desc mono">
                    #{pad(a.agentId)} · {validated[a.agentId.toString()] ?? 0} validations
                  </span>
                </span>
                <ScoreBar count={a.count} average={a.average} />
                <Status count={a.count} average={a.average} />
              </a>
            ))}
          </div>
          <h2 className="section-h">Other agents</h2>
          <div className="mini-ledger">
            {others.map((a) => (
              <a key={a.agentId.toString()} className="mini-row" href={`#/agent/${a.agentId}`}>
                <Avatar seed={a.owner} name={a.card?.name ?? "?"} size={40} />
                <span className="agent-text">
                  <span className="name">{a.card?.name}</span>
                  <span className="desc mono">
                    #{pad(a.agentId)} · {short(a.owner)}
                  </span>
                </span>
                <ScoreBar count={a.count} average={a.average} />
                <Status count={a.count} average={a.average} />
              </a>
            ))}
          </div>
        </div>

        <aside className="console">
          <div className="console-top">
            <span className="mono label">TREASURY BOT · AGENT #{buyer?.agentId ?? "?"}</span>
            <span className={`mono label ${running ? "trusted" : ""}`}>{running ? "● RUNNING" : "IDLE"}</span>
          </div>
          <button className="solid-cta" onClick={run} disabled={running || !BUYER_URL}>
            {running ? "Hiring on Fuji…" : "Run Treasury Bot · 4 rounds"}
          </button>
          {err && <p className="error-line small">{err}</p>}
          <div className="console-log mono" ref={logBox} aria-live="polite">
            {events.length === 0 && <div className="dim">Waiting for a run. Each round is a real x402 payment and a real on-chain review.</div>}
            {events.map((e) => {
              const link = e.tx ? explorerTx(e.tx) : null;
              return (
                <div key={e.i} className={`ev ev-${e.level}`}>
                  <span className="dim">{e.t}</span> {e.text}
                  {e.tx && (
                    <>
                      {" "}
                      {link ? (
                        <a href={link} target="_blank" rel="noreferrer">
                          {short(e.tx)} ↗
                        </a>
                      ) : (
                        <span className="dim">{short(e.tx)}</span>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </aside>
      </div>
    </section>
  );
}
