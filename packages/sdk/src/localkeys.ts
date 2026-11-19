// Hardhat's well-known test keys (public, never hold real funds). Used only on the local chain 31337:
// account 0 is the guardian/deployer, 1-5 are the five demo agents.
import type { Hex } from "./x402.ts";

export const HARDHAT_KEYS: Hex[] = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
  "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
  "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
];
export const AGENT_ROLES = ["ORACLE", "PRICEPRO", "FASTQUOTE", "AUDIT", "BUYER"] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];
/** Local chain only: the Hardhat key for a role (index 1-5), or the guardian (index 0). */
export const localKey = (role: AgentRole | "GUARDIAN"): Hex => HARDHAT_KEYS[role === "GUARDIAN" ? 0 : AGENT_ROLES.indexOf(role) + 1];
