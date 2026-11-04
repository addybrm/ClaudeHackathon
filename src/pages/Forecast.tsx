import { useState } from 'react';
import { CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Plus, Trash2 } from 'lucide-react';
import { fmtDay, getForecast, getIngredients, simulate } from '../api';
import { useApp } from '../app-context';
import { COLORS } from '../derive';
import { useAsync } from '../hooks';
import { Banner, Delta, EmptyState, ErrorState, Field, PageHeader, Panel, Pill, Segmented, Skeleton, money, num, pct, signed } from '../ui';

export function ForecastPage() {
  const { live } = useApp();
  const [tab, setTab] = useState<'forecast' | 'sim'>('forecast');
  return (
    <>
      <PageHeader eyebrow="Plan" title="Forecasting" subtitle="Where costs and margins are heading, and what a decision would do. Projections are estimates, never actuals."
        actions={<Segmented label="Forecast view" value={tab} onChange={setTab} options={[{ value: 'forecast', label: 'Outlook' }, { value: 'sim', label: 'Scenario simulator' }]} />} />
      {!live ? <OfflineScenario /> : tab === 'forecast' ? <Outlook /> : <Simulator />}
    </>
  );
}

function Outlook() {
  const { core, params } = useApp();
  const cur = core.restaurant.currency;
  const [weeks, setWeeks] = useState<'4' | '8' | '12'>('4');
  const f = useAsync(() => getForecast(Number(weeks), params), [weeks, params.locationId]);
  if (f.loading && !f.data) return <Panel><Skeleton rows={6} height={22} /></Panel>;
  if (f.error) return <Panel><ErrorState message={f.error} onRetry={f.reload} /></Panel>;
  const F = f.data;
  if (!F) return null;
  const hist = F.history as any[], proj = F.projection as any[];
  const data: any[] = [...hist.map(h => ({ label: fmtDay(h.week_start), rev: h.revenue, spend: h.ingredient_expenditure })), ...proj.map(p => ({ label: fmtDay(p.week_start), revP: p.revenue, spendP: p.ingredient_expenditure }))];
  const last = hist.length - 1;
  if (last >= 0) { data[last].revP = hist[last].revenue; data[last].spendP = hist[last].ingredient_expenditure; }
  const end = proj[proj.length - 1];
  const compact = new Intl.NumberFormat('en-GB', { notation: 'compact', style: 'currency', currency: cur, maximumFractionDigits: 1 });
  return (
    <>
      <section className="kpis" aria-label="Projection summary">
        <div className="kpi"><div className="kpi-l">Projected weekly revenue</div><div className="kpi-v">{money(end?.revenue, cur)}</div><div className="kpi-f">Week of {end && fmtDay(end.week_start)} · <Pill tone="warn">Projection</Pill></div></div>
        <div className="kpi"><div className="kpi-l">Projected ingredient spend</div><div className="kpi-v">{money(end?.ingredient_expenditure, cur)}</div><div className="kpi-f">Per week</div></div>
        <div className="kpi"><div className="kpi-l">Projected food cost</div><div className="kpi-v">{pct(end?.food_cost_pct)}</div><div className="kpi-f">Target {core.kpis.target_food_cost_pct}%</div></div>
        <div className="kpi"><div className="kpi-l">Margin warnings</div><div className="kpi-v">{F.warnings.length}</div><div className="kpi-f">{F.warnings.length ? F.warnings.join(', ') : 'No dish at risk'}</div></div>
      </section>

      <Panel title="Weekly revenue and ingredient spend" sub="Solid lines are actuals; dashed lines are projected" actions={<Segmented label="Forecast horizon" value={weeks} onChange={setWeeks} options={[{ value: '4', label: '4 weeks' }, { value: '8', label: '8 weeks' }, { value: '12', label: '12 weeks' }]} />}>
        <div className="legend">
          <span><i style={{ background: COLORS.brand }} />Revenue</span><span><i style={{ background: COLORS.amber }} />Ingredient spend</span><span className="dash-key">- - - Projection</span>
        </div>
        <div className="chart">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={COLORS.grid} />
              <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: COLORS.tick }} interval="preserveStartEnd" minTickGap={24} />
              <YAxis axisLine={false} tickLine={false} width={56} tick={{ fontSize: 11, fill: COLORS.tick }} tickFormatter={v => compact.format(v)} />
              <Tooltip formatter={(v, n) => [money(Number(v), cur), String(n)]} contentStyle={{ border: `1px solid ${COLORS.grid}`, borderRadius: 6, boxShadow: 'none', fontSize: 12.5 }} />
              <Line dataKey="rev" name="Revenue" stroke={COLORS.brand} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
              <Line dataKey="revP" name="Revenue (projected)" stroke={COLORS.brand} strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} connectNulls />
              <Line dataKey="spend" name="Ingredient spend" stroke={COLORS.amber} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
              <Line dataKey="spendP" name="Spend (projected)" stroke={COLORS.amber} strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <p className="muted small">{F.method}</p>
      </Panel>

      <div className="grid g-even">
        <Panel title="Ingredient price outlook" sub={`Projected price in ${weeks} weeks if the recent trend continues`} flush>
          {F.ingredient_prices.length ? (
            <div className="scroll"><table className="tbl">
              <thead><tr><th>Ingredient</th><th className="r">Now</th><th className="r">Projected</th><th className="r">Change</th></tr></thead>
              <tbody>{F.ingredient_prices.slice(0, 8).map((p: any) => <tr key={p.ingredient_id}><td><b>{p.name}</b><small>per {p.unit}</small></td><td className="r num">{money(p.current_price, cur, 2)}</td><td className="r num strong">{money(p.projected_price, cur, 2)}</td><td className="r"><span className={p.projected_change_pct > 0 ? 'neg-text' : 'pos-text'}>{signed(p.projected_change_pct)}</span></td></tr>)}</tbody>
            </table></div>
          ) : <EmptyState title="No price trends" />}
        </Panel>
        <Panel title="Dish margin outlook" sub="Lowest projected margin first" flush>
          <div className="scroll"><table className="tbl">
            <thead><tr><th>Dish</th><th className="r">Now</th><th className="r">Projected</th><th>Outlook</th></tr></thead>
            <tbody>{F.dishes.slice(0, 8).map((d: any) => (
              <tr key={d.dish_id}><td><b>{d.name}</b></td><td className="r num">{pct(d.current_gross_margin_pct)}</td><td className="r num strong">{pct(d.projected_gross_margin_pct)}</td>
                <td>{d.margin_warning ? <Pill tone="warn" dot>Margin warning</Pill> : <Pill tone="pos" dot>Stable</Pill>}</td></tr>
            ))}</tbody>
          </table></div>
        </Panel>
      </div>
    </>
  );
}

type Row = { a: string; b: string };
function Simulator() {
  const { core, params } = useApp();
  const cur = core.restaurant.currency;
  const ing = useAsync(() => getIngredients(), []);
  const [ingRows, setIngRows] = useState<Row[]>([{ a: '', b: '' }]);
  const [priceRows, setPriceRows] = useState<Row[]>([{ a: '', b: '' }]);
  const [volRows, setVolRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false), [err, setErr] = useState(''), [res, setRes] = useState<any>(null);

  const upd = (set: React.Dispatch<React.SetStateAction<Row[]>>, i: number, patch: Partial<Row>) => set(r => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const used = (rows: Row[]) => rows.filter(r => r.a || r.b);

  const run = async () => {
    const body: any = { ingredient_price_changes_pct: {}, menu_prices: {}, volume_changes_pct: {}, basis_weeks: 4, location_id: params.locationId };
    const problems: string[] = [];
    used(ingRows).forEach(r => { const v = Number(r.b); if (!r.a || r.b === '' || !(v >= -90 && v <= 500)) problems.push('Ingredient changes need an ingredient and a percentage between −90 and 500.'); else body.ingredient_price_changes_pct[r.a] = v; });
    used(priceRows).forEach(r => { const v = Number(r.b); if (!r.a || !(v > 0 && v <= 1000)) problems.push('Menu prices need a dish and a price between 0 and 1,000.'); else body.menu_prices[r.a] = v; });
    used(volRows).forEach(r => { const v = Number(r.b); if (!r.a || r.b === '' || !(v >= -90 && v <= 500)) problems.push('Volume changes need a dish and a percentage between −90 and 500.'); else body.volume_changes_pct[r.a] = v; });
    if (!Object.keys({ ...body.ingredient_price_changes_pct, ...body.menu_prices, ...body.volume_changes_pct }).length) problems.push('Add at least one adjustment to simulate.');
    if (problems.length) { setErr([...new Set(problems)].join(' ')); return; }
    setBusy(true); setErr('');
    try { setRes(await simulate(body)); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const reset = () => { setIngRows([{ a: '', b: '' }]); setPriceRows([{ a: '', b: '' }]); setVolRows([]); setRes(null); setErr(''); };
  const dishSelect = (v: string, on: (x: string) => void, label: string) => (
    <select className="input" aria-label={label} value={v} onChange={e => on(e.target.value)}><option value="">Choose dish…</option>{core.dishes.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
  );
  const metric = (l: string, a: number, b: number, kind: 'money' | 'pct', better: 'up' | 'down') => (
    <tr key={l}><td>{l}</td><td className="r num">{kind === 'money' ? money(a, cur) : pct(a)}</td><td className="r num strong">{kind === 'money' ? money(b, cur) : pct(b)}</td><td className="r"><Delta value={kind === 'money' ? (a ? ((b - a) / a) * 100 : null) : b - a} suffix={kind === 'money' ? '%' : ' pts'} goodWhen={better} /></td></tr>
  );

  return (
    <div className="grid g-sim">
      <Panel title="Build a scenario" sub="Combine any adjustments. Results use average weekly sales from the last 4 weeks.">
        <div className="stack">
          <div>
            <div className="mini-h">Ingredient price change (%)</div>
            {ingRows.map((r, i) => (
              <div className="rline two" key={i}>
                <select className="input" aria-label={`Ingredient ${i + 1}`} value={r.a} onChange={e => upd(setIngRows, i, { a: e.target.value })}><option value="">Choose ingredient…</option>{(ing.data ?? []).map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
                <span className="qty"><input className="input" inputMode="decimal" aria-label={`Ingredient change ${i + 1}`} placeholder="+10" value={r.b} onChange={e => upd(setIngRows, i, { b: e.target.value })} /><em>%</em></span>
                <button className="icon-btn sm" aria-label="Remove ingredient change" onClick={() => setIngRows(x => (x.length > 1 ? x.filter((_, j) => j !== i) : [{ a: '', b: '' }]))}><Trash2 size={14} /></button>
              </div>
            ))}
            <button className="btn sm" onClick={() => setIngRows(r => [...r, { a: '', b: '' }])}><Plus size={13} aria-hidden /> Add ingredient</button>
          </div>
          <div>
            <div className="mini-h">New menu price ({cur})</div>
            {priceRows.map((r, i) => (
              <div className="rline two" key={i}>
                {dishSelect(r.a, v => upd(setPriceRows, i, { a: v }), `Dish ${i + 1}`)}
                <span className="qty"><input className="input" inputMode="decimal" aria-label={`New price ${i + 1}`} placeholder={core.dishes.find(d => d.id === r.a)?.price.toFixed(2) ?? '0.00'} value={r.b} onChange={e => upd(setPriceRows, i, { b: e.target.value })} /><em>{cur === 'GBP' ? '£' : cur}</em></span>
                <button className="icon-btn sm" aria-label="Remove price change" onClick={() => setPriceRows(x => (x.length > 1 ? x.filter((_, j) => j !== i) : [{ a: '', b: '' }]))}><Trash2 size={14} /></button>
              </div>
            ))}
            <button className="btn sm" onClick={() => setPriceRows(r => [...r, { a: '', b: '' }])}><Plus size={13} aria-hidden /> Add dish</button>
          </div>
          <div>
            <div className="mini-h">Sales volume change (%)</div>
            {volRows.map((r, i) => (
              <div className="rline two" key={i}>
                {dishSelect(r.a, v => upd(setVolRows, i, { a: v }), `Volume dish ${i + 1}`)}
                <span className="qty"><input className="input" inputMode="decimal" aria-label={`Volume change ${i + 1}`} placeholder="-5" value={r.b} onChange={e => upd(setVolRows, i, { b: e.target.value })} /><em>%</em></span>
                <button className="icon-btn sm" aria-label="Remove volume change" onClick={() => setVolRows(x => x.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
              </div>
            ))}
            <button className="btn sm" onClick={() => setVolRows(r => [...r, { a: '', b: '' }])}><Plus size={13} aria-hidden /> Add volume change</button>
          </div>
          {err && <div className="form-error" role="alert">{err}</div>}
          <div className="row gap"><button className="btn primary" disabled={busy} onClick={run}>{busy ? 'Calculating…' : 'Run scenario'}</button><button className="btn" onClick={reset}>Reset</button></div>
        </div>
      </Panel>

      <div className="stack">
        {res ? (
          <>
            <Panel title="Scenario result" sub={<>{res.basis} <Pill tone="warn">Projection</Pill></>} flush>
              <table className="tbl">
                <thead><tr><th /><th className="r">Now</th><th className="r">Scenario</th><th className="r">Change</th></tr></thead>
                <tbody>
                  {metric('Weekly revenue', res.baseline.weekly_revenue, res.scenario.weekly_revenue, 'money', 'up')}
                  {metric('Weekly ingredient cost', res.baseline.weekly_ingredient_cost, res.scenario.weekly_ingredient_cost, 'money', 'down')}
                  {metric('Weekly gross profit', res.baseline.weekly_gross_profit, res.scenario.weekly_gross_profit, 'money', 'up')}
                  {metric('Gross margin', res.baseline.gross_margin_pct, res.scenario.gross_margin_pct, 'pct', 'up')}
                  {metric('Food cost', res.baseline.food_cost_pct, res.scenario.food_cost_pct, 'pct', 'down')}
                </tbody>
              </table>
              <div className="verdict"><b>{res.weekly_gross_profit_change >= 0 ? 'Gain' : 'Loss'} of {money(Math.abs(res.weekly_gross_profit_change), cur)} a week</b><span className="muted">about {money(Math.abs(res.annualised_gross_profit_change), cur)} a year</span></div>
            </Panel>
            <Panel title="Impact by dish" sub="Largest loss first" flush>
              <div className="scroll"><table className="tbl compact">
                <thead><tr><th>Dish</th><th className="r">Margin now</th><th className="r">Margin scenario</th><th className="r">Weekly profit</th></tr></thead>
                <tbody>{res.dishes.filter((d: any) => d.weekly_gross_profit_change !== 0).map((d: any) => (
                  <tr key={d.dish_id}><td>{d.name}</td><td className="r num">{pct(d.baseline.gross_margin_pct)}</td><td className="r num">{pct(d.scenario.gross_margin_pct)}</td><td className="r num strong"><span className={d.weekly_gross_profit_change < 0 ? 'neg-text' : 'pos-text'}>{signed(d.weekly_gross_profit_change, 2, '')}</span></td></tr>
                ))}</tbody>
              </table></div>
            </Panel>
          </>
        ) : <Panel><EmptyState title="No scenario yet">Add one or more adjustments and run the scenario to compare it with today's figures.</EmptyState></Panel>}
      </div>
    </div>
  );
}

/** Offline: the original single-dish what-if, calculated in the browser. */
function OfflineScenario() {
  const { core } = useApp();
  const cur = core.restaurant.currency;
  const [id, setId] = useState(core.dishes[0]?.id ?? '');
  const [priceChange, setPriceChange] = useState(0), [costChange, setCostChange] = useState(0);
  const d = core.dishes.find(x => x.id === id) ?? core.dishes[0];
  if (!d) return <EmptyState title="No dishes" />;
  const price = d.price * (1 + priceChange / 100), cost = d.cost * (1 + costChange / 100);
  const projected = ((price - cost) / price) * 100, delta = Math.round((projected - d.marginPct) * 10) / 10;
  return (
    <>
      <Banner tone="info">Offline: a single-dish what-if calculated in your browser. Connect the backend for portfolio-wide scenarios and forecasts.</Banner>
      <div className="grid g-even">
        <Panel title="Build a scenario">
          <div className="stack">
            <Field label="Menu item"><select className="input" value={d.id} onChange={e => setId(e.target.value)}>{core.dishes.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
            <Field label={`Selling price change: ${signed(priceChange, 0)}`}><input type="range" min={-20} max={25} value={priceChange} onChange={e => setPriceChange(Number(e.target.value))} /></Field>
            <Field label={`Ingredient cost change: ${signed(costChange, 0)}`}><input type="range" min={-30} max={40} value={costChange} onChange={e => setCostChange(Number(e.target.value))} /></Field>
            <button className="btn" onClick={() => { setPriceChange(0); setCostChange(0); }}>Reset</button>
          </div>
        </Panel>
        <Panel title="Projected result" sub={<Pill tone="warn">Estimate</Pill>}>
          <div className="verdict"><b>{d.name}</b></div>
          <table className="tbl"><tbody>
            <tr><td>Gross margin now</td><td className="r num">{pct(d.marginPct)}</td></tr>
            <tr><td>Projected gross margin</td><td className="r num strong">{pct(projected)}</td></tr>
            <tr><td>Change</td><td className="r num">{signed(delta, 1, ' pts')}</td></tr>
            <tr><td>Price → cost per plate</td><td className="r num">{money(price, cur, 2)} → {money(cost, cur, 2)}</td></tr>
          </tbody></table>
          <p className="muted small">Cost per plate now {money(d.cost, cur, 2)} · {num(d.foodCostPct)}% food cost.</p>
        </Panel>
      </div>
    </>
  );
}
