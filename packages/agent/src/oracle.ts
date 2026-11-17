// AIDA Trust Oracle: sells trust reports about agents, only to callers with good AIDA reputation.
import { createPaidRoute, toJson, type PaidDeps, type PaidResponse, type RouteSpec } from "./paid.ts";

export type OracleDeps = PaidDeps & { minScore: number; onPaid?: RouteSpec["onPaid"] };
export type OracleResponse = PaidResponse;

export function verdictFor(count: bigint, average: bigint): "unknown" | "trusted" | "ok" | "risky" {
  if (count === 0n) return "unknown";
  if (average >= 80n) return "trusted";
  if (average >= 60n) return "ok";
  return "risky";
}

export function createOracle(d: OracleDeps) {
  return createPaidRoute(d, {
    route: /^\/report\/(\d+)$/,
    usage: "GET /report/:agentId",
    description: "AIDA trust report for one agent",
    minScore: d.minScore,
    precheck: async (m) => ((await d.registry.resolve(BigInt(m[1]))) ? null : { status: 404, body: { error: `target agent #${m[1]} is not registered in AIDA` } }),
    produce: async (m) => {
      const targetId = BigInt(m[1]);
      const [target, feedback] = await Promise.all([d.registry.resolve(targetId), d.registry.feedback(targetId)]);
      return {
        report: { target: toJson(target), feedback: toJson(feedback), verdict: verdictFor(target!.count, target!.average), generatedAt: new Date().toISOString() },
      };
    },
    onPaid: d.onPaid,
  });
}
