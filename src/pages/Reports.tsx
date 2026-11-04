import { useState } from 'react';
import { Download, Printer } from 'lucide-react';
import { toast } from 'sonner';
import { downloadReport, getReport, type Rec } from '../api';
import { useApp } from '../app-context';
import { deriveRecs } from '../derive';
import { useAsync } from '../hooks';
import { Banner, EmptyState, ErrorState, PageHeader, Pill, Skeleton, StatusPill, money, pct, signed } from '../ui';
import { Logo } from '../Logo';

export function ReportsPage() {
  const { core, live, params, can } = useApp();
  const cur = core.restaurant.currency;
  const allowed = can('report:read');
  const r = useAsync(() => (live && allowed ? getReport(params) : null), [live, allowed, params.start, params.end, params.locationId]);
  const [busy, setBusy] = useState(false);

  const download = async () => {
    setBusy(true);
    try {
      const { blob, name } = await downloadReport(params);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = name; a.click();
      URL.revokeObjectURL(url);
      toast.success('Report downloaded', { description: name });
    } catch (e: any) { toast.error('Download failed', { description: e.message }); } finally { setBusy(false); }
  };

  const actions = (
    <>
      <button className="btn" onClick={() => window.print()}><Printer size={14} aria-hidden /> Print or save as PDF</button>
      {live && <button className="btn primary" disabled={busy || !allowed} onClick={download}><Download size={14} aria-hidden /> {busy ? 'Preparing…' : 'Download (.md)'}</button>}
    </>
  );

  if (live && !allowed) return <><PageHeader eyebrow="Plan" title="Reports" /><EmptyState title="Reports are not available for your role">Owners, managers and finance administrators can view and download profitability reports.</EmptyState></>;
  if (live && r.loading && !r.data) return <><PageHeader eyebrow="Plan" title="Reports" /><div className="panel"><div className="panel-b"><Skeleton rows={8} height={20} /></div></div></>;
  if (live && r.error) return <><PageHeader eyebrow="Plan" title="Reports" /><ErrorState message={r.error} onRetry={r.reload} /></>;

  // Live report from the API, or a report assembled from the offline sample
  const R = live ? r.data : null;
  const k = R ? R.summary : core.kpis;
  const table = R ? R.menu_performance.table : core.dishes.map(d => ({ profitability_rank: d.rank, name: d.name, selling_price: d.price, ingredient_cost: d.cost, gross_profit: d.grossProfit, gross_margin_pct: d.marginPct, food_cost_pct: d.foodCostPct, units_sold: d.units, status: d.status }));
  const changes = R ? R.supplier_changes : core.priceChanges.map(p => ({ ingredient_id: p.id, name: p.name, supplier: p.supplier, price_at_period_start: p.from, current_price: p.to, change_pct: p.changePct, weekly_cost_impact: p.weeklyImpact, unit: p.unit }));
  const recs: Rec[] = R ? R.recommendations : deriveRecs(core);
  const period = R?.period ?? core.period;

  return (
    <>
      <PageHeader eyebrow="Plan" title="Reports" subtitle="A profitability summary for the selected period, ready to print, save or send to your accountant." actions={actions} />
      {!live && <Banner tone="warn">This report is built from the offline sample. It is an illustration, not an accounting statement.</Banner>}
      <article className="sheet">
        <div className="sheet-h">
          <Logo />
          <div className="sheet-meta"><b>Profitability report</b><span>{period ? `${new Date(period.start).toLocaleDateString('en-GB')} to ${new Date(period.end).toLocaleDateString('en-GB')} · ${period.location}` : 'Sample period'}</span><span>Generated {R ? new Date(R.generated_at).toLocaleString('en-GB') : new Date().toLocaleString('en-GB')}</span></div>
        </div>
        <div className="sheet-title"><h2>{core.restaurant.name}</h2>{(R?.is_demo_data ?? core.restaurant.isDemo) && <Pill tone="warn">Fictional demonstration data</Pill>}</div>

        <h3>Summary</h3>
        <div className="sheet-kpis">
          {[['Revenue', money(k.revenue, cur)], ['Ingredient spend', money(k.ingredient_expenditure, cur)], ['Gross profit', money(k.gross_profit, cur)], ['Gross margin', pct(k.gross_margin_pct)], ['Food cost', `${pct(k.food_cost_pct)} (target ${k.target_food_cost_pct}%)`], ['Waste cost', money(k.waste_cost, cur, 2)]].map(([l, v]) => <div key={l}><span>{l}</span><b className="num">{v}</b></div>)}
        </div>

        <h3>Menu performance</h3>
        <div className="scroll"><table className="tbl compact">
          <thead><tr><th>#</th><th>Dish</th><th className="r">Price</th><th className="r">Cost</th><th className="r">Profit / plate</th><th className="r">Margin</th><th className="r">Food cost</th>{R && <th className="r">Sold</th>}<th>Status</th></tr></thead>
          <tbody>{table.map((d: any, i: number) => (
            <tr key={i}><td className="muted num">{d.profitability_rank || i + 1}</td><td>{d.name}</td><td className="r num">{money(d.selling_price, cur, 2)}</td><td className="r num">{money(d.ingredient_cost, cur, 2)}</td><td className="r num">{money(d.gross_profit, cur, 2)}</td><td className="r num">{pct(d.gross_margin_pct)}</td><td className="r num">{pct(d.food_cost_pct)}</td>{R && <td className="r num">{d.units_sold}</td>}<td><StatusPill status={d.status} /></td></tr>
          ))}</tbody>
        </table></div>

        <h3>Supplier price changes</h3>
        {changes.length ? (
          <div className="scroll"><table className="tbl compact">
            <thead><tr><th>Ingredient</th><th>Supplier</th><th className="r">Before</th><th className="r">Now</th><th className="r">Change</th><th className="r">Weekly cost</th></tr></thead>
            <tbody>{changes.map((c: any) => <tr key={c.ingredient_id}><td>{c.name}</td><td className="muted">{c.supplier}</td><td className="r num">{money(c.price_at_period_start, cur, 2)}</td><td className="r num">{money(c.current_price, cur, 2)}</td><td className="r num">{signed(c.change_pct)}</td><td className="r num">{c.weekly_cost_impact ? money(c.weekly_cost_impact, cur, 2) : '—'}</td></tr>)}</tbody>
          </table></div>
        ) : <p className="muted">No price changes in this period.</p>}

        {R && (
          <>
            <h3>Spend by supplier</h3>
            <div className="scroll"><table className="tbl compact">
              <thead><tr><th>Supplier</th><th className="r">Invoices</th><th className="r">Spend</th><th className="r">Share</th></tr></thead>
              <tbody>{R.supplier_spend.map((s: any) => <tr key={s.id}><td>{s.name}</td><td className="r num">{s.invoices_in_period}</td><td className="r num">{money(s.spend_in_period, cur)}</td><td className="r num">{pct(s.share_of_spend_pct, 0)}</td></tr>)}</tbody>
            </table></div>

            <h3>Food waste</h3>
            <p>Total <b>{money(R.waste.total_cost, cur, 2)}</b> across {R.waste.record_count} records{R.waste.change_pct != null && <> ({signed(R.waste.change_pct)} vs previous period)</>}. {R.waste.top_ingredients[0] && <>Largest item: {R.waste.top_ingredients[0].name} ({money(R.waste.top_ingredients[0].cost, cur, 2)}).</>}</p>

            <h3>Profit leakage</h3>
            <table className="tbl compact">
              <tbody>
                {R.profit_leakage.categories.map((c: any) => <tr key={c.category}><td>{c.label}<small>{c.formula}</small></td><td className="r num strong">{money(c.amount, cur, 2)}</td></tr>)}
                <tr><td><b>Estimated total</b><small>About {money(R.profit_leakage.annualised_estimate, cur)} a year if unchanged (projection)</small></td><td className="r num strong">{money(R.profit_leakage.total_estimated_leakage, cur, 2)}</td></tr>
              </tbody>
            </table>
          </>
        )}

        <h3>Recommendations</h3>
        {recs.length ? <ol className="steps">{recs.map((x, i) => <li key={i}><b>{x.area}.</b> {x.action} <span className="muted">{x.estimated_impact > 0 && <>≈ {money(x.estimated_impact, cur, 2)} · </>}{x.basis}.</span></li>)}</ol> : <p className="muted">No recommendations for this period.</p>}

        <p className="sheet-foot">All figures are calculated deterministically from recorded sales, invoices and waste. Estimates and projections are labelled. This report is a management summary, not an accounting statement.</p>
      </article>
    </>
  );
}
