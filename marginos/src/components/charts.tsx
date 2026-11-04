"use client";

import { useEffect, useMemo, useRef, useState } from "react";

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver((e) => setW(e[0].contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

const fmtGbp = (n: number) => `${n < 0 ? "−" : ""}£${Math.abs(n).toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;
const fmtK = (n: number) => (Math.abs(n) >= 1000 ? `£${(n / 1000).toFixed(Math.abs(n) >= 10000 ? 0 : 1)}k` : `£${Math.round(n)}`);

function niceTicks(max: number, count = 4) {
  if (max <= 0) return [0];
  const raw = max / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const ticks = [];
  for (let v = 0; v <= max + step * 0.01; v += step) ticks.push(v);
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

function Tooltip({ x, y, width, children }: { x: number; y: number; width: number; children: React.ReactNode }) {
  const left = Math.min(Math.max(8, x + 12), width - 188);
  return (
    <div className="pointer-events-none absolute z-10 w-[180px] rounded border border-line-strong bg-surface px-2.5 py-2 text-[12px] shadow-[0_8px_24px_rgba(20,20,20,0.10)]" style={{ left, top: Math.max(0, y - 10) }}>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Daily comparison line chart: current vs previous period, aligned by day of month.
// ---------------------------------------------------------------------------

export function LineCompare({ current, previous, currentLabel, previousLabel, height = 220, metric = "Net revenue" }: { current: { day: string; value: number }[]; previous: { day: string; value: number }[]; currentLabel: string; previousLabel: string; height?: number; metric?: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pad = { l: 44, r: 12, t: 10, b: 22 };
  const n = Math.max(current.length, previous.length);
  const max = Math.max(1, ...current.map((d) => d.value), ...previous.map((d) => d.value));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1];
  const iw = Math.max(10, width - pad.l - pad.r);
  const ih = height - pad.t - pad.b;
  const x = (i: number) => pad.l + (n <= 1 ? 0 : (i / (n - 1)) * iw);
  const y = (v: number) => pad.t + ih - (v / top) * ih;
  const path = (s: { value: number }[]) => s.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d.value).toFixed(1)}`).join("");
  const labelsEvery = Math.ceil(n / 6);
  return (
    <div>
      <div className="mb-2 flex items-center gap-4 text-[12px] text-ink-2">
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-[2px] w-3.5 rounded" style={{ background: "var(--series-1)" }} />{currentLabel}</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-[2px] w-3.5 rounded border-t border-dashed" style={{ borderColor: "var(--series-prev)" }} />{previousLabel}</span>
      </div>
      <div ref={ref} className="relative" style={{ height }} onMouseLeave={() => setHover(null)}>
        {width > 0 && (
          <svg width={width} height={height} role="img" aria-label={`${metric} by day, ${currentLabel} compared with ${previousLabel}`}
            onMouseMove={(e) => {
              const r = (e.currentTarget as SVGElement).getBoundingClientRect();
              const i = Math.round(((e.clientX - r.left - pad.l) / iw) * (n - 1));
              setHover(i >= 0 && i < n ? i : null);
            }}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} stroke="var(--grid)" />
                <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--muted)" className="num">{fmtK(t)}</text>
              </g>
            ))}
            {Array.from({ length: n }, (_, i) => i).filter((i) => i % labelsEvery === 0).map((i) => (
              <text key={i} x={x(i)} y={height - 6} textAnchor="middle" fontSize="11" fill="var(--muted)">{i + 1}</text>
            ))}
            <path d={path(previous)} fill="none" stroke="var(--series-prev)" strokeWidth={1.5} strokeDasharray="3 3" />
            <path d={path(current)} fill="none" stroke="var(--series-1)" strokeWidth={2} />
            {hover !== null && (
              <g>
                <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + ih} stroke="var(--border-strong)" />
                {current[hover] && <circle cx={x(hover)} cy={y(current[hover].value)} r={4} fill="var(--series-1)" stroke="var(--surface)" strokeWidth={2} />}
                {previous[hover] && <circle cx={x(hover)} cy={y(previous[hover].value)} r={3.5} fill="var(--series-prev)" stroke="var(--surface)" strokeWidth={2} />}
              </g>
            )}
          </svg>
        )}
        {hover !== null && width > 0 && (
          <Tooltip x={x(hover)} y={pad.t} width={width}>
            <div className="mb-1 text-muted">Day {hover + 1}</div>
            <div className="flex justify-between gap-2"><span className="text-ink-2">{current[hover]?.day ? new Date(current[hover].day).toLocaleDateString("en-GB", { day: "numeric", month: "short", weekday: "short", timeZone: "UTC" }) : currentLabel}</span><span className="num text-ink">{current[hover] ? fmtGbp(current[hover].value) : "—"}</span></div>
            <div className="flex justify-between gap-2"><span className="text-muted">{previous[hover]?.day ? new Date(previous[hover].day).toLocaleDateString("en-GB", { day: "numeric", month: "short", weekday: "short", timeZone: "UTC" }) : previousLabel}</span><span className="num text-ink-2">{previous[hover] ? fmtGbp(previous[hover].value) : "—"}</span></div>
          </Tooltip>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Contribution bridge (waterfall)
// ---------------------------------------------------------------------------

export function Waterfall({ start, end, startLabel, endLabel, steps, height = 240 }: { start: number; end: number; startLabel: string; endLabel: string; steps: { label: string; value: number; note?: string }[]; height?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const bars = useMemo(() => {
    const out: { label: string; from: number; to: number; kind: "total" | "up" | "down"; value: number; note?: string }[] = [{ label: startLabel, from: 0, to: start, kind: "total", value: start }];
    let run = start;
    for (const s of steps) { out.push({ label: s.label, from: run, to: run + s.value, kind: s.value >= 0 ? "up" : "down", value: s.value, note: s.note }); run += s.value; }
    out.push({ label: endLabel, from: 0, to: end, kind: "total", value: end });
    return out;
  }, [start, end, steps, startLabel, endLabel]);
  const pad = { l: 8, r: 8, t: 22, b: 46 };
  const vals = bars.flatMap((b) => [b.from, b.to]);
  const lo = Math.min(...vals) * 0.96;
  const min = Math.max(0, lo > 0 ? lo - (Math.max(...vals) - lo) * 0.6 : lo);
  const max = Math.max(...vals);
  const iw = Math.max(10, width - pad.l - pad.r);
  const ih = height - pad.t - pad.b;
  const bw = iw / bars.length;
  const y = (v: number) => pad.t + ih - ((v - min) / (max - min || 1)) * ih;
  return (
    <div ref={ref} className="relative" style={{ height }} onMouseLeave={() => setHover(null)}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="Contribution bridge between periods">
          <line x1={pad.l} x2={width - pad.r} y1={pad.t + ih} y2={pad.t + ih} stroke="var(--border-strong)" />
          {bars.map((b, i) => {
            const x0 = pad.l + i * bw + bw * 0.18;
            const w = bw * 0.64;
            const yTop = y(Math.max(b.from, b.to));
            const h = Math.max(1.5, Math.abs(y(b.from) - y(b.to)));
            const fill = b.kind === "total" ? "#5c5c57" : b.kind === "up" ? "var(--good)" : "var(--bad)";
            return (
              <g key={i} onMouseEnter={() => setHover(i)}>
                <rect x={pad.l + i * bw} y={pad.t} width={bw} height={ih} fill="transparent" />
                <rect x={x0} y={yTop} width={w} height={h} rx={2} fill={fill} opacity={hover === null || hover === i ? 1 : 0.55} />
                {i < bars.length - 1 && <line x1={x0 + w} x2={x0 + bw} y1={y(b.to)} y2={y(b.to)} stroke="var(--faint)" strokeDasharray="2 2" />}
                <text x={x0 + w / 2} y={yTop - 6} textAnchor="middle" fontSize="11" fill="var(--ink-2)" className="num">{b.kind === "total" ? fmtK(b.value) : `${b.value >= 0 ? "+" : "−"}${fmtK(Math.abs(b.value)).replace("£", "£")}`}</text>
                <foreignObject x={pad.l + i * bw} y={pad.t + ih + 6} width={bw} height={pad.b - 6}>
                  <div className="px-0.5 text-center text-[11px] leading-[13px] text-muted">{b.label}</div>
                </foreignObject>
              </g>
            );
          })}
        </svg>
      )}
      {hover !== null && width > 0 && bars[hover] && (
        <Tooltip x={pad.l + hover * bw + bw / 2} y={pad.t} width={width}>
          <div className="text-ink">{bars[hover].label}</div>
          <div className="num mt-0.5 text-ink-2">{bars[hover].kind === "total" ? fmtGbp(bars[hover].value) : `${bars[hover].value >= 0 ? "+" : ""}${fmtGbp(bars[hover].value)}`}</div>
          {bars[hover].note && <div className="mt-1 text-muted">{bars[hover].note}</div>}
        </Tooltip>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Horizontal bars (single series)
// ---------------------------------------------------------------------------

export function HBars({ rows, color = "var(--series-1)", compare }: { rows: { label: string; value: number; sub?: string; previous?: number }[]; color?: string; compare?: string }) {
  const format = fmtGbp;
  const max = Math.max(1, ...rows.map((r) => Math.max(Math.abs(r.value), Math.abs(r.previous ?? 0))));
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r.label} className="group" title={r.previous !== undefined ? `${r.label}: ${format(r.value)} (${compare ?? "previous"} ${format(r.previous)})` : `${r.label}: ${format(r.value)}`}>
          <div className="mb-1 flex items-baseline justify-between gap-2 text-[12px]">
            <span className="truncate text-ink-2">{r.label}{r.sub && <span className="ml-1.5 text-muted">{r.sub}</span>}</span>
            <span className="num text-ink">{format(r.value)}{r.previous !== undefined && <span className="ml-1.5 text-muted">{format(r.previous)}</span>}</span>
          </div>
          <div className="relative h-1.5 rounded-sm bg-surface-3">
            <div className="absolute inset-y-0 left-0 rounded-sm" style={{ width: `${(Math.abs(r.value) / max) * 100}%`, background: color }} />
            {r.previous !== undefined && <div className="absolute -top-0.5 h-2.5 w-[2px] rounded bg-ink-2" style={{ left: `calc(${(Math.abs(r.previous) / max) * 100}% - 1px)` }} />}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Menu engineering scatter
// ---------------------------------------------------------------------------

export function QuadrantScatter({ points, xThreshold, yThreshold, height = 300, onSelect }: { points: { id: string; label: string; x: number; y: number; highlight?: boolean }[]; xThreshold: number; yThreshold: number; height?: number; onSelect?: (id: string) => void }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<string | null>(null);
  const pad = { l: 46, r: 14, t: 14, b: 34 };
  const maxX = Math.max(1, ...points.map((p) => p.x)) * 1.08;
  const ys = points.map((p) => p.y);
  const minY = Math.min(0, ...ys);
  const maxY = Math.max(1, ...ys) * 1.1;
  const iw = Math.max(10, width - pad.l - pad.r);
  const ih = height - pad.t - pad.b;
  const x = (v: number) => pad.l + (v / maxX) * iw;
  const y = (v: number) => pad.t + ih - ((v - minY) / (maxY - minY)) * ih;
  const yt = niceTicks(maxY, 4).filter((t) => t <= maxY);
  const xt = niceTicks(maxX, 4).filter((t) => t <= maxX);
  const hp = points.find((p) => p.id === hover);
  return (
    <div ref={ref} className="relative" style={{ height }} onMouseLeave={() => setHover(null)}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="Menu engineering: units sold against contribution per unit">
          {yt.map((t) => (
            <g key={t}><line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} stroke="var(--grid)" /><text x={pad.l - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--muted)" className="num">£{t}</text></g>
          ))}
          {xt.map((t) => <text key={t} x={x(t)} y={height - 16} textAnchor="middle" fontSize="11" fill="var(--muted)" className="num">{t}</text>)}
          <text x={pad.l} y={height - 1} fontSize="10" fill="var(--faint)">Units sold</text>
          <line x1={x(xThreshold)} x2={x(xThreshold)} y1={pad.t} y2={pad.t + ih} stroke="var(--border-strong)" strokeDasharray="4 3" />
          <line x1={pad.l} x2={width - pad.r} y1={y(yThreshold)} y2={y(yThreshold)} stroke="var(--border-strong)" strokeDasharray="4 3" />
          <text x={width - pad.r - 4} y={pad.t + 12} textAnchor="end" fontSize="11" fill="var(--faint)">High vol, high contrib.</text>
          <text x={pad.l + 6} y={pad.t + 12} fontSize="11" fill="var(--faint)">Low vol, high contrib.</text>
          <text x={width - pad.r - 4} y={pad.t + ih - 6} textAnchor="end" fontSize="11" fill="var(--faint)">High vol, low contrib.</text>
          <text x={pad.l + 6} y={pad.t + ih - 6} fontSize="11" fill="var(--faint)">Low vol, low contrib.</text>
          {points.map((p) => (
            <g key={p.id} onMouseEnter={() => setHover(p.id)} onClick={() => onSelect?.(p.id)} style={{ cursor: onSelect ? "pointer" : undefined }}>
              <circle cx={x(p.x)} cy={y(p.y)} r={12} fill="transparent" />
              <circle cx={x(p.x)} cy={y(p.y)} r={hover === p.id ? 6 : 4.5} fill={p.highlight ? "var(--warn)" : "var(--series-1)"} stroke="var(--surface)" strokeWidth={2} />
            </g>
          ))}
        </svg>
      )}
      {hp && width > 0 && (
        <Tooltip x={x(hp.x)} y={y(hp.y)} width={width}>
          <div className="text-ink">{hp.label}</div>
          <div className="mt-1 flex justify-between text-ink-2"><span>Units</span><span className="num">{Math.round(hp.x)}</span></div>
          <div className="flex justify-between text-ink-2"><span>Contribution / unit</span><span className="num">£{hp.y.toFixed(2)}</span></div>
        </Tooltip>
      )}
    </div>
  );
}

export function Spark({ values, color = "var(--series-1)", width = 88, height = 24 }: { values: number[]; color?: string; width?: number; height?: number }) {
  if (values.length < 2) return null;
  const max = Math.max(...values), min = Math.min(...values);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * width},${height - 2 - ((v - min) / (max - min || 1)) * (height - 4)}`).join(" ");
  return <svg width={width} height={height} aria-hidden><polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} /></svg>;
}
