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

export function Status({ count, average }: { count: bigint; average: bigint }) {
  const v = verdictLabel(count, average);
  return (
    <span className="status">
      <span className={`dot ${v.cls}`} />
      {v.text}
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
export function Terrain({ agents, width = 1440, height = 400, lines = 22, labels = true }: { agents: AgentView[]; width?: number; height?: number; lines?: number; labels?: boolean }) {
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
                {p.agent.card?.name ?? `#${p.agent.agentId}`}
                <span className="dim">{p.agent.count === 0n ? "new" : p.agent.average.toString()}</span>
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
