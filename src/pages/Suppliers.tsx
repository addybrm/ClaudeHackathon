import { Fragment, useState } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChevronDown } from 'lucide-react';
import { fmtDay, getComparison, getPriceHistory, getSuppliers, type PriceChange } from '../api';
import { useApp } from '../app-context';
import { COLORS } from '../derive';
import { useAsync } from '../hooks';
import { Bar, EmptyState, ErrorState, PageHeader, Panel, Pill, Skeleton, cx, money, pct, signed } from '../ui';

export function SupplierPage() {
  const { core, live, params } = useApp();
  const cur = core.restaurant.currency;
  const [open, setOpen] = useState<string | null>(null);
  const key = [live, params.start, params.end, params.locationId];
  const comparison = useAsync(() => (live ? getComparison(params) : null), key);
  const suppliers = useAsync(() => (live ? getSuppliers(params) : null), key);

  const changes = [...core.priceChanges].sort((a, b) => b.weeklyImpact - a.weeklyImpact || b.changePct - a.changePct);
  const rises = changes.filter(c => c.changePct > 0);
  const weekly = rises.reduce((s, c) => s + c.weeklyImpact, 0);
  const savings = (comparison.data?.comparisons ?? []).reduce((s: number, c: any) => s + c.potential_saving_in_period, 0);

  return (
    <>
      <PageHeader eyebrow="Analyse" title="Supplier Intelligence" subtitle="Which prices moved, what it costs you, and where you could pay less." />
      <section className="kpis" aria-label="Supplier summary">
        <div className="kpi"><div className="kpi-l">Price movements</div><div className="kpi-v">{changes.length}</div><div className="kpi-f">{rises.length} increases</div></div>
        <div className="kpi"><div className="kpi-l">Largest increase</div><div className="kpi-v">{rises.length ? signed(Math.max(...rises.map(r => r.changePct))) : '—'}</div><div className="kpi-f">{rises.length ? [...rises].sort((a, b) => b.changePct - a.changePct)[0].name : 'No increases'}</div></div>
        <div className="kpi"><div className="kpi-l">Extra cost per week</div><div className="kpi-v">{live ? money(weekly, cur) : '—'}</div><div className="kpi-f">From increases, at current sales</div></div>
        <div className="kpi"><div className="kpi-l">Possible saving</div><div className="kpi-v">{live && comparison.data ? money(savings, cur) : '—'}</div><div className="kpi-f">By switching to quoted prices</div></div>
      </section>

      <Panel title="Price changes" sub="Price at the start of the period compared with the latest price paid. Expand a row for history and dish impact." flush>
        {changes.length ? (
          <div className="scroll"><table className="tbl hover">
            <thead><tr><th>Ingredient</th><th className="r">Was</th><th className="r">Now</th><th className="r">Change</th><th className="r">Extra cost / week</th><th>Dishes affected</th><th aria-label="Expand" /></tr></thead>
            <tbody>
              {changes.map(p => (
                <Fragment key={p.id}>
                  <tr className={cx('click', open === p.id && 'is-open')} onClick={() => setOpen(open === p.id ? null : p.id)}>
                    <td><b>{p.name}</b><small>{p.supplier} · per {p.unit}</small></td>
                    <td className="r num">{money(p.from, cur, 2)}</td><td className="r num strong">{money(p.to, cur, 2)}</td>
                    <td className="r"><Pill tone={p.changePct > 0 ? 'neg' : 'pos'}>{signed(p.changePct)}</Pill></td>
                    <td className="r num">{p.weeklyImpact ? money(p.weeklyImpact, cur, 2) : '—'}</td>
                    <td className="muted">{p.affected.length ? `${p.affected.length} ${p.affected.length === 1 ? 'dish' : 'dishes'}` : '—'}</td>
                    <td className="r"><button className="icon-btn sm" aria-label={`${open === p.id ? 'Collapse' : 'Expand'} ${p.name}`} aria-expanded={open === p.id}><ChevronDown size={15} className={open === p.id ? 'flip' : ''} /></button></td>
                  </tr>
                  {open === p.id && <tr className="expand"><td colSpan={7}><ChangeDetail change={p} cur={cur} live={live} /></td></tr>}
                </Fragment>
              ))}
            </tbody>
          </table></div>
        ) : <EmptyState title="No price changes">Prices were stable in this period. Upload a supplier invoice to track new movements.</EmptyState>}
      </Panel>

      {live && (
        <>
          <Panel title="Supplier comparison" sub="Latest price from each supplier, including quotes. Quotes are not prices you have paid." flush>
            {comparison.loading && !comparison.data ? <div className="pad"><Skeleton rows={4} /></div> : comparison.error ? <ErrorState message={comparison.error} onRetry={comparison.reload} /> :
              comparison.data?.comparisons?.length ? (
                <div className="scroll"><table className="tbl">
                  <thead><tr><th>Ingredient</th><th>Current supplier</th><th>Offers (lowest first)</th><th className="r">Possible saving</th></tr></thead>
                  <tbody>
                    {comparison.data.comparisons.map((c: any) => (
                      <tr key={c.ingredient_id}>
                        <td><b>{c.name}</b><small>per {c.unit} · bought {c.quantity_purchased_in_period} {c.unit}</small></td>
                        <td>{c.current_supplier}<small className="num">{money(c.current_price, cur, 2)}</small></td>
                        <td>
                          <ul className="offers">
                            {c.offers.map((o: any) => (
                              <li key={o.supplier} className={o.supplier === c.cheapest_supplier ? 'best' : ''}>
                                <span>{o.supplier}</span><b className="num">{money(o.unit_price, cur, 2)}</b><Pill tone={o.source === 'quote' ? 'warn' : 'neu'}>{o.source === 'quote' ? 'Quote' : 'Paid'}</Pill>
                              </li>
                            ))}
                          </ul>
                        </td>
                        <td className="r num strong">{c.potential_saving_in_period > 0 ? money(c.potential_saving_in_period, cur, 2) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
              ) : <EmptyState title="No comparable offers">Add quotes or invoices from a second supplier to compare.</EmptyState>}
          </Panel>

          <Panel title="Suppliers" sub="Spend with each supplier this period" flush>
            {suppliers.loading && !suppliers.data ? <div className="pad"><Skeleton rows={4} /></div> : suppliers.error ? <ErrorState message={suppliers.error} onRetry={suppliers.reload} /> : (
              <div className="scroll"><table className="tbl">
                <thead><tr><th>Supplier</th><th>Category</th><th className="r">Invoices</th><th className="r">Spend</th><th>Share of spend</th></tr></thead>
                <tbody>
                  {(suppliers.data?.suppliers ?? []).filter((s: any) => s.spend_in_period > 0 || s.is_current_supplier).sort((a: any, b: any) => b.spend_in_period - a.spend_in_period).map((s: any) => (
                    <tr key={s.id}>
                      <td><b>{s.name}</b><small>{s.ingredients_supplied.slice(0, 3).join(', ')}{s.ingredients_supplied.length > 3 && ` +${s.ingredients_supplied.length - 3}`}</small></td>
                      <td className="muted">{s.category}</td><td className="r num">{s.invoices_in_period}</td><td className="r num strong">{money(s.spend_in_period, cur)}</td>
                      <td><span className="mrg"><span className="num muted">{pct(s.share_of_spend_pct, 0)}</span><Bar value={s.share_of_spend_pct} tone="brand" /></span></td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}
          </Panel>
        </>
      )}
    </>
  );
}

function ChangeDetail({ change: p, cur, live }: { change: PriceChange; cur: string; live: boolean }) {
  const hist = useAsync(() => (live ? getPriceHistory(p.id) : null), [live, p.id]);
  const points: { label: string; date: string; paid?: number; quote?: number }[] = [];
  (hist.data?.history ?? []).forEach((h: any) => points.push({ date: h.date, label: fmtDay(h.date), paid: h.unit_price }));
  (hist.data?.quotes ?? []).forEach((q: any) => points.push({ date: q.date, label: fmtDay(q.date), quote: q.unit_price }));
  points.sort((a, b) => a.date.localeCompare(b.date));
  const totalWeekly = p.affected.reduce((s, a) => s + a.weeklyImpact, 0);
  return (
    <div className="detail">
      <div>
        <div className="mini-h">Price history ({cur} per {p.unit})</div>
        {!live ? <p className="muted">Price history needs the live backend.</p> : hist.loading ? <Skeleton rows={3} height={26} /> : hist.error ? <ErrorState message={hist.error} onRetry={hist.reload} /> : (
          <div className="spark tall">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={COLORS.grid} />
                <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: COLORS.tick }} minTickGap={20} />
                <YAxis axisLine={false} tickLine={false} width={44} tick={{ fontSize: 11, fill: COLORS.tick }} domain={['auto', 'auto']} tickFormatter={v => money(v, cur, 2)} />
                <Tooltip formatter={(v) => money(Number(v), cur, 2)} contentStyle={{ border: `1px solid ${COLORS.grid}`, borderRadius: 6, boxShadow: 'none', fontSize: 12 }} />
                <Line type="stepAfter" dataKey="paid" name="Paid" stroke={COLORS.brand} strokeWidth={2} dot={{ r: 3 }} connectNulls isAnimationActive={false} />
                <Line dataKey="quote" name="Quote" stroke={COLORS.amber} strokeWidth={0} dot={{ r: 5, fill: COLORS.amber }} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
      <div>
        <div className="mini-h">Impact on dishes</div>
        {p.affected.length ? (
          <table className="tbl compact">
            <thead><tr><th>Dish</th><th className="r">Extra / plate</th><th className="r">Per week</th></tr></thead>
            <tbody>{p.affected.map(a => <tr key={a.dishId}><td>{a.name}</td><td className="r num">{money(a.perPortion, cur, 2)}</td><td className="r num strong">{money(a.weeklyImpact, cur, 2)}</td></tr>)}</tbody>
            <tfoot><tr><td colSpan={2}>Total</td><td className="r num strong">{money(totalWeekly, cur, 2)}</td></tr></tfoot>
          </table>
        ) : <p className="muted">No current dish uses this ingredient, or the dish impact is not available.</p>}
      </div>
    </div>
  );
}
