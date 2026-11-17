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
  const [done, setDone] = useState<{ agentId: bigint; txHash: string } | null>(null);

  const owner = w.wallet?.account.address ?? ZERO;
  const card: AgentCard = {
    type: CARD_TYPE,
    name: name.trim(),
    description: description.trim(),
    endpoints: [{ name: "http", endpoint: endpoint.trim() }],
    wallet: owner,
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!w.wallet || !w.client) return setErrors(["Connect a wallet or pick a demo account (top right) first."]);
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
        <div className="eyebrow mono">
          <span className="dot trusted" /> CONFIRMED ON-CHAIN
        </div>
        <h1 className="display-2">
          Agent #{pad(done.agentId)} <span className="light">has a passport.</span>
        </h1>
        <PassportCard id={done.agentId} owner={owner} card={card} />
        <p className="mono dim small tx">
          tx {done.txHash}{" "}
          {link && (
            <a href={link} target="_blank" rel="noreferrer">
              Snowtrace ↗
            </a>
          )}
        </p>
        <ArrowPill href={`#/agent/${done.agentId}`}>View agent profile</ArrowPill>
      </section>
    );
  }

  return (
    <section className="page">
      <div className="eyebrow mono">
        <span className="dot risky" /> MINT AN IDENTITY
      </div>
      <h1 className="display-2">
        Register <span className="light">an agent.</span>
      </h1>
      <p className="lead">The ERC-8004 agent card is stored in the token URI. The connected wallet becomes the NFT owner and the agent’s payout wallet.</p>
      <div className="register-grid">
        <form className="form" onSubmit={submit}>
          <label>
            <span className="label mono">AGENT NAME</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={64} placeholder="e.g. VN Legal Assistant" required />
          </label>
          <label>
            <span className="label mono">
              DESCRIPTION <span className="dim">{description.length}/500</span>
            </span>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} rows={4} placeholder="What the agent does, and for whom" />
          </label>
          <label>
            <span className="label mono">SERVICE ENDPOINT</span>
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
            {busy ? "Sending transaction…" : "Mint passport on-chain"}
          </button>
        </form>
        <aside className="preview">
          <span className="label mono">LIVE PREVIEW</span>
          <PassportCard id={0n} owner={owner} card={card} />
          <pre className="json mono">{JSON.stringify(card, null, 2)}</pre>
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
      <div className="passport-foot mono">
        <span>ERC-8004</span>
        <span>NO REVIEWS YET</span>
      </div>
    </div>
  );
}
