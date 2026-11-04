import Link from "next/link";
import { notFound } from "next/navigation";
import { getActiveBusiness } from "@/lib/business";
import { query } from "@/lib/db";
import type { Staged } from "@/lib/imports/pipeline";
import { dateTime, sourceLabel } from "@/lib/format";
import { Badge, PageHeader, Panel } from "@/components/ui";
import { Review } from "./review";

export default async function UploadReview({ params }: { params: Promise<{ id: string }> }) {
  const b = await getActiveBusiness();
  if (!b) notFound();
  const { id } = await params;
  const [f] = await query<{ id: string; source_type: string; file_name: string; mime_type: string | null; status: string; extraction_method: string; records_extracted: number; records_valid: number; records_imported: number; error_message: string | null; staged: Staged | null; uploaded_at: string; confirmed_at: string | null; storage_path: string | null }>(
    `select id, source_type, file_name, mime_type, status, extraction_method, records_extracted, records_valid, records_imported, error_message, staged, uploaded_at::text, confirmed_at::text, storage_path from uploaded_files where id = $1 and business_id = $2`,
    [id, b.id],
  );
  if (!f) notFound();
  const ingredients = f.source_type === "supplier_invoice" ? await query<{ id: string; name: string; base_unit: string }>(`select id, name, base_unit from ingredients where business_id = $1 order by name`, [b.id]) : [];
  const fileErrors = f.staged?.issues.filter((i) => i.row === null) ?? [];
  return (
    <>
      <div className="mb-2 text-[12px] text-muted"><Link href="/data" className="hover:text-ink">Data centre</Link> / Review import</div>
      <PageHeader
        title={f.file_name}
        description={<>{sourceLabel[f.source_type]}, uploaded {dateTime(f.uploaded_at)}, {f.extraction_method === "claude" ? "extracted by Claude" : f.extraction_method === "preread_sample" ? "pre-read sample (not live AI)" : "parsed deterministically"}{f.confirmed_at && `, imported ${dateTime(f.confirmed_at)}`}</>}
        actions={f.storage_path ? <a href={`/api/uploads/${f.id}/file`} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center rounded border border-line-strong bg-surface-2 px-3 text-[13px] text-ink hover:bg-surface-3">Open original ↗</a> : undefined}
      />
      {f.status === "failed" && (
        <Panel className="mb-5" title={<span className="text-bad">Import failed</span>}>
          <p className="text-[13px] text-ink-2">{f.error_message ?? fileErrors.map((e) => e.message).join(" ")}</p>
          <p className="mt-2 text-[12px] text-muted">Nothing was imported. Fix the file and upload it again.</p>
        </Panel>
      )}
      {f.staged && (
        <>
          <div className="mb-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
            <Panel title="Summary">
              <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-[12px] md:grid-cols-3">
                {orderedSummary(f.staged.summary).map(([k, v]) => (
                  <div key={k}><dt className="text-muted">{k}</dt><dd className="num text-[13px] text-ink">{typeof v === "number" ? v.toLocaleString("en-GB") : v}</dd></div>
                ))}
              </dl>
            </Panel>
            <Panel title="Status">
              <div className="space-y-1.5 text-[12px]">
                <div className="flex justify-between"><span className="text-muted">State</span><Badge tone={f.status === "imported" ? "good" : f.status === "failed" ? "bad" : "warn"}>{f.status.replace("_", " ")}</Badge></div>
                <div className="flex justify-between"><span className="text-muted">Rows extracted</span><span className="num text-ink">{f.records_extracted}</span></div>
                <div className="flex justify-between"><span className="text-muted">Rows valid</span><span className="num text-ink">{f.records_valid}</span></div>
                {f.status === "imported" && <div className="flex justify-between"><span className="text-muted">Records imported</span><span className="num text-ink">{f.records_imported}</span></div>}
              </div>
            </Panel>
          </div>
          <Review
            id={f.id}
            status={f.status}
            kind={f.source_type}
            staged={f.staged}
            ingredients={ingredients}
          />
        </>
      )}
    </>
  );
}

// jsonb does not preserve key order, so present summary fields in a fixed, readable order.
const SUMMARY_ORDER = ["method", "supplier", "invoice number", "order ref", "date", "order check", "rows", "orders", "dishes", "date range", "subtotal", "vat", "total", "confidence"];
function orderedSummary(s: Record<string, string | number>) {
  const rank = (k: string) => { const i = SUMMARY_ORDER.indexOf(k); return i < 0 ? 99 : i; };
  return Object.entries(s).sort((a, z) => rank(a[0]) - rank(z[0]));
}
