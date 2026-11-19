// Manual smoke test against a running local demo: node test/smoke.mjs
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const client = new Client({ name: "smoke", version: "0" });
await client.connect(new StdioClientTransport({ command: "node", args: ["src/server.ts"], env: { ...process.env, CHAIN_ID: "31337" } }));
console.log("tools:", (await client.listTools()).tools.map((t) => t.name).join(", "));
const show = async (name, args) => console.log(`\n${name}`, JSON.stringify(args), "→\n", (await client.callTool({ name, arguments: args })).content[0].text.slice(0, 400));
await show("aida_search_agents", { minTrust: 60 });
await show("aida_check_trust", { agentId: "2" });
await show("aida_check_trust", { agentId: "1", minTrust: 80 });
await show("aida_check_payment", { agentId: "5", to: "0x000000000000000000000000000000000000dEaD", amountWei: "500000000000000" });
await client.close();
