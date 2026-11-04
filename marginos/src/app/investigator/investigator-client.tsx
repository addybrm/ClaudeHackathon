"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { InvestigationReport } from "@/lib/ai/tools";
import { Badge, Button, cx } from "@/components/ui";

export interface SavedInvestigation {
  id: string;
  question: string;
  mode: "live" | "demo";
  model: string | null;
  status: string;
  report: (InvestigationReport & { answer?: undefined }) | { answer: string } | null;
  trace: TraceStep[];
  verification: Verification | null;
  error_message: string | null;
  duration_ms: number | null;
  period_current: string | null;
  created_at: string;
}

interface TraceStep { id: string; name: string; input: unknown; ok: boolean; result?: unknown; error?: string; ms: number; pending?: boolean }
interface Verification { figuresChecked: number; unverified: string[] }
interface Turn {
  key: string;
  question: string;
  mode: "live" | "demo" | null;
  model: string | null;
  status: "running" | "done" | "error";
  statusText: string;
  notes: string[];
  steps: TraceStep[];
  report: InvestigationReport | null;
  answer: string | null;
  verification: Verification | null;
  error: string | null;
  durationMs: number | null;
  investigationId: string | null;
}

const TOOL_LABEL: Record<string, string> = {
  get_sales_comparison: "Compare sales periods",
  get_menu_item_profitability: "Menu item profitability",
  get_supplier_price_changes: "Supplier price changes",
  get_delivery_channel_costs: "Channel & delivery costs",
  get_food_waste_analysis: "Food waste analysis",
  get_labour_cost_analysis: "Labour cost analysis",
  investigate_profit_change: "Profit change decomposition",
  calculate_price_scenario: "Price scenario",
  get_invoice_order_checks: "Invoice vs order checks",
  get_stock_expiry_forecast: "Stock & expiry forecast",
};

const SUGGESTIONS = [
  "My revenue increased this month, but my profitability declined. What happened?",
  "Which dishes are costing me the most?",
  "Which supplier increased prices the most?",
  "Am I making more money from delivery or dine-in?",
  "What are my biggest identifiable profit leaks?",
  "Are my suppliers billing me correctly?",
  "Which stock is likely to go off before we use it?",
  "What would happen if I increased the price of the Buttermilk Fried Chicken Burger to £15.50?",
  "Where is food waste costing me money?",
  "Which menu items should I investigate?",
];

const gbp = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${n < 0 ? "−" : n > 0 ? "+" : ""}£${Math.abs(n).toLocaleString("en-GB", { maximumFractionDigits: 0 })}`);

function fromSaved(s: SavedInvestigation): Turn {
  const report = s.report && !("answer" in s.report && s.report.answer) ? (s.report as InvestigationReport) : null;
  const answer = s.report && "answer" in s.report && s.report.answer ? s.report.answer : null;
  return {
    key: s.id, question: s.question, mode: s.mode, model: s.model, status: s.status === "failed" ? "error" : "done", statusText: "", notes: [],
    steps: s.trace ?? [], report, answer, verification: s.verification, error: s.error_message, durationMs: s.duration_ms, investigationId: s.id,
  };
}

export function Investigator({ periodKey, live, model, history, saved, autoQuestion }: { periodKey: string; live: boolean; model: string | null; history: { id: string; question: string; headline: string | null; mode: string; status: string; created_at: string }[]; saved: SavedInvestigation | null; autoQuestion: string | null }) {
  const router = useRouter();
  const [turns, setTurns] = useState<Turn[]>(saved ? [fromSaved(saved)] : []);
  const [q, setQ] = useState("");
  const running = turns.some((t) => t.status === "running");
  const started = useRef(false);
  const bottom = useRef<HTMLDivElement>(null);

  const update = (key: string, fn: (t: Turn) => Turn) => setTurns((ts) => ts.map((t) => (t.key === key ? fn(t) : t)));

  async function ask(question: string) {
    const key = `t${Date.now()}`;
    const priorTurns = turns.filter((t) => t.report).slice(-3).map((t) => ({ question: t.question, finding: t.report!.main_finding }));
    setTurns((ts) => [...ts, { key, question, mode: null, model: null, status: "running", statusText: "Starting…", notes: [], steps: [], report: null, answer: null, verification: null, error: null, durationMs: null, investigationId: null }]);
    setQ("");
    try {
      const res = await fetch("/api/investigate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question, period: periodKey, history: priorTurns }) });
      if (!res.ok || !res.body) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const e = JSON.parse(line);
          update(key, (t) => {
            switch (e.type) {
              case "start": return { ...t, mode: e.mode, model: e.model, investigationId: e.investigationId };
              case "status": return { ...t, statusText: e.message };
              case "thinking": return { ...t, notes: [...t.notes, e.text] };
              case "tool_call": return { ...t, statusText: `Running ${TOOL_LABEL[e.name] ?? e.name}…`, steps: [...t.steps, { id: e.id, name: e.name, input: e.input, ok: true, ms: 0, pending: true }] };
              case "tool_result": return { ...t, steps: t.steps.map((s) => (s.id === e.id ? { ...s, pending: false, ok: e.ok, result: e.result, error: e.error, ms: e.ms } : s)) };
              case "report": return { ...t, report: e.report, verification: e.verification };
              case "answer": return { ...t, answer: e.text };
              case "error": return { ...t, status: "error", error: e.message };
              case "done": return { ...t, status: t.status === "error" ? "error" : "done", durationMs: e.durationMs };
              default: return t;
            }
          });
        }
      }
      update(key, (t) => (t.status === "running" ? { ...t, status: t.report || t.answer ? "done" : "error", error: t.report || t.answer ? null : t.error ?? "The investigation ended without a result." } : t));
      router.refresh();
    } catch (err) {
      update(key, (t) => ({ ...t, status: "error", error: err instanceof Error ? err.message : String(err) }));
    }
  }

  useEffect(() => {
    if (autoQuestion && !started.current && !saved) {
      started.current = true;
      ask(autoQuestion);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [turns.length]);

  return (
    <div className="grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="space-y-5 lg:sticky lg:top-6 lg:self-start">
        <div className="rounded-md border border-line bg-surface p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[12px] font-medium text-ink">Mode</span>
            {live ? <Badge tone="good">Live · Claude</Badge> : <Badge tone="warn">Demo mode · not AI</Badge>}
          </div>
          <p className="text-[12px] text-muted">{live ? `Model ${model}. Claude chooses which of 8 financial tools to call; calculations run in MarginOS.` : "Add ANTHROPIC_API_KEY to .env.local and restart to enable Claude. Demo mode uses keyword rules and the same tools."}</p>
        </div>
        <div>
          <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.06em] text-muted">Ask about</div>
          <div className="space-y-1">
            {SUGGESTIONS.map((s) => (
              <button key={s} disabled={running} onClick={() => ask(s)} className="block w-full rounded px-2 py-1.5 text-left text-[12px] text-ink-2 hover:bg-surface-2 hover:text-ink disabled:opacity-50">
                {s}
              </button>
            ))}
          </div>
        </div>
        {history.length > 0 && (
          <div>
            <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.06em] text-muted">Past investigations</div>
            <ul className="space-y-0.5">
              {history.map((h) => (
                <li key={h.id}>
                  <Link href={`/investigator?id=${h.id}`} className={cx("block rounded px-2 py-1.5 text-[12px] hover:bg-surface-2", saved?.id === h.id ? "bg-surface-2 text-ink" : "text-ink-2")}>
                    <span className="line-clamp-1">{h.question}</span>
                    <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted">
                      {new Date(h.created_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                      <span>· {h.mode === "live" ? "Claude" : "demo"}</span>
                      {h.status === "failed" && <span className="text-bad">· failed</span>}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </aside>

      <div className="min-w-0">
        {turns.length === 0 && (
          <div className="mb-5 rounded-md border border-line bg-surface px-6 py-8">
            <div className="text-[15px] font-medium text-ink">Ask a question about your restaurant&apos;s money.</div>
            <p className="mt-1 max-w-xl text-[13px] text-muted">The investigator pulls sales, recipes, supplier invoices, delivery settlements, waste and rota data, then shows what changed, the evidence, how confident it is, and what to do next.</p>
            <div className="mt-4"><Button variant="primary" onClick={() => ask(SUGGESTIONS[0])}>Why did profitability decline?</Button></div>
          </div>
        )}
        <div className="space-y-6">
          {turns.map((t) => <TurnView key={t.key} t={t} />)}
        </div>
        <div ref={bottom} />
        <form
          className="sticky bottom-0 mt-6 border-t border-line bg-bg pb-4 pt-3"
          onSubmit={(e) => { e.preventDefault(); if (q.trim().length >= 3 && !running) ask(q.trim()); }}
        >
          <div className="flex items-end gap-2 rounded-md border border-line-strong bg-surface p-2 focus-within:border-[#5c5a52]">
            <textarea
              rows={2}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (q.trim().length >= 3 && !running) ask(q.trim()); } }}
              placeholder="e.g. Why is delivery less profitable than last month?"
              className="min-h-[40px] flex-1 resize-none bg-transparent px-1 text-[13px] text-ink outline-none placeholder:text-faint"
              aria-label="Question"
            />
            <Button type="submit" variant="primary" disabled={running || q.trim().length < 3}>{running ? "Investigating…" : "Investigate"}</Button>
          </div>
          <p className="mt-1.5 text-[11px] text-faint">Contribution is not net profit: rent, utilities and other overheads aren&apos;t in the data. Correlations are labelled as such.</p>
        </form>
      </div>
    </div>
  );
}

function TurnView({ t }: { t: Turn }) {
  const [open, setOpen] = useState<string | null>(null);
  const totalMs = t.steps.reduce((s, x) => s + x.ms, 0);
  return (
    <article className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-[15px] font-medium text-ink">{t.question}</h3>
        <div className="flex shrink-0 items-center gap-1.5">
          {t.mode === "live" && <Badge tone="good">Claude{t.model ? ` · ${t.model}` : ""}</Badge>}
          {t.mode === "demo" && <Badge tone="warn" title="Deterministic rules, not AI">Demo mode · not AI</Badge>}
          {t.durationMs !== null && <span className="text-[11px] text-muted">{(t.durationMs / 1000).toFixed(1)}s</span>}
        </div>
      </div>

      <div className="rounded-md border border-line bg-surface">
        <div className="flex items-center justify-between border-b border-line px-3 py-2 text-[12px]">
          <span className="text-ink-2">Investigation trace</span>
          <span className="text-muted">{t.steps.length} tool call{t.steps.length === 1 ? "" : "s"}{totalMs ? ` · ${totalMs} ms of calculation` : ""}</span>
        </div>
        <ol className="divide-y divide-line">
          {t.steps.map((s, i) => (
            <li key={s.id} id={`step-${s.id}`}>
              <button className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-surface-2" onClick={() => setOpen(open === s.id ? null : s.id)}>
                <span className="num w-4 text-[11px] text-faint">{i + 1}</span>
                <span className={cx("size-1.5 rounded-full", s.pending ? "pulse bg-warn" : s.ok ? "bg-good" : "bg-bad")} />
                <span className="text-[12px] text-ink">{TOOL_LABEL[s.name] ?? s.name}</span>
                <code className="truncate font-mono text-[11px] text-muted">{s.name}({summarizeInput(s.input)})</code>
                <span className="ml-auto text-[11px] text-faint">{s.pending ? "running" : s.ok ? `${s.ms} ms` : "failed"}</span>
                <span className="text-[11px] text-faint">{open === s.id ? "▾" : "▸"}</span>
              </button>
              {open === s.id && (
                <div className="border-t border-line bg-[#121211] px-3 py-2">
                  {s.error && <p className="mb-2 text-[12px] text-bad">{s.error}</p>}
                  <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-[1.5] text-ink-2">{JSON.stringify(s.result ?? s.input, null, 1)}</pre>
                </div>
              )}
            </li>
          ))}
          {t.status === "running" && (
            <li className="flex items-center gap-2 px-3 py-2 text-[12px] text-muted"><span className="pulse size-1.5 rounded-full bg-accent" />{t.statusText}</li>
          )}
        </ol>
        {t.notes.length > 0 && (
          <div className="border-t border-line px-3 py-2 text-[12px] text-muted">
            {t.notes.map((n, i) => <p key={i} className="mt-0.5 first:mt-0">{n}</p>)}
          </div>
        )}
      </div>

      {t.error && (
        <div className="rounded-md border border-[color:var(--bad)]/30 bg-[color:var(--bad-bg)] px-3 py-2 text-[12px] text-bad">
          <strong className="font-medium">Investigation failed.</strong> {t.error} No result has been fabricated.
        </div>
      )}
      {t.answer && !t.report && <div className="whitespace-pre-wrap rounded-md border border-line bg-surface p-4 text-[13px] text-ink-2">{t.answer}</div>}
      {t.report && <Report r={t.report} v={t.verification} onEvidence={(id) => { setOpen(id); document.getElementById(`step-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }); }} steps={t.steps} />}
    </article>
  );
}

function summarizeInput(input: unknown) {
  if (!input || typeof input !== "object") return "";
  return Object.entries(input as Record<string, unknown>).map(([k, v]) => `${k}: ${typeof v === "string" ? `"${v}"` : String(v)}`).join(", ");
}

const confTone = { high: "good", medium: "warn", low: "bad" } as const;

function Report({ r, v, onEvidence, steps }: { r: InvestigationReport; v: Verification | null; onEvidence: (id: string) => void; steps: TraceStep[] }) {
  const stepIndex = new Map(steps.map((s, i) => [s.id, i + 1]));
  return (
    <div className="overflow-hidden rounded-md border border-line-strong bg-surface">
      <div className="border-b border-line px-5 py-4">
        <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] text-muted">
          <span className="font-medium uppercase tracking-[0.06em] text-accent">Finding</span>
          <span>{r.current_period}{r.comparison_period ? ` vs ${r.comparison_period}` : ""}</span>
          <Badge tone={confTone[r.confidence]}>{r.confidence} confidence</Badge>
          {v && (v.unverified.length === 0
            ? <Badge tone="good" title="Every £ and % figure in this report was matched to a tool result">{v.figuresChecked} figures traced to tool output</Badge>
            : <Badge tone="warn" title={`Could not match: ${v.unverified.join(", ")}`}>{v.unverified.length} figure{v.unverified.length > 1 ? "s" : ""} not traced: {v.unverified.slice(0, 3).join(", ")}</Badge>)}
        </div>
        <p className="text-[16px] font-medium leading-snug text-ink">{r.main_finding}</p>
        <p className="mt-2 text-[13px] text-ink-2">{r.summary}</p>
      </div>

      {r.findings.length > 0 && (
        <div className="overflow-x-auto border-b border-line">
          <table className="tbl num">
            <thead>
              <tr><th>Contributor</th><th className="r">Previous</th><th className="r">Current</th><th className="r">Difference</th><th className="r">Impact on contribution</th><th>Confidence</th><th>Evidence</th></tr>
            </thead>
            <tbody>
              {r.findings.map((f, i) => (
                <tr key={i}>
                  <td className="max-w-[420px]">
                    <div className="text-ink">{f.title}</div>
                    <div className="mt-0.5 text-[12px] text-muted">{f.detail}</div>
                  </td>
                  <td className="r text-ink-2">{f.previous_value ?? "—"}</td>
                  <td className="r text-ink-2">{f.current_value ?? "—"}</td>
                  <td className="r text-ink-2">{f.difference ?? "—"}</td>
                  <td className={cx("r font-medium", f.impact_gbp === null ? "text-muted" : f.impact_gbp < 0 ? "text-bad" : "text-good")}>{gbp(f.impact_gbp)}</td>
                  <td>
                    <div className="flex flex-col items-start gap-1">
                      <Badge tone={confTone[f.confidence]}>{f.confidence}</Badge>
                      <span className="text-[11px] text-muted">{f.attribution === "correlation" ? "correlation, not proven cause" : f.attribution === "estimated" ? "estimated contributor" : "measured"}</span>
                    </div>
                  </td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      {f.evidence_tool_ids.filter((id) => stepIndex.has(id)).map((id) => (
                        <button key={id} onClick={() => onEvidence(id)} className="rounded border border-line-strong px-1.5 text-[11px] text-ink-2 hover:bg-surface-3" title={steps.find((s) => s.id === id)?.name}>#{stepIndex.get(id)}</button>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="grid gap-0 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="border-line px-5 py-4 md:border-r">
          <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.06em] text-muted">Recommended actions</div>
          {r.recommendations.length === 0 ? <p className="text-[12px] text-muted">None — the evidence does not support a specific action.</p> : (
            <ol className="space-y-3">
              {r.recommendations.map((a, i) => (
                <li key={i} className="flex gap-3">
                  <span className="num mt-0.5 flex size-5 shrink-0 items-center justify-center rounded border border-line-strong text-[11px] text-ink-2">{i + 1}</span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-[13px] text-ink">{a.action}<Badge>{a.effort} effort</Badge></div>
                    <div className="mt-0.5 text-[12px] text-muted">{a.rationale}</div>
                    {a.estimated_impact && <div className="mt-0.5 text-[12px] text-ink-2">Potential: {a.estimated_impact}</div>}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
        <div className="px-5 py-4">
          <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.06em] text-muted">Data gaps &amp; caveats</div>
          {r.data_gaps.length === 0 ? <p className="text-[12px] text-muted">None reported.</p> : (
            <ul className="space-y-1.5 text-[12px] text-ink-2">{r.data_gaps.map((g, i) => <li key={i} className="flex gap-2"><span className="text-warn">·</span>{g}</li>)}</ul>
          )}
        </div>
      </div>
    </div>
  );
}
