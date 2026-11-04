import Anthropic from "@anthropic-ai/sdk";
import { query } from "@/lib/db";
import type { BusinessCtx } from "@/lib/finance/engine";
import { availablePeriods } from "@/lib/finance/engine";
import { period, previousPeriod } from "@/lib/finance/period";
import { REPORT_TOOL, ReportSchema, TOOLS, runTool, verifyFigures, type InvestigationReport } from "./tools";
import { runDemoInvestigation } from "./demo-investigator";

export type InvestigationEvent =
  | { type: "start"; investigationId: string; mode: "live" | "demo"; model: string | null }
  | { type: "status"; message: string }
  | { type: "thinking"; text: string }
  | { type: "tool_call"; id: string; name: string; input: unknown }
  | { type: "tool_result"; id: string; name: string; ok: boolean; result?: unknown; error?: string; ms: number }
  | { type: "report"; report: InvestigationReport; verification: ReturnType<typeof verifyFigures> }
  | { type: "answer"; text: string }
  | { type: "error"; message: string }
  | { type: "done"; investigationId: string; durationMs: number };

export interface TraceEntry { id: string; name: string; input: unknown; ok: boolean; result?: unknown; error?: string; ms: number }

import { MODEL, liveAiAvailable } from "./config";
export { MODEL, liveAiAvailable };

const MAX_TURNS = 12;

function systemPrompt(b: BusinessCtx, periods: string[], current: string) {
  const prev = previousPeriod(current).key;
  return `You are the MarginOS profit investigator for ${b.name}${b.location ? ` (${b.location})` : ""}${b.isDemo ? ", a FICTIONAL demo restaurant" : ""}. You help an independent restaurant owner understand where their money is going, why profitability changed, and what to do next.

Data available: monthly periods ${periods.join(", ")} (format YYYY-MM). Unless the owner says otherwise, analyse ${current} against ${prev}. Currency GBP; all figures are ex VAT (VAT ${b.vatRate}% assumed on all sales).

How to work:
- Use the data tools to gather evidence. Call several in parallel when they are independent. For "why did profit / margin change" questions, start with investigate_profit_change, then drill into the biggest effects (supplier prices, channels, dishes, waste, labour) as needed.
- You must never calculate financial figures yourself. Every £ or % you state must be copied from a tool result (rounded is fine). If you need a number no tool provides, say it is not available.
- Keep these distinct: contribution (net revenue − food cost − packaging − platform commission) is NOT net profit; overheads such as rent are not in the data. Wage cost excludes employer NI and pension.
- The contribution bridge effects are additive and non-overlapping; you may compare them but never add impacts from different tools together (e.g. a supplier impact and a dish impact for the same ingredient overlap).
- Correlation is not causation. When an operational event coincides with a change (e.g. a promotion and rising refunds), label it as correlation. Use "estimated" attribution where the tool flags estimates.
- For "profit leak" or "where am I losing money" questions, also check supplier billing (get_invoice_order_checks) and stock expiry (get_stock_expiry_forecast). Money at stake on invoices is already inside food cost: report it as potentially recoverable, never add it to the contribution bridge. The stock forecast is a model; compare its expiry losses with recorded waste rather than adding them.
- State data gaps plainly (missing recipe costs, estimated commission, no records).
- Recommendations must be practical for a small restaurant, tied to the evidence, and say what to check or change. Do not promise outcomes.

Finish by calling submit_investigation_report exactly once. In evidence_tool_ids cite the tool_use ids that contain each finding's evidence. Write for a busy owner: short, specific, numerate. Do not write a separate prose answer after the report.`;
}

async function saveStart(b: BusinessCtx, question: string, mode: "live" | "demo", cur: string, prev: string) {
  const r = await query<{ id: string }>(
    `insert into investigations (business_id, question, mode, model, period_current, period_previous) values ($1,$2,$3,$4,$5,$6) returning id`,
    [b.id, question, mode, mode === "live" ? MODEL : null, cur, prev],
  );
  return r[0].id;
}

export async function saveFinish(
  b: BusinessCtx,
  id: string,
  out: { status: "completed" | "failed"; report?: InvestigationReport | null; answer?: string | null; trace: TraceEntry[]; verification?: unknown; error?: string; durationMs: number },
) {
  await query(
    `update investigations set status=$2, headline=$3, report=$4, trace=$5, verification=$6, error_message=$7, duration_ms=$8 where id=$1`,
    [id, out.status, out.report?.main_finding ?? out.answer?.slice(0, 280) ?? null, out.report ? JSON.stringify(out.report) : out.answer ? JSON.stringify({ answer: out.answer }) : null, JSON.stringify(out.trace), out.verification ? JSON.stringify(out.verification) : null, out.error ?? null, out.durationMs],
  );
  if (out.report) {
    let pos = 0;
    for (const f of out.report.findings) {
      await query(
        `insert into investigation_findings (business_id, investigation_id, position, title, detail, previous_value, current_value, impact_gbp, confidence, attribution) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [b.id, id, pos++, f.title, f.detail, f.previous_value, f.current_value, f.impact_gbp, f.confidence, f.attribution],
      );
    }
    pos = 0;
    for (const r of out.report.recommendations) {
      await query(`insert into recommendations (business_id, investigation_id, position, action, rationale, estimated_impact, effort) values ($1,$2,$3,$4,$5,$6,$7)`, [b.id, id, pos++, r.action, r.rationale, r.estimated_impact, r.effort]);
    }
  }
}

export async function investigate(
  b: BusinessCtx,
  question: string,
  opts: { periodKey?: string; history?: { question: string; finding: string }[]; forceDemo?: boolean },
  emit: (e: InvestigationEvent) => void,
): Promise<void> {
  const t0 = Date.now();
  const periods = await availablePeriods(b);
  if (!periods.length) {
    emit({ type: "error", message: "There is no sales data yet. Load the demo restaurant or import a POS export in the Data Centre." });
    return;
  }
  const current = opts.periodKey && periods.includes(opts.periodKey) ? opts.periodKey : periods[0];
  const prev = previousPeriod(current).key;
  const live = liveAiAvailable() && !opts.forceDemo;
  const id = await saveStart(b, question, live ? "live" : "demo", current, prev);
  emit({ type: "start", investigationId: id, mode: live ? "live" : "demo", model: live ? MODEL : null });

  if (!live) {
    await runDemoInvestigation(b, id, question, current, emit, t0);
    return;
  }

  const client = new Anthropic({ maxRetries: 2, timeout: 120_000 });
  const tools = [...TOOLS.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema as Anthropic.Beta.Messages.BetaTool.InputSchema })), { ...REPORT_TOOL, input_schema: REPORT_TOOL.input_schema as Anthropic.Beta.Messages.BetaTool.InputSchema }];
  const context = opts.history?.length ? `Earlier in this session the owner asked:\n${opts.history.map((h) => `- "${h.question}" → ${h.finding}`).join("\n")}\n\n` : "";
  const messages: Anthropic.Beta.Messages.BetaMessageParam[] = [{ role: "user", content: `${context}Owner's question (default period ${period(current).label} vs ${period(prev).label}): ${question}` }];
  const trace: TraceEntry[] = [];
  let report: InvestigationReport | null = null;
  let answer = "";

  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      emit({ type: "status", message: turn === 0 ? "Planning the investigation…" : "Analysing results…" });
      const response = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        system: systemPrompt(b, periods, current),
        tools,
        messages,
        output_config: { effort: "medium" },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      } as Anthropic.Beta.Messages.MessageCreateParamsNonStreaming);

      if (response.stop_reason === "refusal") throw new Error("The model declined this request.");
      messages.push({ role: "assistant", content: response.content as Anthropic.Beta.Messages.BetaContentBlockParam[] });

      for (const block of response.content) if (block.type === "text" && block.text.trim()) emit({ type: "thinking", text: block.text.trim() });
      const toolUses = response.content.filter((c): c is Anthropic.Beta.Messages.BetaToolUseBlock => c.type === "tool_use");

      if (response.stop_reason === "max_tokens") throw new Error("The response was cut off (max tokens).");
      if (response.stop_reason === "pause_turn") continue;
      if (!toolUses.length) {
        answer = response.content.filter((c) => c.type === "text").map((c) => (c as { text: string }).text).join("\n").trim();
        break;
      }

      const results: Anthropic.Beta.Messages.BetaToolResultBlockParam[] = await Promise.all(
        toolUses.map(async (tu) => {
          if (tu.name === REPORT_TOOL.name) {
            const parsed = ReportSchema.safeParse(tu.input);
            if (!parsed.success) {
              return { type: "tool_result" as const, tool_use_id: tu.id, is_error: true, content: `Report failed validation: ${parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}. Fix and resubmit.` };
            }
            report = parsed.data;
            return { type: "tool_result" as const, tool_use_id: tu.id, content: "Report received." };
          }
          emit({ type: "tool_call", id: tu.id, name: tu.name, input: tu.input });
          const s = Date.now();
          const r = await runTool(b, tu.name, tu.input);
          const ms = Date.now() - s;
          const entry: TraceEntry = r.ok ? { id: tu.id, name: tu.name, input: tu.input, ok: true, result: r.result, ms } : { id: tu.id, name: tu.name, input: tu.input, ok: false, error: r.error, ms };
          trace.push(entry);
          emit({ type: "tool_result", id: tu.id, name: tu.name, ok: r.ok, result: r.ok ? r.result : undefined, error: r.ok ? undefined : r.error, ms });
          return { type: "tool_result" as const, tool_use_id: tu.id, is_error: !r.ok, content: r.ok ? JSON.stringify(r.result) : r.error };
        }),
      );
      messages.push({ role: "user", content: results });
      if (report) break;
    }

    const durationMs = Date.now() - t0;
    if (report) {
      const verification = verifyFigures(report, trace.filter((t) => t.ok).map((t) => t.result));
      emit({ type: "report", report, verification });
      await saveFinish(b, id, { status: "completed", report, trace, verification, durationMs });
    } else if (answer) {
      emit({ type: "answer", text: answer });
      await saveFinish(b, id, { status: "completed", answer, trace, durationMs });
    } else {
      throw new Error("The investigation did not produce a report within the step limit.");
    }
    emit({ type: "done", investigationId: id, durationMs });
  } catch (err) {
    const message = describeError(err);
    console.error("[investigator]", err);
    emit({ type: "error", message });
    await saveFinish(b, id, { status: "failed", trace, error: message, durationMs: Date.now() - t0 });
  }
}

function describeError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "Claude API authentication failed — check ANTHROPIC_API_KEY.";
  if (err instanceof Anthropic.RateLimitError) return "Claude API rate limit reached — wait a moment and try again.";
  if (err instanceof Anthropic.BadRequestError) return `Claude API rejected the request: ${err.message}`;
  if (err instanceof Anthropic.APIConnectionError) return "Could not reach the Claude API (network error).";
  if (err instanceof Anthropic.APIError) return `Claude API error ${err.status ?? ""}: ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}
