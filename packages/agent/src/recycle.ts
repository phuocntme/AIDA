// Testnet housekeeping: the sellers send what they earned (above a small gas reserve) back to the guardian,
// who can then `pnpm guardian deposit <avax>` it into the policy again. Usage: pnpm recycle
import { formatEther, parseEther, type Hex } from "viem";
import { loadNetwork } from "./config.ts";

const net = loadNetwork();
const guardian = net.dep.guardian as Hex | undefined;
if (!guardian) throw new Error("deployment has no guardian address");
const keep = parseEther(process.env.KEEP ?? "0.002");
for (const role of ["ORACLE", "PRICEPRO", "FASTQUOTE"] as const) {
  const w = net.agent(role);
  const extra = (await net.pub.getBalance({ address: w.account.address })) - keep;
  if (extra < parseEther("0.0002")) continue;
  const hash = await w.wallet.sendTransaction({ to: guardian, value: extra });
  await net.pub.waitForTransactionReceipt({ hash });
  console.log(`${role} → guardian ${formatEther(extra)} AVAX ${net.explorerTx(hash)}`);
}
console.log(`guardian wallet: ${formatEther(await net.pub.getBalance({ address: guardian }))} AVAX`);
