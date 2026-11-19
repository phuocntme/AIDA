import type { AgentView } from "@aida/sdk";
import { verdictLabel } from "./verdict.ts";

export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
export const pad = (id: bigint) => id.toString().padStart(4, "0");

export function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0] ?? "")
      .join("")
      .toUpperCase() || "?"
  );
}

/** Square monogram; the accent underline hue comes from the owner address. */
export function Avatar({ seed, name, size = 48 }: { seed: string; name: string; size?: number }) {
  const h = parseInt(seed.slice(2, 8), 16) % 360;
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.33, boxShadow: `inset 0 -2px 0 hsl(${h} 70% 50%)` }} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

export function Status({ count, average, role }: { count: bigint; average: bigint; role?: string }) {
  const v = verdictLabel(count, average);
  return (
    <span className="status">
      <span className={`dot ${v.cls}`} />
      {role ?? v.text}
    </span>
  );
}

export function ScoreBar({ count, average }: { count: bigint; average: bigint }) {
  const v = verdictLabel(count, average);
  return (
    <span className="scorebar">
      <span className="num">{count === 0n ? "—" : average.toString()}</span>
      <span className="bar">
        <span className={v.cls} style={{ width: `${count === 0n ? 0 : Number(average)}%` }} />
      </span>
    </span>
  );
}

/**
 * Trust terrain — the signature element. A ridgeline drawn from real reputation:
 * each agent is a peak, its height is its average score.
 */
export function Terrain({ agents, width = 1440, height = 400, lines = 22, labels = true, tag }: { agents: AgentView[]; width?: number; height?: number; lines?: number; labels?: boolean; tag?: (a: AgentView) => string | undefined }) {
  const list = agents.length ? agents : [];
  const peaks = list.map((a, i) => ({
    x: (i + 0.5) / list.length,
    s: a.count === 0n ? 14 : Number(a.average),
    w: 0.32 / Math.max(list.length, 3),
    agent: a,
  }));
  const steps = 160;
  const hAt = (x: number, i: number) => {
    let h = 0;
    for (const p of peaks) {
      const d = (x - p.x) / p.w;
      h += p.s * 2.1 * Math.exp(-d * d);
    }
    return h + 7 * Math.sin(x * 37 + i * 1.3) * Math.sin(x * 9 + i * 0.7);
  };
  const scale = height / 400;
  const rows = Array.from({ length: lines }, (_, i) => {
    const base = (150 + i * (250 / lines)) * scale;
    const f = 0.35 + 0.65 * Math.sin((Math.PI * (i + 1)) / (lines + 1));
    const pts: string[] = [];
    for (let j = 0; j <= steps; j++) {
      const x = j / steps;
      pts.push(`${(x * width).toFixed(1)},${(base - hAt(x, i) * f * 0.62 * scale).toFixed(1)}`);
    }
    const shade = Math.round(38 + (i / (lines - 1)) * 120);
    return { pts: pts.join(" "), front: i === lines - 1, shade, base, f, i };
  });
  const ref = rows[Math.max(0, lines - 6)];
  return (
    <div className="terrain" style={{ height }}>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
        {rows.map((r) => (
          <g key={r.i}>
            <path d={`M0,${height} L${r.pts.replaceAll(" ", " L")} L${width},${height} Z`} fill="var(--bg)" />
            <polyline points={r.pts} fill="none" stroke={r.front ? "var(--accent)" : `rgb(${r.shade},${r.shade},${r.shade})`} strokeWidth={r.front ? 1.6 : 1} vectorEffect="non-scaling-stroke" />
          </g>
        ))}
      </svg>
      {labels &&
        peaks.map((p) => {
          const top = ref.base - hAt(p.x, ref.i) * ref.f * 0.62 * scale;
          const v = verdictLabel(p.agent.count, p.agent.average);
          return (
            <a key={p.agent.agentId.toString()} className="peak" href={`#/agent/${p.agent.agentId}`} style={{ left: `${p.x * 100}%`, top: `max(0px, calc(${((top / height) * 100).toFixed(2)}% - 64px))` }}>
              <span className="peak-chip">
                <span className={`dot ${v.cls}`} />
                <span className="peak-name">{p.agent.card?.name ?? `#${p.agent.agentId}`}</span>
                <span className="dim">{p.agent.count === 0n ? (tag?.(p.agent)?.toLowerCase() ?? "new") : p.agent.average.toString()}</span>
              </span>
              <span className="peak-stem" />
            </a>
          );
        })}
    </div>
  );
}

export function ArrowPill({ href, children, onClick }: { href?: string; children: React.ReactNode; onClick?: () => void }) {
  const inner = (
    <>
      {children}
      <span className="arrow-dot" aria-hidden="true">
        <svg width="14" height="14" viewBox="0 0 16 16">
          <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </>
  );
  return href ? (
    <a className="pill-cta" href={href}>
      {inner}
    </a>
  ) : (
    <button className="pill-cta" onClick={onClick}>
      {inner}
    </button>
  );
}

/** Review scores over time (dots) + running trust average (line); dashed line = the 60 hire threshold. */
export function TrustChart({ points }: { points: { score: number; timestamp: bigint }[] }) {
  if (points.length < 2) return null;
  const W = 640, H = 168, P = { l: 30, r: 12, t: 12, b: 22 };
  const sorted = [...points].sort((a, b) => Number(a.timestamp - b.timestamp));
  const x = (i: number) => P.l + (i / (sorted.length - 1)) * (W - P.l - P.r);
  const y = (v: number) => P.t + (1 - v / 100) * (H - P.t - P.b);
  let sum = 0;
  const avg = sorted.map((p, i) => ((sum += p.score), sum / (i + 1)));
  const line = avg.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = `${line} L${x(sorted.length - 1).toFixed(1)},${y(0)} L${x(0)},${y(0)} Z`;
  const c = (v: number) => (v >= 80 ? "var(--green)" : v >= 60 ? "var(--amber)" : "var(--accent)");
  const fmt = (t: bigint) => new Date(Number(t) * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return (
    <figure className="trust-chart" aria-label={`Trust over ${sorted.length} reviews`}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img">
        <defs>
          <linearGradient id="tc-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={c(avg[avg.length - 1])} stopOpacity="0.18" />
            <stop offset="1" stopColor={c(avg[avg.length - 1])} stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 50, 100].map((v) => (
          <g key={v}>
            <line x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} stroke="#1c1c1c" />
            <text x={P.l - 8} y={y(v) + 4} textAnchor="end" className="tc-axis">
              {v}
            </text>
          </g>
        ))}
        <line x1={P.l} x2={W - P.r} y1={y(60)} y2={y(60)} stroke="var(--accent)" strokeDasharray="4 4" strokeOpacity="0.6" />
        <text x={W - P.r} y={y(60) - 6} textAnchor="end" className="tc-axis tc-60">
          60
        </text>
        <path d={area} fill="url(#tc-fill)" />
        <path d={line} fill="none" stroke={c(avg[avg.length - 1])} strokeWidth="2" />
        {sorted.map((p, i) => (
          <circle key={i} cx={x(i)} cy={y(p.score)} r="3.2" fill={c(p.score)} />
        ))}
        <text x={P.l} y={H - 4} className="tc-axis">
          {fmt(sorted[0].timestamp)}
        </text>
        <text x={W - P.r} y={H - 4} textAnchor="end" className="tc-axis">
          {fmt(sorted[sorted.length - 1].timestamp)}
        </text>
      </svg>
    </figure>
  );
}
