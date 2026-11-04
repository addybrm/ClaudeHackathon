import Link from "next/link";
import { notFound } from "next/navigation";
import { getActiveBusiness } from "@/lib/business";
import { num, query } from "@/lib/db";
import { dateLong, gbp2 } from "@/lib/format";
import { invoiceChecks } from "@/lib/finance/operations";
import { Badge, KV, PageHeader, Panel } from "@/components/ui";

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const b = await getActiveBusiness();
  if (!b) notFound();
  const { id } = await params;
  const [inv] = await query<Record<string, string | null>>(
    `select i.id, i.invoice_number, i.invoice_date::text as date, i.subtotal, i.vat_amount, i.total, i.source, s.name as supplier,
       f.id as file_id, f.file_name, f.extraction_method, f.storage_path, f.confirmed_at::text as confirmed_at
     from supplier_invoices i join suppliers s on s.id = i.supplier_id left join uploaded_files f on f.id = i.uploaded_file_id
     where i.id = $1 and i.business_id = $2`,
    [id, b.id],
  );
  if (!inv) notFound();
  const lines = await query<Record<string, string | null>>(
    `select l.description, l.pack_description, l.quantity, l.unit, l.unit_price, l.line_total, ing.name as ingredient
     from supplier_invoice_lines l left join ingredients ing on ing.id = l.ingredient_id where l.invoice_id = $1 order by l.line_total desc`,
    [id],
  );
  const hasFile = !!inv.storage_path;
  const check = (await invoiceChecks(b, inv.date!, new Date(Date.parse(inv.date! + "T00:00:00Z") + 86400000).toISOString().slice(0, 10))).checks.find((c) => c.invoiceId === id) ?? null;
  const expiries = await query<{ description: string; expiry_date: string | null; confidence: string | null }>(`select description, expiry_date::text, confidence from supplier_invoice_lines where invoice_id = $1`, [id]);
  const expiryBy = new Map(expiries.map((e) => [e.description, e]));
  return (
    <>
      <div className="mb-2 text-[12px] text-muted"><Link href="/costs" className="hover:text-ink">Cost intelligence</Link> / Invoices</div>
      <PageHeader title={`${inv.supplier} · ${inv.invoice_number}`} description={`Dated ${dateLong(inv.date)}`} actions={hasFile ? <a href={`/api/uploads/${inv.file_id}/file`} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center rounded border border-line-strong bg-surface-2 px-3 text-[13px] text-ink hover:bg-surface-3">View source document ↗</a> : undefined} />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Panel pad={false} title="Lines" subtitle="Quantities and unit prices normalised to each ingredient's base unit">
          <table className="tbl num">
            <thead><tr><th>Description</th><th>Pack</th><th className="r">Quantity</th><th className="r">Unit price</th><th className="r">Line total</th><th>Costing ingredient</th><th>Use-by</th><th>vs order</th></tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td className="text-ink">{l.description}</td>
                  <td className="text-[12px] text-muted">{l.pack_description ?? "—"}</td>
                  <td className="r">{num(l.quantity).toLocaleString("en-GB", { maximumFractionDigits: 2 })} {l.unit}</td>
                  <td className="r">{gbp2(num(l.unit_price))}/{l.unit}</td>
                  <td className="r text-ink">{gbp2(num(l.line_total))}</td>
                  <td>{l.ingredient ? <span className="text-ink-2">{l.ingredient}</span> : <Badge title="Stored for the record; not used for recipe costing">not an ingredient</Badge>}</td>
                  <td className="text-[12px] text-muted">{expiryBy.get(l.description!)?.expiry_date ? dateLong(expiryBy.get(l.description!)!.expiry_date) : "—"}</td>
                  <td className="text-[12px]">{(() => {
                    const cl = check?.lines.find((x) => x.description === l.description);
                    if (!check || check.status === "no_order") return <span className="text-faint">—</span>;
                    if (!cl || cl.issues.length === 0) return <span className="text-good">matches</span>;
                    return <span className="text-bad">{cl.issues.map((i) => i.text).join("; ")}</span>;
                  })()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <Panel title="Totals & provenance">
          <KV k="Net" v={gbp2(num(inv.subtotal))} />
          <KV k="VAT" v={gbp2(num(inv.vat_amount))} />
          <KV k="Total" v={gbp2(num(inv.total))} />
          <div className="my-3 border-t border-line" />
          <KV k="Order" v={check?.matchedOrder ?? <Badge tone="warn">none on file</Badge>} />
          {check && check.status !== "no_order" && <KV k="Order check" v={check.status === "verified" ? <Badge tone="good">matches</Badge> : <Badge tone="bad">differs{check.atStake > 0 ? ` · ${gbp2(check.atStake)} at stake` : ""}</Badge>} />}
          {check && check.missingFromInvoice.length > 0 && <p className="mt-1 text-[12px] text-muted">Ordered but not invoiced: {check.missingFromInvoice.map((m) => m.description).join(", ")}</p>}
          <div className="my-3 border-t border-line" />
          <KV k="Source" v={inv.source === "demo" ? <Badge tone="warn">Demo seed data</Badge> : inv.extraction_method === "claude" ? <Badge tone="info">Extracted by Claude, confirmed by owner</Badge> : inv.extraction_method === "preread_sample" ? <Badge tone="warn">Pre-read sample (not live AI)</Badge> : <Badge>Imported</Badge>} />
          {inv.file_name && <KV k="File" v={<span className="text-[12px]">{inv.file_name}</span>} />}
          {inv.confirmed_at && inv.source !== "demo" && <KV k="Confirmed" v={dateLong(inv.confirmed_at)} />}
          {!hasFile && <p className="mt-3 text-[12px] text-muted">{inv.source === "demo" ? "Demo invoices are generated records without a source document. Upload the sample PDF in the Data Centre to see document extraction." : "The original file is not available."}</p>}
        </Panel>
      </div>
    </>
  );
}
