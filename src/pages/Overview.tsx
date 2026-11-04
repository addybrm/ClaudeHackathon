import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChevronRight } from 'lucide-react';
import { getReport, type Rec } from '../api';
import { useApp } from '../app-context';
import { COLORS, deriveRecs } from '../derive';
import { useAsync } from '../hooks';
import { Bar, Delta, EmptyState, PageHeader, Panel, Pill, SeverityPill, Skeleton, StatusPill, money, pct, signed } from '../ui';

function Kpi({ label, value, children, foot }: { label: string; value: string; children?: React.ReactNode; foot?: React.ReactNode }) {
  return (
    <div className="kpi">
      <div className="kpi-l">{label}</div>
      <div className="kpi-v">{value}</div>
      {children}
      {foot && <div className="kpi-f">{foot}</div>}
    </div>
  );
}

export function Overview() {
  const { core: c, live, go, params, can } = useApp();
  const k = c.kpis, cur = c.restaurant.currency;
  const recs = useAsync<Rec[]>(
    () => (live && can('report:read') ? getReport(params).then(r => r.recommendations as Rec[]).catch(() => deriveRecs(c)) : Promise.resolve(deriveRecs(c))),
    [live, params.start, params.end, params.locationId, c.kpis.revenue, c.kpis.ingredient_expenditure],
  );
  const onTarget = k.food_cost_pct <= k.target_food_cost_pct;
  const gap = Math.abs(k.food_cost_pct - k.target_food_cost_pct);
  const declining = c.dishes.filter(d => d.marginChangePp != null && d.marginChangePp <= -1).sort((a, b) => (a.marginChangePp ?? 0) - (b.marginChangePp ?? 0));
  const atRisk = live ? declining : c.dishes.filter(d => d.status !== 'healthy');
  const byContribution = [...c.dishes].sort((a, b) => (live ? b.gpContribution - a.gpContribution : b.marginPct - a.marginPct));
  const changes = [...c.priceChanges].sort((a, b) => b.weeklyImpact - a.weeklyImpact || b.changePct - a.changePct);
  const rises = c.priceChanges.filter(p => p.changePct > 0).length;
  const compact = new Intl.NumberFormat('en-GB', { notation: 'compact', style: 'currency', currency: cur, maximumFractionDigits: 1 });
  const alerts = c.alerts.filter(a => a.severity !== 'info');

  return (
    <>
      <PageHeader
        eyebrow={c.period ? `${c.period.location} · ${c.period.days} days` : 'Sample period'} title="Overview"
        subtitle={c.period ? `${new Date(c.period.start).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })} to ${new Date(c.period.end).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}` : 'Illustrative figures only'}
      />

      <div className="brief">
        <Pill tone={onTarget ? 'pos' : 'warn'} dot>{onTarget ? 'Food cost on target' : 'Food cost above target'}</Pill>
        <p>
          Food cost is <b>{pct(k.food_cost_pct)}</b>, {gap.toFixed(1)} points {onTarget ? 'under' : 'over'} your {k.target_food_cost_pct}% target.
          {live && <> {rises} supplier {rises === 1 ? 'price has' : 'prices have'} risen, {declining.length} {declining.length === 1 ? 'dish is' : 'dishes are'} losing margin, and estimated profit leakage is <b>{money(c.leakage.total, cur)}</b> this period.</>}
        </p>
      </div>

      <section className="kpis" aria-label="Key financial indicators">
        <Kpi label="Revenue" value={money(k.revenue, cur)} foot={<><Delta value={k.changes.revenue} /> vs previous period</>} />
        <Kpi label="Gross profit" value={money(k.gross_profit, cur)} foot={<><Delta value={k.changes.gross_profit} /> vs previous period</>} />
        <Kpi label="Gross margin" value={pct(k.gross_margin_pct)} foot="Profit as a share of revenue" />
        <Kpi label="Food cost" value={pct(k.food_cost_pct)} foot={<>Ingredient spend {money(k.ingredient_expenditure, cur)} <Delta value={k.changes.ingredient_expenditure} goodWhen="down" /></>}>
          <div className="gauge" aria-label={`Food cost ${pct(k.food_cost_pct)} against a ${k.target_food_cost_pct}% target`}>
            <Bar value={k.food_cost_pct} max={Math.max(40, k.food_cost_pct * 1.1)} tone={onTarget ? 'sage' : 'warn'} />
            <span className="gauge-mark" style={{ left: `${(k.target_food_cost_pct / Math.max(40, k.food_cost_pct * 1.1)) * 100}%` }} title={`Target ${k.target_food_cost_pct}%`} />
          </div>
        </Kpi>
      </section>

      <div className="grid g-main">
        <Panel title="Revenue and ingredient spend" sub={live ? 'Weekly, all available weeks' : 'Offline sample, monthly'}>
          <div className="legend"><span><i style={{ background: COLORS.brand }} />Revenue</span><span><i style={{ background: COLORS.amber }} />Ingredient spend</span></div>
          <div className="chart">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={c.trend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={COLORS.grid} />
                <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: COLORS.tick }} interval="preserveStartEnd" minTickGap={24} />
                <YAxis axisLine={false} tickLine={false} width={56} tick={{ fontSize: 11, fill: COLORS.tick }} tickFormatter={v => compact.format(v)} />
                <Tooltip formatter={(v) => money(Number(v), cur)} contentStyle={{ border: `1px solid ${COLORS.grid}`, borderRadius: 6, boxShadow: 'none', fontSize: 12.5 }} cursor={{ stroke: COLORS.grid }} />
                <Area type="monotone" dataKey="revenue" name="Revenue" stroke={COLORS.brand} strokeWidth={2} fill={COLORS.brand} fillOpacity={0.07} isAnimationActive={false} />
                <Line type="monotone" dataKey="spend" name="Ingredient spend" stroke={COLORS.amber} strokeWidth={2} dot={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Recommended actions" sub={live ? 'From verified figures for this period' : 'Computed from the sample figures'}>
          {recs.loading ? <Skeleton rows={4} height={34} /> : recs.data?.length ? (
            <ol className="actions">
              {recs.data.slice(0, 4).map((r, i) => (
                <li key={i}>
                  <Pill tone="brand">{r.area}</Pill>
                  <p>{r.action}</p>
                  <small>{r.estimated_impact > 0 && <>≈ <b>{money(r.estimated_impact, cur)}</b> · </>}{r.basis}</small>
                </li>
              ))}
            </ol>
          ) : <EmptyState title="Nothing to act on">No supplier or menu issues were found for this period.</EmptyState>}
        </Panel>
      </div>

      <div className="grid g-even">
        <Panel title="Supplier price changes" sub="Largest cost impact first" actions={<button className="link" onClick={() => go('Supplier Intelligence')}>All supplier changes <ChevronRight size={14} /></button>} flush>
          {changes.length ? (
            <div className="scroll"><table className="tbl">
              <thead><tr><th>Ingredient</th><th className="r">Price</th><th className="r">Change</th><th className="r">Weekly cost</th><th>Affects</th></tr></thead>
              <tbody>
                {changes.slice(0, 5).map(p => (
                  <tr key={p.id}>
                    <td><b>{p.name}</b><small>{p.supplier}</small></td>
                    <td className="r num">{money(p.from, cur, 2)} → {money(p.to, cur, 2)}<small>per {p.unit}</small></td>
                    <td className="r"><span className={p.changePct > 0 ? 'neg-text' : 'pos-text'}>{signed(p.changePct)}</span></td>
                    <td className="r num">{p.weeklyImpact ? money(p.weeklyImpact, cur, 2) : '—'}</td>
                    <td className="muted">{p.affected.slice(0, 2).map(a => a.name).join(', ')}{p.affected.length > 2 && ` +${p.affected.length - 2}`}{!p.affected.length && '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          ) : <EmptyState title="No supplier price changes">Prices were stable in this period.</EmptyState>}
        </Panel>

        <Panel title="Declining profitability" sub={live ? 'Dishes whose margin fell over the period' : 'Dishes above the food-cost target'} actions={<button className="link" onClick={() => go('Menu Intelligence')}>Menu intelligence <ChevronRight size={14} /></button>} flush>
          {atRisk.length ? (
            <div className="scroll"><table className="tbl">
              <thead><tr><th>Dish</th><th className="r">Margin</th><th className="r">{live ? 'Change' : 'Food cost'}</th><th>Status</th></tr></thead>
              <tbody>
                {atRisk.slice(0, 5).map(d => (
                  <tr key={d.id}>
                    <td><b>{d.name}</b><small>{d.category}</small></td>
                    <td className="r num">{pct(d.marginPct)}</td>
                    <td className="r num">{live ? <span className="neg-text">{signed(d.marginChangePp, 1, ' pts')}</span> : pct(d.foodCostPct)}</td>
                    <td><StatusPill status={d.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          ) : <EmptyState title="No declining dishes">No dish lost margin in this period.</EmptyState>}
        </Panel>
      </div>

      <div className="grid g-even">
        <Panel title="Financial alerts" sub={live ? `Estimated leakage ${money(c.leakage.total, cur)} this period · about ${money(c.leakage.annualised, cur)} a year if unchanged` : 'Offline sample alerts'} actions={<button className="link" onClick={() => go('Profit Leakage')}>Profit leakage <ChevronRight size={14} /></button>}>
          {alerts.length ? (
            <ul className="alerts">
              {alerts.slice(0, 5).map(a => (
                <li key={a.id}>
                  <div><SeverityPill severity={a.severity} /></div>
                  <div><b>{a.title}</b><p>{a.message}</p>{a.impact != null && <small>Estimated impact {money(a.impact, cur, 2)} {a.impactBasis === 'week' ? 'a week' : 'this period'}</small>}</div>
                </li>
              ))}
            </ul>
          ) : <EmptyState title="No alerts">Nothing needs attention for this period.</EmptyState>}
        </Panel>

        <Panel title="Menu performance" sub={live ? 'By gross profit contributed this period' : 'By gross margin'} actions={<button className="link" onClick={() => go('Menu Intelligence')}>Full menu <ChevronRight size={14} /></button>}>
          <div className="duo">
            {([['Top performers', byContribution.slice(0, 3)], ['Lowest earners', byContribution.slice(-3).reverse()]] as const).map(([label, list]) => (
              <div key={label}>
                <div className="mini-h">{label}</div>
                {list.map(d => (
                  <div className="mini-r" key={d.id}><span>{d.name}</span><b className="num">{live ? money(d.gpContribution, cur) : pct(d.marginPct, 0)}</b></div>
                ))}
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </>
  );
}
