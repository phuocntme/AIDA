import { useState } from "react";
import { CARD_TYPE, validateCard, type AgentCard } from "@aida/sdk";
import { errMsg, explorerTx, useWallet } from "../aida.tsx";
import { ArrowPill, Avatar, pad, short } from "../ui.tsx";

const ZERO = "0x0000000000000000000000000000000000000000" as const;

export function Register() {
  const w = useWallet();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [endpoint, setEndpoint] = useState("https://");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [done, setDone] = useState<{ agentId: bigint; txHash: string; enrollTx: string } | null>(null);

  const owner = w.wallet?.account.address ?? ZERO;
  const card: AgentCard = {
    type: CARD_TYPE,
    name: name.trim(),
    description: description.trim(),
    endpoints: [{ name: "x402-style", endpoint: endpoint.trim() }],
    wallet: owner,
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!w.wallet || !w.client) return setErrors(["Connect a wallet first (top right)."]);
    const v = validateCard(card);
    if (!v.ok) return setErrors(v.errors);
    setErrors([]);
    setBusy(true);
    try {
      setDone(await w.client.register(card));
    } catch (err) {
      setErrors([`Transaction failed: ${errMsg(err)}`]);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    const link = explorerTx(done.txHash);
    return (
      <section className="page narrow-page">
        <h1 className="display-2">
          Agent #{pad(done.agentId)} registered
        </h1>
        <PassportCard id={done.agentId} owner={owner} card={card} />
        <p className="mono dim small tx">
          ERC-8004 identity {short(done.txHash)}{" "}
          {link && (
            <a href={link} target="_blank" rel="noreferrer">
              tx ↗
            </a>
          )}
          {" · "}AIDA directory {short(done.enrollTx)}{" "}
          {explorerTx(done.enrollTx) && (
            <a href={explorerTx(done.enrollTx)!} target="_blank" rel="noreferrer">
              tx ↗
            </a>
          )}
        </p>
        <ArrowPill href={`#/agent/${done.agentId}`}>Open profile</ArrowPill>
      </section>
    );
  }

  return (
    <section className="page">
      <h1 className="display-2">Register agent</h1>
      <div className="register-grid">
        <form className="form" onSubmit={submit}>
          <label>
            <span className="label mono">AGENT NAME</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={64} placeholder="e.g. VN Legal Assistant" required />
          </label>
          <label>
            <span className="label mono">DESCRIPTION</span>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} rows={4} placeholder="What it does" />
          </label>
          <label>
            <span className="label mono">ENDPOINT</span>
            <input value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="https://my-agent.xyz/api" />
          </label>
          {errors.length > 0 && (
            <ul className="errors">
              {errors.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          )}
          <button type="submit" className="solid-cta" disabled={busy}>
            {busy ? "Registering… (2 transactions)" : "Register"}
          </button>
        </form>
        <aside className="preview">
          <PassportCard id={0n} owner={owner} card={card} />
        </aside>
      </div>
    </section>
  );
}

function PassportCard({ id, owner, card }: { id: bigint; owner: string; card: AgentCard }) {
  const name = card.name || "Agent name";
  return (
    <div className="passport">
      <div className="passport-top mono">
        <span>AIDA · AGENT PASSPORT</span>
        <span>#{pad(id)}</span>
      </div>
      <div className="passport-main">
        <Avatar seed={owner} name={name} size={56} />
        <div>
          <div className="passport-name">{name}</div>
          <div className="mono dim small">{short(owner)}</div>
        </div>
      </div>
    </div>
  );
}
