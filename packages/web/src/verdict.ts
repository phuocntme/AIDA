export type VerdictCls = "trusted" | "okay" | "risky" | "unknown";

export function verdictLabel(count: bigint, average: bigint): { text: string; cls: VerdictCls } {
  if (count === 0n) return { text: "No reviews yet", cls: "unknown" };
  if (average >= 80n) return { text: "Trusted", cls: "trusted" };
  if (average >= 60n) return { text: "Okay", cls: "okay" };
  return { text: "Risky", cls: "risky" };
}
