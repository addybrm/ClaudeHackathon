"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Staged, StagedInvoiceLine } from "@/lib/imports/pipeline";
import { Badge, Button, Panel, cx } from "@/components/ui";

export function Review({ id, status, kind, staged, ingredients }: { id: string; status: string; kind: string; staged: Staged; ingredients: { id: string; name: string; base_unit: string }[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<null | "confirm" | "discard">(null);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "problems">("all");
  const invoiceLines = kind === "supplier_invoice" ? ((staged.payload as { lines: StagedInvoiceLine[] } | null)?.lines ?? []) : [];
  const [lineEdits, setLineEdits] = useState(invoiceLines.map((l) => ({ ingredientId: l.ingredientId, include: true, packSize: l.packSize })));
  const fileIssues = staged.issues.filter((i) => i.row === null);
  const blocking = fileIssues.some((i) => i.severity === "error");
  const errors = staged.issues.filter((i) => i.severity === "error" && i.row !== null).length;
  const warnings = staged.issues.filter((i) => i.severity === "warning").length;
  const reviewable = status === "awaiting_review";

  async function act(kindOf: "confirm" | "discard") {
    setBusy(kindOf);
    setErr(null);
    try {
      const body = kindOf === "confirm" && kind === "supplier_invoice"
        ? {
            overrides: {
              lines: invoiceLines.map((l, index) => {
                const e = lineEdits[index];
                const ing = ingredients.find((i) => i.id === e.ingredientId);
                // If the owner remapped the line, recompute the base quantity from the pack size they confirmed.
                let baseQuantity: number | null = null;
                if (ing && e.packSize && l.packUnit) {
                  const f = l.packUnit === "g" || l.packUnit === "ml" ? 0.001 : 1;
                  baseQuantity = l.invoiceQty * e.packSize * f;
                } else if (ing && e.ingredientId === l.ingredientId) baseQuantity = l.baseQuantity;
                return { index, ingredientId: e.ingredientId, include: e.include, baseQuantity };
              }),
            },
          }
        : {};
      const r = await fetch(`/api/uploads/${id}/${kindOf}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      router.refresh();
      if (kindOf === "discard") router.push("/data");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const rows = filter === "problems" ? staged.preview.filter((p) => p.status !== "ok") : staged.preview;

  return (
    <div className="space-y-5">
      {fileIssues.length > 0 && (
        <Panel title="File checks">
          <ul className="space-y-1.5 text-[12px]">
            {fileIssues.map((i, k) => (
              <li key={k} className="flex gap-2"><Badge tone={i.severity === "error" ? "bad" : "warn"}>{i.severity}</Badge><span className="text-ink-2">{i.message}</span></li>
            ))}
          </ul>
        </Panel>
      )}

      {kind === "supplier_invoice" ? (
        <Panel pad={false} title="Extracted lines" subtitle="Check each line. Map it to an ingredient to update recipe costs, or leave it unmapped (e.g. packaging). Uncheck to exclude.">
          <div className="overflow-x-auto">
            <table className="tbl num">
              <thead><tr><th>Include</th><th>Description (as printed)</th><th className="r">Qty</th><th>Unit</th><th className="r">Unit price</th><th className="r">Line total</th><th>Costing ingredient</th><th className="r">Pack size</th><th className="r">£ / base unit</th><th>Use-by</th><th>Checks</th></tr></thead>
              <tbody>
                {invoiceLines.map((l, i) => {
                  const e = lineEdits[i];
                  const ing = ingredients.find((x) => x.id === e.ingredientId);
                  const f = l.packUnit === "g" || l.packUnit === "ml" ? 0.001 : 1;
                  const base = ing && e.packSize && l.packUnit ? l.invoiceQty * e.packSize * f : e.ingredientId === l.ingredientId ? l.baseQuantity : null;
                  return (
                    <tr key={i} className={cx(!e.include && "opacity-45")}>
                      <td><input type="checkbox" checked={e.include} disabled={!reviewable} onChange={(x) => setLineEdits((s) => s.map((v, k) => (k === i ? { ...v, include: x.target.checked } : v)))} aria-label="Include line" /></td>
                      <td className="text-ink">{l.description}</td>
                      <td className="r">{l.invoiceQty}</td>
                      <td className="text-ink-2">{l.invoiceUnit}</td>
                      <td className="r">£{l.unitPriceInvoice.toFixed(2)}</td>
                      <td className="r text-ink">£{l.lineTotal.toFixed(2)}</td>
                      <td>
                        <select className="input h-7 min-w-[200px] text-[12px]" value={e.ingredientId ?? ""} disabled={!reviewable} onChange={(x) => setLineEdits((s) => s.map((v, k) => (k === i ? { ...v, ingredientId: x.target.value || null } : v)))}>
                          <option value="">— Not an ingredient —</option>
                          {ingredients.map((g) => <option key={g.id} value={g.id}>{g.name} ({g.base_unit})</option>)}
                        </select>
                      </td>
                      <td className="r">
                        {ing ? (
                          <span className="inline-flex items-center gap-1">
                            <input className="input num h-7 w-16 text-right text-[12px]" type="number" step="0.01" min="0" value={e.packSize ?? ""} disabled={!reviewable} onChange={(x) => setLineEdits((s) => s.map((v, k) => (k === i ? { ...v, packSize: x.target.value ? Number(x.target.value) : null } : v)))} />
                            <span className="text-[11px] text-muted">{l.packUnit ?? ing.base_unit}</span>
                          </span>
                        ) : <span className="text-faint">—</span>}
                      </td>
                      <td className="r">{ing && base ? `£${(l.lineTotal / base).toFixed(3)}/${ing.base_unit}` : <span className="text-faint">—</span>}</td>
                      <td className="whitespace-nowrap text-[12px] text-ink-2">{l.expiryDate ?? <span className="text-faint">—</span>}</td>
                      <td className="max-w-[300px] text-[11px]">
                        {l.issues.length > 0 && <div className="text-warn">{l.issues.join("; ")}</div>}
                        {(l.orderIssues ?? []).length > 0 && <div className="text-bad">vs order: {l.orderIssues.join("; ")}</div>}
                        {l.issues.length === 0 && (l.orderIssues ?? []).length === 0 && <span className="text-good">OK</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      ) : (
        <Panel
          pad={false}
          title="Preview"
          subtitle={`${staged.preview.length < Number(staged.summary.rows ?? 0) ? `Showing ${staged.preview.length} of ${staged.summary.rows} rows (all problem rows included). ` : ""}Rows with errors are excluded from the import.`}
          actions={
            <div className="flex items-center gap-2 text-[12px]">
              {errors > 0 && <Badge tone="bad">{errors} errors</Badge>}
              {warnings > 0 && <Badge tone="warn">{warnings} warnings</Badge>}
              <select className="input h-7 w-auto text-[12px]" value={filter} onChange={(e) => setFilter(e.target.value as "all" | "problems")}><option value="all">All rows</option><option value="problems">Problems only</option></select>
            </div>
          }
        >
          <div className="max-h-[520px] overflow-auto">
            <table className="tbl num">
              <thead><tr><th className="r">Row</th>{staged.columns.map((c) => <th key={c}>{c}</th>)}<th>Status</th></tr></thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.row} className={cx(p.status === "error" && "bg-[color:var(--bad-bg)]")}>
                    <td className="r text-faint">{p.row}</td>
                    {p.cells.map((c, k) => <td key={k} className="whitespace-nowrap text-ink-2">{c === null || c === "" ? <span className="text-faint">—</span> : String(c)}</td>)}
                    <td className="min-w-[220px] text-[11px]">{p.status === "ok" ? <span className="text-good">OK</span> : <span className={p.status === "error" ? "text-bad" : "text-warn"}>{p.message}</span>}</td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={staged.columns.length + 2} className="text-center text-muted">No rows to show.</td></tr>}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {reviewable && (
        <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t border-line bg-bg py-3">
          <p className="text-[12px] text-muted">
            {blocking ? "This file has blocking errors and can't be imported." : kind === "supplier_invoice" ? "Confirming adds this invoice and updates ingredient costs for its date." : `${errors ? `${errors} rows with errors will be skipped. ` : ""}Confirming writes the valid rows to your financial records.`}
          </p>
          <div className="flex items-center gap-2">
            {err && <span className="text-[12px] text-bad">{err}</span>}
            <Button variant="danger" disabled={!!busy} onClick={() => act("discard")}>{busy === "discard" ? "Discarding…" : "Discard"}</Button>
            <Button variant="primary" disabled={!!busy || blocking} onClick={() => act("confirm")}>{busy === "confirm" ? "Importing…" : "Confirm import"}</Button>
          </div>
        </div>
      )}
      {status === "imported" && <p className="text-[12px] text-good">Imported. Analyses now include this data.</p>}
    </div>
  );
}
