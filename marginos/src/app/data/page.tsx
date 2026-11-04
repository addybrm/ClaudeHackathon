import Link from "next/link";
import { getActiveBusiness } from "@/lib/business";
import { liveAiAvailable } from "@/lib/ai/config";
import { query } from "@/lib/db";
import { SAMPLE_FILES } from "@/lib/demo/samples";
import { CSV_SPECS } from "@/lib/imports/pipeline";
import { dateTime, sourceLabel } from "@/lib/format";
import { Badge, Button, Empty, PageHeader, Panel } from "@/components/ui";
import { SampleImportButton, UploadButton } from "./upload";

const SOURCES: { type: keyof typeof sourceLabel; what: string; accept: string }[] = [
  { type: "pos_sales", what: "Line-level till export. One row per item sold; orders are grouped by order_id.", accept: ".csv" },
  { type: "supplier_invoice", what: "PDF or photo of a supplier invoice. Claude reads it; you confirm every line before it updates costs.", accept: ".pdf,.png,.jpg,.jpeg,.webp" },
  { type: "menu_recipes", what: "Dishes, prices and recipe quantities. Re-importing a dish replaces its recipe.", accept: ".csv" },
  { type: "delivery_settlement", what: "Platform statement with commission and fees per order. Replaces estimated commission.", accept: ".csv" },
  { type: "waste", what: "Wasted ingredients (by weight/volume) or prepared dishes (portions), with a reason.", accept: ".csv" },
  { type: "labour", what: "Worked hours and hourly rates per shift.", accept: ".csv" },
  { type: "supplier_orders", what: "Order confirmations from supplier emails. Invoices are checked against these for overcharges and short deliveries.", accept: ".csv" },
];

const STATUS: Record<string, { tone: "good" | "warn" | "bad" | "neutral" | "info"; label: string }> = {
  processing: { tone: "info", label: "Processing" },
  awaiting_review: { tone: "warn", label: "Awaiting review" },
  imported: { tone: "good", label: "Imported" },
  failed: { tone: "bad", label: "Failed" },
  discarded: { tone: "neutral", label: "Discarded" },
};

export default async function DataCentre() {
  const b = await getActiveBusiness();
  if (!b) return <Empty title="No business loaded" action={<Button href="/" variant="primary">Get started</Button>} />;
  const uploads = await query<{ id: string; source_type: string; file_name: string; status: string; extraction_method: string; records_extracted: number; records_valid: number; records_imported: number; uploaded_at: string; errors: number; warnings: number; error_message: string | null }>(
    `select id, source_type, file_name, status, extraction_method, records_extracted, records_valid, records_imported, uploaded_at::text, error_message,
       (select count(*) from jsonb_array_elements(validation_errors) e where e->>'severity' = 'error')::int as errors,
       (select count(*) from jsonb_array_elements(validation_errors) e where e->>'severity' = 'warning')::int as warnings
     from uploaded_files where business_id = $1 and status <> 'discarded' order by uploaded_at desc`,
    [b.id],
  );
  const imported = new Set(uploads.filter((u) => u.status !== "failed").map((u) => u.file_name));
  const last = (t: string) => uploads.find((u) => u.source_type === t && u.status === "imported");
  const ai = liveAiAvailable();

  return (
    <>
      <PageHeader title="Data centre" description="Every figure in MarginOS traces back to a file here. Imports are staged and validated first; nothing reaches your financial records until you confirm it." />

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {SOURCES.map((s) => {
          const l = last(s.type);
          const spec = s.type !== "supplier_invoice" ? CSV_SPECS[s.type as keyof typeof CSV_SPECS] : null;
          return (
            <div key={s.type} className="flex flex-col rounded-md border border-line bg-surface p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-[13px] font-medium text-ink">{sourceLabel[s.type]}</div>
                  <div className="mt-0.5 text-[12px] text-muted">{s.what}</div>
                </div>
                <Badge tone={s.type === "supplier_invoice" ? "info" : "neutral"}>{s.type === "supplier_invoice" ? "Claude extraction" : "CSV parser"}</Badge>
              </div>
              {spec && <code className="mt-3 block overflow-x-auto whitespace-nowrap rounded bg-[#121211] px-2 py-1.5 font-mono text-[11px] text-ink-2" title={`Required: ${spec.required.join(", ")}`}>{spec.example}</code>}
              {s.type === "supplier_invoice" && !ai && <p className="mt-3 text-[12px] text-warn">Needs ANTHROPIC_API_KEY. Without it, only the bundled sample documents work (pre-read, labelled); other files fail clearly rather than guessing.</p>}
              <div className="mt-auto flex items-center justify-between gap-2 pt-3">
                <span className="text-[11px] text-muted">{l ? `Last import ${dateTime(l.uploaded_at)}` : "Nothing imported yet"}</span>
                <UploadButton sourceType={s.type} accept={s.accept} />
              </div>
            </div>
          );
        })}
      </div>

      {b.isDemo && (
        <Panel className="mt-5" title="Demo sample files" subtitle="The 31 October exports, a late platform statement, a supplier invoice PDF and a photographed delivery receipt, held back from the demo data so you can import them yourself.">
          <ul className="divide-y divide-line">
            {SAMPLE_FILES.map((f) => (
              <li key={f.name} className="flex flex-wrap items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-[13px] text-ink">{f.title}<Badge>{sourceLabel[f.sourceType]}</Badge></div>
                  <div className="text-[12px] text-muted">{f.description} <span className="font-mono text-faint">{f.name}</span></div>
                </div>
                <div className="flex items-center gap-2">
                  <a className="text-[12px] text-ink-2 hover:text-ink" href={`/api/samples/${f.name}`} target={f.mime === "application/pdf" ? "_blank" : undefined} rel="noreferrer">{f.mime === "application/pdf" ? "View" : "Download"}</a>
                  <SampleImportButton name={f.name} done={imported.has(f.name)} />
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel className="mt-5" pad={false} title="Uploads" subtitle="Status, extraction method and validation results for every file">
        {uploads.length === 0 ? <div className="p-4 text-[12px] text-muted">No uploads yet.</div> : (
          <div className="overflow-x-auto">
            <table className="tbl num">
              <thead><tr><th>File</th><th>Source</th><th>Uploaded</th><th>Method</th><th>Status</th><th className="r">Extracted</th><th className="r">Valid</th><th className="r">Imported</th><th>Validation</th><th /></tr></thead>
              <tbody>
                {uploads.map((u) => (
                  <tr key={u.id}>
                    <td className="max-w-[280px] truncate text-ink" title={u.file_name}>{u.file_name}</td>
                    <td className="text-ink-2">{sourceLabel[u.source_type]}</td>
                    <td className="text-ink-2">{dateTime(u.uploaded_at)}</td>
                    <td className="text-[12px] text-muted">{u.extraction_method === "claude" ? "Claude" : u.extraction_method === "preread_sample" ? "Pre-read sample" : u.extraction_method === "demo_seed" ? "Demo seed" : "CSV parser"}</td>
                    <td><Badge tone={STATUS[u.status].tone}>{STATUS[u.status].label}</Badge></td>
                    <td className="r">{u.records_extracted.toLocaleString("en-GB")}</td>
                    <td className="r">{u.records_valid.toLocaleString("en-GB")}</td>
                    <td className="r">{u.status === "imported" ? u.records_imported.toLocaleString("en-GB") : "—"}</td>
                    <td className="text-[12px]">
                      {u.error_message ? <span className="text-bad">{u.error_message.slice(0, 80)}</span> : (
                        <span className="flex gap-1.5">{u.errors > 0 && <Badge tone="bad">{u.errors} errors</Badge>}{u.warnings > 0 && <Badge tone="warn">{u.warnings} warnings</Badge>}{!u.errors && !u.warnings && <span className="text-muted">clean</span>}</span>
                      )}
                    </td>
                    <td className="r">{u.extraction_method !== "demo_seed" && <Link href={`/data/${u.id}`} className="text-[12px] text-ink-2 hover:text-ink">{u.status === "awaiting_review" ? "Review →" : "View →"}</Link>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
