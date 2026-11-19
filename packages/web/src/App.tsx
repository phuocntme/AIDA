import { useEffect, useState } from "react";
import { CHAIN_ID, DEMO_ACCOUNTS, GUARDIAN_DEMO_LABEL, chain, deployment, useWallet } from "./aida.tsx";
import { Directory } from "./pages/Directory.tsx";
import { Register } from "./pages/Register.tsx";
import { Profile } from "./pages/Profile.tsx";
import { Economy } from "./pages/Economy.tsx";
import { Ticker } from "./Ticker.tsx";
import { short } from "./ui.tsx";

function useHash() {
  const [hash, setHash] = useState(location.hash || "#/");
  useEffect(() => {
    const on = () => {
      setHash(location.hash || "#/");
      if (!location.hash.startsWith("#directory")) window.scrollTo(0, 0);
    };
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  return hash;
}

function WalletBar() {
  const w = useWallet();
  const address = w.wallet?.account.address;
  const named = w.label && !w.label.includes("…");
  return (
    <div className="wallet">
      {!w.wallet && (DEMO_ACCOUNTS.length > 0 || w.guardianDemo) && (
        <select
          aria-label="Demo account"
          className="demo-select"
          value=""
          onChange={(e) => {
            if (e.target.value === "guardian") return w.useGuardianDemo();
            const a = DEMO_ACCOUNTS[Number(e.target.value)];
            if (a) w.useDemo(a.key as `0x${string}`, a.label);
          }}
        >
          <option value="">Demo account</option>
          {w.guardianDemo && <option value="guardian">{GUARDIAN_DEMO_LABEL}</option>}
          {DEMO_ACCOUNTS.map((a, i) => (
            <option key={a.key} value={i}>
              {a.label}
            </option>
          ))}
        </select>
      )}
      {address ? (
        <span className="who" title={address}>
          <span className="dot trusted" />
          {named && <>{w.label} · </>}
          <span className="mono">{short(address)}</span>
          <button className="link" onClick={w.disconnect}>
            Disconnect
          </button>
        </span>
      ) : (
        <button className="connect" onClick={w.connectInjected}>
          Connect wallet
        </button>
      )}
      {w.error && <span className="error-line small">{w.error}</span>}
    </div>
  );
}

export function App() {
  const hash = useHash();
  const profile = /^#\/agent\/(\d+)$/.exec(hash);
  const onRegister = hash === "#/register";
  const onEconomy = hash === "#/economy";
  return (
    <>
      <div className="guides" aria-hidden="true" />
      <header className="topbar">
        <a href="#/" className="brand" aria-label="AIDA home">
          <svg width="26" height="22" viewBox="0 0 26 22" aria-hidden="true">
            <path d="M13 1 25 21H18.5L13 11.5 7.5 21H1Z" fill="var(--accent)" />
          </svg>
          <span>aida</span>
          {chain && <span className="net-chip mono">{chain.id === 43113 ? "fuji" : chain.id === 31337 ? "local" : chain.name.toLowerCase()}</span>}
        </a>
        <nav>
          <a href="#/" className={!onRegister && !onEconomy ? "active" : ""}>
            Agents
          </a>
          {deployment?.agents && (
            <a href="#/economy" className={onEconomy ? "active" : ""}>
              Economy
            </a>
          )}
          <a href="#/register" className={onRegister ? "active" : ""}>
            Register
          </a>
        </nav>
        <WalletBar />
      </header>
      {deployment && <Ticker />}
      <main>
        {!deployment ? (
          <p className="page error-line">
            No deployment found for chain {CHAIN_ID} ({chain?.name}). Run <code>pnpm demo</code> or the deploy script first.
          </p>
        ) : profile ? (
          <Profile agentId={BigInt(profile[1])} />
        ) : onRegister ? (
          <Register />
        ) : onEconomy ? (
          <Economy />
        ) : (
          <Directory />
        )}
      </main>
    </>
  );
}
