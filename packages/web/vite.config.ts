import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { avalancheFuji } from "viem/chains";
import { checkSignerRequest } from "./demo-signer.ts";

/**
 * Demo toggle, off by default (disclosed in the README): a kill-switch signer for recording the Fuji demo without
 * a wallet extension. It exists only when ALL of these hold: the dev server (`vite`, never a build), `--mode fuji`,
 * and AIDA_DEMO_SIGNER=1. It signs with the OPERATOR key from .env.operator, whose only power in AgentPolicy is
 * setPaused; it never loads the guardian key. Request checks (token, origin, JSON, calldata) are in demo-signer.ts.
 * The documented way to act as guardian is a real wallet: "Connect wallet".
 */
function demoSigner(): Plugin {
  const root = new URL("../../", import.meta.url);
  let token = "";
  const body = (req: IncomingMessage) =>
    new Promise<string>((res, rej) => {
      let s = "";
      req.on("data", (c) => ((s += c), s.length > 4096 && rej(new Error("body too large"))));
      req.on("end", () => res(s));
    });
  return {
    name: "aida-demo-signer",
    config(_c, env) {
      const on = env.command === "serve" && env.mode === "fuji" && process.env.AIDA_DEMO_SIGNER === "1" && existsSync(new URL(".env.operator", root));
      token = on ? randomBytes(24).toString("hex") : "";
      // Baked into the page this server serves, so only that page can call the signer. Null in every build.
      return { define: { __AIDA_SIGNER_TOKEN__: JSON.stringify(on ? token : null) } };
    },
    configureServer(server) {
      if (!token) return;
      server.middlewares.use("/__signer", async (req, res) => {
        const send = (code: number, data: unknown) => {
          res.statusCode = code;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify(data));
        };
        try {
          const dep = JSON.parse(readFileSync(new URL("deployments/43113.json", root), "utf8")) as { policy: string; agents: { buyer: { agentId: string } } };
          const port = server.config.server.port ?? 5181;
          const origins = [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
          const d = checkSignerRequest({ method: req.method, headers: req.headers, body: req.method === "POST" ? await body(req) : "" }, { token, origins, policy: dep.policy, agentId: BigInt(dep.agents.buyer.agentId) });
          if (!d.ok) return send(d.status, { error: d.error });
          const key = /^OPERATOR_PRIVATE_KEY=(0x[0-9a-fA-F]{64})$/m.exec(readFileSync(new URL(".env.operator", root), "utf8"))?.[1] as Hex | undefined;
          if (!key) return send(404, { error: "no OPERATOR_PRIVATE_KEY in .env.operator" });
          const account = privateKeyToAccount(key);
          if (d.action === "address") return send(200, { address: account.address });
          const rpc = process.env.VITE_RPC_URL ?? "https://avalanche-fuji-c-chain-rpc.publicnode.com";
          const pub = createPublicClient({ chain: avalancheFuji, transport: http(rpc) });
          await pub.call({ account: account.address, to: d.to, data: d.data }); // do not send what would revert
          const wallet = createWalletClient({ account, chain: avalancheFuji, transport: http(rpc) });
          return send(200, { hash: await wallet.sendTransaction({ to: d.to, data: d.data }) });
        } catch (e) {
          return send(500, { error: (e as Error).message.split("\n")[0] });
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), demoSigner()],
  server: { fs: { allow: ["../.."] } },
});
