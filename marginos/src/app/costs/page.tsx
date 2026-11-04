import Link from "next/link";
import { getActiveBusiness, resolvePeriodKey } from "@/lib/business";
import { num, query } from "@/lib/db";
import { supplierComparison, supplierPriceChanges } from "@/lib/finance/engine";
import { invoiceChecks } from "@/lib/finance/operations";
import { period, previousPeriod } from "@/lib/finance/period";
import { dateLong, gbp, gbp2, pct, qty, signed } from "@/lib/format";
import { HBars } from "@/components/charts";
import { PeriodPicker } from "@/components/shell";
import { Badge, Button, Empty, PageHeader, Panel, Stat, StatRow } from "@/components/ui";

export default async function CostsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const b = await getActiveBusiness();
  if (!b) return <Empty title="No business loaded" action={<Button href="/" variant="primary">Get started</Button>} />;
  const sp = await searchParams;
  const { key, available } = await resolvePeriodKey(b, sp.period);
  if (!key) return <Empty title="No sales data yet" action={<Button href="/data">Open Data Centre</Button>} />;
  const cur = period(key);
  const prev = previousPeriod(key);
  const [changes, comparison, spend, invoices, checks] = await Promise.all([
    supplierPriceChanges(b, cur, prev),
    supplierComparison(b, cur.start, cur.end),
    query<{ supplier: string; cur: string; prev: string }>(
      `select s.name as supplier,
        coalesce(sum(i.subtotal) filter (where i.invoice_date >= $2 and i.invoice_date < $3), 0) as cur,
        coalesce(sum(i.subtotal) filter (where i.invoice_date >= $4 and i.invoice_date < $2), 0) as prev
       from suppliers s left join supplier_invoices i on i.supplier_id = s.id where s.business_id = $1 group by s.name order by cur desc`,
      [b.id, cur.start, cur.end, prev.start],
    ),
    query<{ id: string; invoice_number: string; invoice_date: string; supplier: string; subtotal: string; total: string; lines: string; source: string; method: string | null; unmatched: string }>(
      `select i.id, i.invoice_number, i.invoice_date::text, s.name as supplier, i.subtotal, i.total, i.source, f.extraction_method as method,
        (select count(*) from supplier_invoice_lines l where l.invoice_id = i.id) as lines,
        (select count(*) from supplier_invoice_lines l where l.invoice_id = i.id and l.ingredient_id is null) as unmatched
       from supplier_invoices i join suppliers s on s.id = i.supplier_id left join uploaded_files f on f.id = i.uploaded_file_id
       where i.business_id = $1 order by i.invoice_date desc, s.name limit 60`,
      [b.id],
    ),
    invoiceChecks(b, cur.start, cur.end),
  ]);
  const checkById = new Map(checks.checks.map((c) => [c.invoiceId, c]));
  const problems = checks.checks.filter((c) => c.status !== "verified");
  const moved = changes.changes.filter((c) => c.changePct !== null && Math.abs(c.changePct) >= 1 && c.usageCurrent > 0);
  const ups = moved.filter((c) => (c.changePct ?? 0) > 0);
  const purchasesCur = spend.reduce((s, r) => s + num(r.cur), 0);
  const purchasesPrev = spend.reduce((s, r) => s + num(r.prev), 0);
  const est = [...changes.changes].filter((c) => c.currentSource === "standard_estimate");

  return (
    <>
      <PageHeader
        title="Cost intelligence"
        description="Supplier price movements, and what they cost you at the quantities your recipes actually use. Prices are weighted averages of invoice lines in each month, ex VAT."
        actions={<PeriodPicker value={key} available={available} compareLabel={prev.label} />}
      />
      <StatRow cols={4}>
        <Stat label="Ingredient price impact" value={gbp(changes.totalImpact)} sub={`on ${cur.short} contribution`} hint="Σ current-month recipe usage × (current price − previous price)" />
        <Stat label="Ingredients up ≥1%" value={ups.length} sub={ups[0] ? `largest: ${ups[0].ingredient}` : undefined} />
        <Stat label="Purchases (invoiced)" value={gbp(purchasesCur)} sub={`${prev.short}: ${gbp(purchasesPrev)}`} hint="Invoice subtotals ex VAT dated in the month" />
        <Stat label="Billed above the order" value={gbp(checks.summary.atStake)} sub={`${checks.summary.discrepancies} of ${checks.summary.invoices} invoices differ`} hint="Invoices compared with supplier order confirmations. Potentially recoverable as supplier credit." />
      </StatRow>

      <div className="mt-5 space-y-5">
        <Panel
          pad={false}
          title="Invoices checked against supplier orders"
          subtitle={`${cur.label}: ${checks.summary.verified} matched exactly, ${checks.summary.discrepancies} differ, ${checks.summary.noOrder} had no order on file. Money at stake may be recoverable as a credit note.`}
        >
          {problems.length === 0 ? <div className="p-4 text-[12px] text-muted">Every invoice this month matched its order.</div> : (
            <table className="tbl num">
              <thead><tr><th>Invoice</th><th>Supplier</th><th>Order</th><th>What&apos;s different</th><th className="r">At stake</th></tr></thead>
              <tbody>
                {problems.map((c) => (
                  <tr key={c.invoiceId} className="row-link">
                    <td><Link href={`/costs/invoices/${c.invoiceId}`} className="block font-mono text-[12px] text-ink">{c.invoiceNumber}</Link><span className="text-[11px] text-muted">{dateLong(c.date)}</span></td>
                    <td className="text-ink-2">{c.supplier}</td>
                    <td className="font-mono text-[12px] text-muted">{c.matchedOrder ?? <Badge tone="warn">no order on file</Badge>}</td>
                    <td className="text-[12px] text-ink-2">
                      {c.status === "no_order" ? "Prices can't be checked against what was agreed." : (
                        <ul className="space-y-0.5">
                          {c.lines.flatMap((l) => l.issues.map((i, k) => <li key={l.description + k}><span className="text-muted">{l.description}:</span> {i.text}</li>))}
                          {c.missingFromInvoice.map((m) => <li key={m.description}><span className="text-muted">{m.description}:</span> ordered but not invoiced</li>)}
                        </ul>
                      )}
                    </td>
                    <td className={`r font-medium ${c.atStake > 0 ? "text-bad" : "text-muted"}`}>{c.atStake > 0 ? gbp2(c.atStake) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        <Panel pad={false} title="Ingredient price changes" subtitle={`${prev.label} → ${cur.label}, sorted by impact on contribution`}>
          {moved.length === 0 ? <div className="p-4 text-[12px] text-muted">No price movements of 1% or more.</div> : (
            <div className="overflow-x-auto">
              <table className="tbl num">
                <thead><tr><th>Ingredient</th><th className="r">{prev.short}</th><th className="r">{cur.short}</th><th className="r">Change</th><th className="r">Used in {cur.short}</th><th className="r">Impact</th><th>Most affected dishes</th><th>Latest invoice</th></tr></thead>
                <tbody>
                  {moved.map((c) => {
                    const last = c.invoiceEvidence[c.invoiceEvidence.length - 1];
                    return (
                      <tr key={c.ingredientId}>
                        <td className="min-w-[180px]"><div className="text-ink">{c.ingredient}</div><div className="text-[11px] text-muted">{c.suppliers.join(", ")}</div></td>
                        <td className="r text-ink-2">{gbp2(c.previousUnitCost)}/{c.baseUnit}</td>
                        <td className="r text-ink">{gbp2(c.currentUnitCost)}/{c.baseUnit}</td>
                        <td className={`r ${(c.changePct ?? 0) > 0 ? "text-bad" : "text-good"}`}>{signed(c.changePct)}</td>
                        <td className="r">{qty(c.usageCurrent, c.baseUnit)}</td>
                        <td className={`r font-medium ${c.impactCurrentPeriod < 0 ? "text-bad" : "text-good"}`}>{gbp(c.impactCurrentPeriod)}</td>
                        <td className="max-w-[360px] text-[12px] text-muted">{c.affectedDishes.filter((d) => d.unitsSold > 0).slice(0, 3).map((d) => `${d.name} (${gbp(d.impact)})`).join(", ") || "—"}</td>
                        <td className="whitespace-nowrap text-[12px]">{last ? <InvoiceLink invoices={invoices} number={last.invoiceNumber} label={`${last.invoiceNumber} · ${dateLong(last.date)}`} /> : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {est.length > 0 && <p className="border-t border-line px-4 py-2 text-[12px] text-muted"><Badge tone="warn">est.</Badge> {est.map((e) => e.ingredient).join(", ")} priced from an estimated standard cost: no invoice on file.</p>}
        </Panel>

        <div className="grid gap-5 lg:grid-cols-2">
          <Panel title="Supplier comparison" subtitle={`Same ingredient bought from more than one supplier in ${cur.label}`}>
            {comparison.length === 0 ? <p className="text-[12px] text-muted">No ingredient was bought from more than one supplier.</p> : (
              <ul className="space-y-3">
                {comparison.map((c) => (
                  <li key={c.ingredientId} className="text-[12px]">
                    <div className="flex items-baseline justify-between"><span className="text-ink">{c.ingredient}</span>{c.potentialSaving > 0 && <span className="text-good">save up to {gbp(c.potentialSaving)}</span>}</div>
                    <table className="num mt-1 w-full">
                      <tbody>
                        {c.suppliers.map((s) => (
                          <tr key={s.supplier} className="text-muted">
                            <td className={s.supplier === c.cheapestSupplier ? "text-ink-2" : ""}>{s.supplier}{s.supplier === c.mainSupplier && <span className="ml-1 text-faint">(main)</span>}</td>
                            <td className="text-right">{qty(s.qty, c.baseUnit)}</td>
                            <td className="w-20 text-right text-ink-2">{gbp2(s.avgPrice)}/{c.baseUnit}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {c.potentialSaving > 0 && <p className="mt-1 text-faint">{c.cheapestSupplier} was {pct(c.spreadPct)} cheaper. Saving assumes all {c.mainSupplier} volume at that price; check quality and delivery terms.</p>}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title="Spend by supplier" subtitle={`${cur.short}; marker shows ${prev.short}`}>
            <HBars rows={spend.filter((s) => num(s.cur) > 0 || num(s.prev) > 0).map((s) => ({ label: s.supplier, value: num(s.cur), previous: num(s.prev) }))} compare={prev.short} />
          </Panel>
        </div>
      </div>

      <Panel className="mt-5" pad={false} title="Invoice history" subtitle="Click an invoice to see its lines and source document">
        <div className="max-h-[420px] overflow-auto">
          <table className="tbl num">
            <thead><tr><th>Date</th><th>Supplier</th><th>Invoice</th><th className="r">Lines</th><th className="r">Net</th><th className="r">Total</th><th>Order check</th><th>Source</th></tr></thead>
            <tbody>
              {invoices.map((i) => (
                <tr key={i.id} className="row-link">
                  <td><Link href={`/costs/invoices/${i.id}`} className="block">{dateLong(i.invoice_date)}</Link></td>
                  <td className="text-ink">{i.supplier}</td>
                  <td className="font-mono text-[12px]">{i.invoice_number}</td>
                  <td className="r">{i.lines}{num(i.unmatched) > 0 && <span className="ml-1 text-[11px] text-muted">({i.unmatched} non-ingredient)</span>}</td>
                  <td className="r">{gbp2(num(i.subtotal))}</td>
                  <td className="r">{gbp2(num(i.total))}</td>
                  <td>{(() => { const c = checkById.get(i.id); if (!c) return <span className="text-[12px] text-faint">—</span>; return c.status === "verified" ? <Badge tone="good">matches order</Badge> : c.status === "no_order" ? <Badge tone="warn">no order</Badge> : <Badge tone="bad">differs{c.atStake > 0 ? ` · ${gbp2(c.atStake)}` : ""}</Badge>; })()}</td>
                  <td>{i.source === "demo" ? <Badge tone="warn">demo seed</Badge> : i.method === "claude" ? <Badge tone="info">extracted by Claude</Badge> : i.method === "preread_sample" ? <Badge tone="warn">pre-read sample</Badge> : <Badge>imported</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}

function InvoiceLink({ invoices, number, label }: { invoices: { id: string; invoice_number: string }[]; number: string; label: string }) {
  const inv = invoices.find((i) => i.invoice_number === number);
  return inv ? <Link href={`/costs/invoices/${inv.id}`} className="text-ink-2 underline decoration-line-strong underline-offset-2 hover:text-ink">{label}</Link> : <span className="text-muted">{label}</span>;
}
