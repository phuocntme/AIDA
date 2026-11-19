#!/usr/bin/env node
// AIDA MCP server (stdio): lets any MCP client (Claude Desktop, Claude Code, Cursor…) look up agents, check trust
// before transacting, and ask AgentPolicy whether a payment would be allowed. Read-only: it holds no key, so an
// LLM connected to it can propose a payment but cannot make one.
// Env: CHAIN_ID (31337 | 43113), RPC_URL
import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { BaseError, ContractFunctionRevertedError, createPublicClient, http } from "viem";
import { z } from "zod";
import { AidaClient, chains, type Deployment } from "@aida/sdk";
import { UNTRUSTED_NOTICE, createTools } from "./tools.ts";

const chainId = Number(process.env.CHAIN_ID ?? 31337);
const chain = chains[chainId];
if (!chain) throw new Error(`Unsupported CHAIN_ID ${chainId}`);
const dep: Deployment = JSON.parse(readFileSync(new URL(`../../../deployments/${chainId}.json`, import.meta.url), "utf8"));
const rpc = process.env.RPC_URL ?? chain.rpcUrls.default.http[0];
const pub = createPublicClient({ chain, transport: http(rpc) });
const aida = new AidaClient(pub, dep);
const revertName = (e: unknown) => {
  const r = e instanceof BaseError ? e.walk((x) => x instanceof ContractFunctionRevertedError) : null;
  return r instanceof ContractFunctionRevertedError ? (r.data?.errorName ?? null) : null;
};
const tools = createTools(aida, { revertName });

const server = new McpServer({ name: "aida", version: "0.1.0" });

const result = (data: unknown) => ({ content: [{ type: "text" as const, text: `[AIDA data — ${UNTRUSTED_NOTICE}]\n${JSON.stringify(data, null, 2)}` }] });
const wrap =
  <A,>(fn: (a: A) => Promise<unknown>) =>
  async (a: A) => {
    try {
      return result(await fn(a));
    } catch (e) {
      return { isError: true, content: [{ type: "text" as const, text: (e as Error).message.split("\n")[0] }] };
    }
  };

server.registerTool(
  "aida_search_agents",
  {
    title: "Search AIDA agents",
    description: `Search the AIDA on-chain agent registry on ${chain.name}. Returns agents with their ERC-8004 registration card and trust score (0-100), best first.`,
    inputSchema: { query: z.string().optional().describe("Text to match in name or description"), minTrust: z.number().int().min(0).max(100).optional().describe("Only agents with at least this average score") },
  },
  wrap(tools.searchAgents),
);

server.registerTool(
  "aida_get_agent",
  {
    title: "Get an AIDA agent",
    description: "Full profile of one agent: card, endpoints, owner, trust score, its payment-backed reviews (and which were scored on-chain against Chainlink) and every independent validation.",
    inputSchema: { agentId: z.string().describe("AIDA agent id, e.g. \"1\"") },
  },
  wrap(tools.getAgent),
);

server.registerTool(
  "aida_check_trust",
  {
    title: "Check whether to trust an agent",
    description: "Call before paying or delegating to another agent. Returns allow/deny with the reason, based on its on-chain reputation.",
    inputSchema: { agentId: z.string(), minTrust: z.number().int().min(0).max(100).optional().describe("Threshold, default 60") },
  },
  wrap(tools.checkTrust),
);

server.registerTool(
  "aida_check_payment",
  {
    title: "Would AgentPolicy allow this payment?",
    description: "Before proposing that an agent pays someone, ask its on-chain AgentPolicy (read-only eth_call): returns allow/deny and, on deny, the contract's revert (RecipientNotAllowed, OverPerPaymentCap, OverDailyCap, AgentPaused…). This tool never signs or sends anything.",
    inputSchema: { agentId: z.string().describe("The paying agent's id"), to: z.string().describe("Recipient 0x address"), amountWei: z.string().describe("Amount in wei, decimal string") },
  },
  wrap(tools.checkPayment),
);

await server.connect(new StdioServerTransport());
console.error(`AIDA MCP server ready on ${chain.name} (read-only)`);
