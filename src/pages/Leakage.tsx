import { useMemo, useState } from 'react';
import { getLeakage } from '../api';
import { useApp } from '../app-context';
import { COLORS } from '../derive';
import { useAsync } from '../hooks';
import { Banner, EmptyState, ErrorState, PageHeader, Panel, Pill, SeverityPill, Segmented, Skeleton, money, pct, signed } from '../ui';

type Driver = { key: string; kind: 'prices' | 'purchasing' | 'waste'; name: string; cause: string; dishes: string[]; amount: number };
const KIND_LABEL = { prices: 'Supplier price', purchasing: 'Purchasing', waste: 'Waste' } as const;
const KIND_COLOR = { prices: COLORS.amber, purchasing: COLORS.brand, waste: COLORS.sage } as const;

export function LeakagePage() {
  const { core, live, params } = useApp();
  const cur = core.restaurant.currency;
  const [kind, setKind] = useState<'all' | Driver['kind']>('all');
  const data = useAsync(() => (live ? getLeakage(params) : null), [live, params.start, params.end, params.locationId]);
  const L = data.data;

  const drivers = useMemo<Driver[]>(() => {
    if (!L) return [];
    const dishesUsing = (id: string) => core.dishes.filter(d => d.ingredients.some(i => i.id === id)).map(d => d.name);
    const change = (id: string) => core.priceChanges.find(p => p.id === id);
    const [prices, purchasing, waste] = L.categories;
    return [
      ...prices.items.map((i: any): Driver => {
        const c = change(i.ingredient_id);
        return { key: `p-${i.ingredient_id}`, kind: 'prices', name: i.name, amount: i.amount, dishes: c?.affected.map(a => a.name) ?? dishesUsing(i.ingredient_id),
          cause: c ? `${c.supplier} raised the price ${signed(c.changePct)} (${money(c.from, cur, 2)} → ${money(c.to, cur, 2)} per ${c.unit}). You paid the higher price on every purchase after the rise.` : 'Paid more than the price at the start of the period.' };
      }),
      ...purchasing.items.map((i: any): Driver => ({ key: `v-${i.ingredient_id}`, kind: 'purchasing', name: i.name, amount: i.amount, dishes: dishesUsing(i.ingredient_id),
        cause: `Purchases exceeded what recipes and recorded waste explain${i.variance_pct_of_usage != null ? ` by ${pct(i.variance_pct_of_usage)}` : ''}. Likely over-portioning, unrecorded waste or delivery differences.` })),
      ...waste.items.map((i: any): Driver => ({ key: `w-${i.ingredient_id}`, kind: 'waste', name: i.name, amount: i.cost, dishes: dishesUsing(i.ingredient_id),
        cause: `${i.records} waste ${i.records === 1 ? 'record' : 'records'}, ${i.quantity} ${i.unit} thrown away. ${i.suggestion}` })),
    ].sort((a, b) => b.amount - a.amount);
  }, [L, core.dishes, core.priceChanges, cur]);

  const shown = drivers.filter(d => kind === 'all' || d.kind === kind);
  const cats: { kind: Driver['kind']; label: string; amount: number; formula: string }[] = L ? [
    { kind: 'prices', label: 'Supplier price increases', amount: L.categories[0].amount, formula: L.categories[0].formula },
    { kind: 'purchasing', label: 'Purchases above recipe usage', amount: L.categories[1].amount, formula: L.categories[1].formula },
    { kind: 'waste', label: 'Recorded food waste', amount: L.categories[2].amount, formula: L.categories[2].formula },
  ] : [];
  const top = [...cats].sort((a, b) => b.amount - a.amount)[0];

  return (
    <>
      <PageHeader eyebrow="Analyse" title="Profit Leakage" subtitle="Money that left the business without earning anything: what caused it, which dishes it touches, and how much." />
      {!live && <Banner tone="info">Detailed leakage analysis needs the live backend. Offline, only the sample alerts and at-risk dishes are shown.</Banner>}

      {live && (data.loading && !L ? <Panel><Skeleton rows={6} height={22} /></Panel> : data.error ? <Panel><ErrorState message={data.error} onRetry={data.reload} /></Panel> : L && (
        <>
          <section className="kpis" aria-label="Leakage summary">
            <div className="kpi"><div className="kpi-l">Estimated leakage</div><div className="kpi-v">{money(L.total_estimated_leakage, cur)}</div><div className="kpi-f">This period ({core.period?.days} days)</div></div>
            <div className="kpi"><div className="kpi-l">Yearly equivalent</div><div className="kpi-v">{money(L.annualised_estimate, cur)}</div><div className="kpi-f">Projection if nothing changes</div></div>
            <div className="kpi"><div className="kpi-l">Biggest cause</div><div className="kpi-v sm">{top?.label}</div><div className="kpi-f">{money(top?.amount, cur)}</div></div>
            <div className="kpi"><div className="kpi-l">Open alerts</div><div className="kpi-v">{core.alerts.filter(a => a.severity !== 'info').length}</div><div className="kpi-f">{core.alerts.filter(a => a.severity === 'high').length} high priority</div></div>
          </section>

          <Panel title="Where it leaks" sub="Share of the estimated total by cause">
            <div className="stackbar" role="img" aria-label="Leakage by cause">
              {cats.map(c => <i key={c.kind} style={{ flex: Math.max(c.amount, 0.0001), background: KIND_COLOR[c.kind] }} title={`${c.label}: ${money(c.amount, cur)}`} />)}
            </div>
            <div className="cause-grid">
              {cats.map(c => (
                <div key={c.kind}>
                  <div className="cause-h"><i style={{ background: KIND_COLOR[c.kind] }} />{c.label}</div>
                  <div className="cause-v num">{money(c.amount, cur)}</div>
                  <small className="muted">{L.total_estimated_leakage > 0 ? pct((c.amount / L.total_estimated_leakage) * 100, 0) : '0%'} of total</small>
                  <p className="formula"><b>How it is calculated.</b> {c.formula}.</p>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Leakage drivers" sub="Largest first. Each line shows the cause and the dishes affected."
            actions={<Segmented label="Filter by cause" value={kind} onChange={setKind} options={[{ value: 'all', label: 'All' }, { value: 'prices', label: 'Prices' }, { value: 'purchasing', label: 'Purchasing' }, { value: 'waste', label: 'Waste' }]} />} flush>
            {shown.length ? (
              <div className="scroll"><table className="tbl">
                <thead><tr><th>Item</th><th>Cause</th><th>Dishes affected</th><th className="r">Estimated impact</th></tr></thead>
                <tbody>
                  {shown.slice(0, 14).map(d => (
                    <tr key={d.key}>
                      <td><b>{d.name}</b><small>{KIND_LABEL[d.kind]}</small></td>
                      <td className="wide-cell">{d.cause}</td>
                      <td className="muted">{d.dishes.length ? d.dishes.slice(0, 3).join(', ') + (d.dishes.length > 3 ? ` +${d.dishes.length - 3}` : '') : '—'}</td>
                      <td className="r num strong">{money(d.amount, cur, 2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            ) : <EmptyState title="No leakage in this category" />}
          </Panel>

          <div className="grid g-even">
            <Panel title="Dishes losing profit" sub="Margin fell compared with the start of the period" flush>
              {L.declining_margin_dishes.length ? (
                <div className="scroll"><table className="tbl">
                  <thead><tr><th>Dish</th><th className="r">Margin</th><th className="r">Change</th><th className="r">Profit lost</th></tr></thead>
                  <tbody>{L.declining_margin_dishes.map((d: any) => <tr key={d.dish_id}><td><b>{d.name}</b></td><td className="r num">{pct(d.gross_margin_pct)}</td><td className="r num neg-text">{signed(d.margin_change_pp, 1, ' pts')}</td><td className="r num strong">{money(d.lost_gross_profit, cur, 2)}</td></tr>)}</tbody>
                </table></div>
              ) : <EmptyState title="No dish lost margin" />}
            </Panel>
            <Panel title="Above the food-cost target" sub={`Food cost over ${core.kpis.target_food_cost_pct}% of the selling price`} flush>
              {L.high_food_cost_dishes.length ? (
                <div className="scroll"><table className="tbl">
                  <thead><tr><th>Dish</th><th className="r">Food cost</th><th className="r">Excess cost</th></tr></thead>
                  <tbody>{L.high_food_cost_dishes.map((d: any) => <tr key={d.dish_id}><td><b>{d.name}</b></td><td className="r num">{pct(d.food_cost_pct)}</td><td className="r num strong">{money(d.excess_cost_vs_target, cur, 2)}</td></tr>)}</tbody>
                </table></div>
              ) : <EmptyState title="Every dish is within target" />}
            </Panel>
          </div>

          {L.invoice_price_anomalies.length > 0 && (
            <Panel title="Unusual invoice prices" sub="Single invoice lines that jumped 10% or more from the previous price" flush>
              <div className="scroll"><table className="tbl">
                <thead><tr><th>Invoice</th><th>Ingredient</th><th>Supplier</th><th className="r">Previous</th><th className="r">Invoiced</th><th className="r">Change</th></tr></thead>
                <tbody>{L.invoice_price_anomalies.map((a: any, i: number) => <tr key={i}><td>{a.invoice_number}<small>{a.date}</small></td><td>{a.ingredient}</td><td className="muted">{a.supplier}</td><td className="r num">{money(a.previous_price, cur, 2)}</td><td className="r num strong">{money(a.invoiced_price, cur, 2)}</td><td className="r num neg-text">{signed(a.change_pct)}</td></tr>)}</tbody>
              </table></div>
            </Panel>
          )}
        </>
      ))}

      <Panel title="Financial alerts" sub={`${core.alerts.length} signals for this period`}>
        {core.alerts.length ? (
          <ul className="alerts wide">
            {core.alerts.map(a => (
              <li key={a.id}>
                <div><SeverityPill severity={a.severity} /></div>
                <div><b>{a.title}</b><p>{a.message}</p>{a.impact != null && <small>Estimated impact {money(a.impact, cur, 2)} {a.impactBasis === 'week' ? 'a week' : 'this period'}</small>}</div>
              </li>
            ))}
          </ul>
        ) : <EmptyState title="No alerts">Nothing needs attention for this period.</EmptyState>}
        {!live && core.dishes.some(d => d.status !== 'healthy') && <p className="muted pad-t">Dishes above target (sample): {core.dishes.filter(d => d.status !== 'healthy').map(d => d.name).join(', ')} <Pill tone="warn">sample</Pill></p>}
      </Panel>
    </>
  );
}
