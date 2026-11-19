// CLI for the Treasury Bot. Usage: pnpm hire --rounds 3   |   pnpm hire --attack
import { parseArgs } from "node:util";
import { loadNetwork } from "./config.ts";
import { runAttack, runBuyer, type BuyerEvent } from "./buyer.ts";

const { values } = parseArgs({ allowPositionals: true, options: { rounds: { type: "string", default: "3" }, report: { type: "boolean", default: true }, attack: { type: "boolean", default: false } } });
const color: Record<BuyerEvent["level"], string> = { head: "\x1b[1m", info: "", ok: "\x1b[32m", warn: "\x1b[33m", err: "\x1b[31m" };
const { explorerTx } = loadNetwork();
const emit = (e: BuyerEvent) => console.log(`${e.level === "head" ? "\n" : "  "}${color[e.level]}${e.text}\x1b[0m${e.tx ? `  \x1b[2m${explorerTx(e.tx)}\x1b[0m` : ""}`);
if (values.attack) process.exit((await runAttack({ emit })) ? 0 : 1);
await runBuyer({ rounds: Number(values.rounds), report: values.report, emit });
