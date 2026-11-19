import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  type Account,
  type Chain,
  type Transport,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { AidaClient, HARDHAT_KEYS, chains, type Deployment } from "@aida/sdk";

const deployments = import.meta.glob<Deployment>("../../../deployments/*.json", { eager: true, import: "default" });

export const CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID ?? 31337);
export const chain: Chain = chains[CHAIN_ID];
export const deployment: Deployment | undefined = Object.values(deployments).find((d) => d.chainId === CHAIN_ID);
export const RPC_URL: string = import.meta.env.VITE_RPC_URL ?? chain.rpcUrls.default.http[0];
export const publicClient = createPublicClient({
  chain,
  transport: http(RPC_URL, { batch: { batchSize: 50, wait: 16 }, retryCount: 4, retryDelay: 400 }),
});
export const readClient = deployment ? new AidaClient(publicClient, deployment) : null;
export const explorerTx = (h: string) => (CHAIN_ID === 43113 ? `https://testnet.snowtrace.io/tx/${h}` : null);
export const explorerAddr = (a: string) => (CHAIN_ID === 43113 ? `https://testnet.snowtrace.io/address/${a}` : null);

// Demo identities, local chain only: Hardhat's well-known test keys (never hold real funds).
// On Fuji there are no keys in the browser: connect your own Core / MetaMask wallet. The one shortcut, off by
// default, is the demo signer (vite.config.ts): a pause-only operator key held by the dev server.
const LOCAL_LABELS = ["Guardian (human)", "Trust Oracle owner", "Price Pro owner", "FastQuote owner", "Audit Lab owner", "Treasury Bot owner"];
export const DEMO_ACCOUNTS: { label: string; key: string }[] = CHAIN_ID === 31337 ? HARDHAT_KEYS.map((key, n) => ({ label: LOCAL_LABELS[n], key })) : [];
export const GUARDIAN_DEMO_LABEL = "Kill-switch operator (demo signer)";
declare const __AIDA_SIGNER_TOKEN__: string | null;
const SIGNER_TOKEN: string | null = typeof __AIDA_SIGNER_TOKEN__ === "string" ? __AIDA_SIGNER_TOKEN__ : null;
const signer = (msg: object) =>
  fetch("/__signer", { method: "POST", headers: { "content-type": "application/json", "x-aida-signer-token": SIGNER_TOKEN ?? "" }, body: JSON.stringify(msg) });

type Wallet = WalletClient<Transport, Chain, Account>;
type Ctx = {
  wallet: Wallet | null;
  label: string;
  client: AidaClient | null;
  useDemo: (key: `0x${string}`, label: string) => void;
  /** Fuji demo only: address of the dev server's pause-only operator signer, or null when it is switched off. */
  guardianDemo: `0x${string}` | null;
  useGuardianDemo: () => void;
  connectInjected: () => Promise<void>;
  disconnect: () => void;
  error: string;
};

const WalletCtx = createContext<Ctx | null>(null);

declare global {
  interface Window {
    ethereum?: { request(args: { method: string; params?: unknown[] }): Promise<unknown> };
    avalanche?: Window["ethereum"];
  }
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [label, setLabel] = useState("");
  const [error, setError] = useState("");

  const useDemo = useCallback((key: `0x${string}`, l: string) => {
    setWallet(createWalletClient({ account: privateKeyToAccount(key), chain, transport: http(RPC_URL) }));
    setLabel(l);
    setError("");
  }, []);

  const [guardianDemo, setGuardianDemo] = useState<`0x${string}` | null>(null);
  useEffect(() => {
    if (CHAIN_ID !== 43113 || !import.meta.env.DEV || !SIGNER_TOKEN) return;
    signer({ action: "address" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j?.address && setGuardianDemo(j.address))
      .catch(() => {});
  }, []);
  const useGuardianDemo = useCallback(() => {
    if (!guardianDemo) return;
    // Reads go to the public RPC; only eth_sendTransaction goes to the dev server, which signs setPaused and nothing else.
    const request = async ({ method, params }: { method: string; params?: unknown }) => {
      if (method === "eth_accounts" || method === "eth_requestAccounts") return [guardianDemo];
      if (method === "eth_chainId") return `0x${CHAIN_ID.toString(16)}`;
      if (method === "eth_sendTransaction") {
        const [tx] = params as [{ to: string; data: string }];
        const r = await signer({ action: "send", to: tx.to, data: tx.data });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "demo signer refused");
        return j.hash;
      }
      return publicClient.request({ method, params } as never);
    };
    setWallet(createWalletClient({ account: guardianDemo, chain, transport: custom({ request }) }) as unknown as Wallet);
    setLabel(GUARDIAN_DEMO_LABEL);
    setError("");
  }, [guardianDemo]);

  const connectInjected = useCallback(async () => {
    const eth = window.avalanche ?? window.ethereum;
    if (!eth) return setError("No wallet found (Core / MetaMask).");
    try {
      const [address] = (await eth.request({ method: "eth_requestAccounts" })) as `0x${string}`[];
      const hexId = `0x${CHAIN_ID.toString(16)}`;
      try {
        await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] });
      } catch {
        await eth.request({
          method: "wallet_addEthereumChain",
          params: [{ chainId: hexId, chainName: chain.name, nativeCurrency: chain.nativeCurrency, rpcUrls: chain.rpcUrls.default.http, blockExplorerUrls: chain.blockExplorers ? [chain.blockExplorers.default.url] : [] }],
        });
      }
      setWallet(createWalletClient({ account: address, chain, transport: custom(eth) }) as unknown as Wallet);
      setLabel(`${address.slice(0, 6)}…${address.slice(-4)}`);
      setError("");
    } catch (e) {
      setError(`Wallet connection failed: ${(e as Error).message.split("\n")[0]}`);
    }
  }, []);

  const value = useMemo<Ctx>(
    () => ({
      wallet,
      label,
      error,
      client: wallet && deployment ? new AidaClient(publicClient, deployment, wallet) : null,
      useDemo,
      guardianDemo,
      useGuardianDemo,
      connectInjected,
      disconnect: () => {
        setWallet(null);
        setLabel("");
      },
    }),
    [wallet, label, error, useDemo, guardianDemo, useGuardianDemo, connectInjected],
  );
  return <WalletCtx.Provider value={value}>{children}</WalletCtx.Provider>;
}

export function useWallet() {
  const c = useContext(WalletCtx);
  if (!c) throw new Error("useWallet outside WalletProvider");
  return c;
}

export const errMsg = (e: unknown) => {
  const m = (e as { shortMessage?: string; message?: string }).shortMessage ?? (e as Error).message ?? String(e);
  return m.split("\n")[0];
};
