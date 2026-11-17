// CLI for the Treasury Bot buyer agent. Usage: pnpm hire --rounds 6
import { parseArgs } from "node:util";
import { runBuyer, type BuyerEvent } from "./buyer.ts";

const { values } = parseArgs({ allowPositionals: true, options: { rounds: { type: "string", default: "6" }, report: { type: "boolean", default: true } } });
const color: Record<BuyerEvent["level"], string> = { head: "\x1b[1m", info: "", ok: "\x1b[32m", warn: "\x1b[33m", err: "\x1b[31m" };
await runBuyer({
  rounds: Number(values.rounds),
  report: values.report,
  emit: (e) => console.log(`${e.level === "head" ? "\n" : "  "}${color[e.level]}${e.text}\x1b[0m${e.tx ? `  \x1b[2mhttps://testnet.snowtrace.io/tx/${e.tx}\x1b[0m` : ""}`),
});
