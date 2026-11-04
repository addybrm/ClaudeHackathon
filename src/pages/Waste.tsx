import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { getIngredients, getWaste, postWaste } from '../api';
import { useApp } from '../app-context';
import { useAsync } from '../hooks';
import { Bar, Banner, Delta, EmptyState, ErrorState, Field, PageHeader, Panel, Skeleton, money, pct } from '../ui';

const REASONS: [string, string][] = [['expired', 'Expired'], ['spoiled', 'Spoiled'], ['overproduction', 'Overproduction'], ['prep_error', 'Preparation error'], ['returned', 'Returned'], ['other', 'Other']];
const reasonLabel = (r: string) => REASONS.find(x => x[0] === r)?.[1] ?? r;
const UNITS: Record<string, string[]> = { kg: ['kg', 'g'], l: ['l', 'ml'], each: ['each'], portion: ['portion'] };
const today = () => new Date().toISOString().slice(0, 10);

export function WastePage() {
  const { core, live, params, can, refresh } = useApp();
  const cur = core.restaurant.currency;
  const canWrite = can('waste:write');
  const waste = useAsync(() => (live ? getWaste(params) : null), [live, params.start, params.end, params.locationId]);
  const S = waste.data?.summary;

  return (
    <>
      <PageHeader eyebrow="Analyse" title="Food Waste" subtitle="Record what is thrown away and see what it costs, so the biggest causes can be fixed." />
      {live ? (
        waste.loading && !waste.data ? <Panel><Skeleton rows={6} height={22} /></Panel> : waste.error ? <Panel><ErrorState message={waste.error} onRetry={waste.reload} /></Panel> : S && (
          <>
            <section className="kpis" aria-label="Waste summary">
              <div className="kpi"><div className="kpi-l">Waste cost</div><div className="kpi-v">{money(S.total_cost, cur, 2)}</div><div className="kpi-f"><Delta value={S.change_pct} goodWhen="down" /> vs previous period</div></div>
              <div className="kpi"><div className="kpi-l">Share of revenue</div><div className="kpi-v">{pct(S.waste_pct_of_revenue, 2)}</div><div className="kpi-f">Recorded waste only</div></div>
              <div className="kpi"><div className="kpi-l">Records</div><div className="kpi-v">{S.record_count}</div><div className="kpi-f">In this period</div></div>
              <div className="kpi"><div className="kpi-l">Top cause</div><div className="kpi-v sm">{S.by_reason[0] ? reasonLabel(S.by_reason[0].reason) : '—'}</div><div className="kpi-f">{S.by_reason[0] ? money(S.by_reason[0].cost, cur, 2) : 'No waste recorded'}</div></div>
            </section>
            <div className="grid g-side">
              <div className="stack">
                <Panel title="Most wasted ingredients" sub="By cost, with a suggested action" flush>
                  {S.top_ingredients.length ? (
                    <div className="scroll"><table className="tbl">
                      <thead><tr><th>Ingredient</th><th className="r">Quantity</th><th className="r">Cost</th><th>Suggestion</th></tr></thead>
                      <tbody>{S.top_ingredients.map((t: any) => <tr key={t.ingredient_id}><td><b>{t.name}</b><small>{t.records} records</small></td><td className="r num">{t.quantity} {t.unit}</td><td className="r num strong">{money(t.cost, cur, 2)}</td><td className="wide-cell muted">{t.suggestion}</td></tr>)}</tbody>
                    </table></div>
                  ) : <EmptyState title="No waste recorded">Nothing was logged in this period.</EmptyState>}
                </Panel>
                <Panel title="Records" sub={`${waste.data?.records.length ?? 0} in this period. Newest first.`} flush>
                  {waste.data?.records.length ? (
                    <div className="scroll tall-scroll"><table className="tbl compact">
                      <thead><tr><th>Date</th><th>Ingredient</th><th className="r">Quantity</th><th>Reason</th><th className="r">Cost</th></tr></thead>
                      <tbody>{waste.data.records.map((r: any) => <tr key={r.id}><td className="num muted">{r.date}</td><td>{r.ingredient}</td><td className="r num">{r.quantity} {r.unit}</td><td>{reasonLabel(r.reason)}</td><td className="r num strong">{money(r.cost, cur, 2)}</td></tr>)}</tbody>
                    </table></div>
                  ) : <EmptyState title="No records in this period" />}
                </Panel>
              </div>
              <div className="stack">
                <WasteForm canWrite={canWrite} onSaved={() => { waste.reload(); refresh(); }} />
                <Panel title="By reason" sub="Share of waste cost">
                  {S.by_reason.length ? (
                    <ul className="bars">{S.by_reason.map((r: any) => <li key={r.reason}><span>{reasonLabel(r.reason)}</span><Bar value={r.cost} max={S.total_cost} tone="brand" /><b className="num">{money(r.cost, cur, 2)}</b></li>)}</ul>
                  ) : <p className="muted">No data.</p>}
                </Panel>
              </div>
            </div>
          </>
        )
      ) : <OfflineWaste cur={cur} />}
    </>
  );
}

function WasteForm({ canWrite, onSaved }: { canWrite: boolean; onSaved: () => void }) {
  const { core, params, locations } = useApp();
  const ing = useAsync(() => getIngredients(), []);
  const [ingredient, setIngredient] = useState(''), [qty, setQty] = useState(''), [unit, setUnit] = useState(''), [reason, setReason] = useState('');
  const [date, setDate] = useState(() => (core.period?.end && core.period.end < today() ? core.period.end : today()));
  const [loc, setLoc] = useState<number>(params.locationId ?? locations[0]?.id ?? 1);
  const [busy, setBusy] = useState(false), [err, setErr] = useState('');
  const info = useMemo(() => ing.data?.find(i => i.id === ingredient), [ing.data, ingredient]);
  const units = info ? UNITS[info.unit] ?? [info.unit] : [];
  const est = info && Number(qty) > 0 ? Number(qty) * info.current_price * ((unit === 'g' || unit === 'ml') ? 0.001 : 1) : null;

  const submit = async () => {
    if (!ingredient) return setErr('Choose an ingredient.');
    if (!(Number(qty) > 0)) return setErr('Quantity must be above zero.');
    if (!reason) return setErr('Choose a reason.');
    if (date > today()) return setErr('The date cannot be in the future.');
    setBusy(true); setErr('');
    try {
      const r = await postWaste({ ingredient_id: ingredient, quantity: Number(qty), unit: unit || info?.unit, reason, recorded_on: date, location_id: params.locationId ?? loc });
      toast.success(`Waste recorded: ${money(r.estimated_cost, core.restaurant.currency, 2)}`, { description: `${r.quantity} ${r.unit} of ${r.ingredient} on ${r.date}` });
      setQty(''); setReason(''); onSaved();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Panel title="Log waste" sub={canWrite ? 'Saved to the restaurant record' : 'Your role cannot record waste'}>
      <fieldset className="stack" disabled={!canWrite || busy}>
        <Field label="Ingredient">
          <select className="input" value={ingredient} onChange={e => { setIngredient(e.target.value); setUnit(''); }}>
            <option value="">Choose ingredient…</option>{(ing.data ?? []).map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        </Field>
        <div className="form-row two">
          <Field label="Quantity"><input className="input" inputMode="decimal" value={qty} onChange={e => setQty(e.target.value)} placeholder="0" /></Field>
          <Field label="Unit"><select className="input" value={unit || info?.unit || ''} onChange={e => setUnit(e.target.value)} disabled={!info}>{units.length ? units.map(u => <option key={u}>{u}</option>) : <option>—</option>}</select></Field>
        </div>
        <Field label="Reason"><select className="input" value={reason} onChange={e => setReason(e.target.value)}><option value="">Choose reason…</option>{REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
        <div className="form-row two">
          <Field label="Date" hint="Records outside the selected period do not appear above"><input className="input" type="date" max={today()} value={date} onChange={e => setDate(e.target.value)} /></Field>
          {!params.locationId && locations.length > 1 && <Field label="Location"><select className="input" value={loc} onChange={e => setLoc(Number(e.target.value))}>{locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></Field>}
        </div>
        {est != null && <p className="muted">Estimated cost at today's price: <b className="num">{money(est, core.restaurant.currency, 2)}</b></p>}
        {err && <div className="form-error" role="alert">{err}</div>}
        <button className="btn primary" onClick={submit}><Plus size={15} aria-hidden /> {busy ? 'Saving…' : 'Record waste'}</button>
      </fieldset>
    </Panel>
  );
}

type Local = { id: number; ingredient: string; quantity: number; cost: number; reason: string; date: string };
function OfflineWaste({ cur }: { cur: string }) {
  const [rows, setRows] = useState<Local[]>([]);
  const [ingredient, setIngredient] = useState(''), [qty, setQty] = useState(''), [unitCost, setUnitCost] = useState(''), [reason, setReason] = useState('');
  const add = () => {
    const q = Number(qty), c = Number(unitCost);
    if (!ingredient.trim() || !(q > 0) || !(c >= 0) || unitCost === '' || !reason) { toast.error('Complete ingredient, quantity, unit cost and reason'); return; }
    setRows(r => [{ id: Date.now(), ingredient: ingredient.trim(), quantity: q, cost: q * c, reason, date: new Date().toLocaleDateString('en-GB') }, ...r]);
    setIngredient(''); setQty(''); setUnitCost(''); setReason('');
    toast.success('Waste added to this session only');
  };
  const total = rows.reduce((s, r) => s + r.cost, 0);
  return (
    <>
      <Banner tone="info">Offline: waste entries are kept in this browser session only. Connect the backend to save them to the restaurant record.</Banner>
      <div className="grid g-side">
        <Panel title="Session log" sub={`${rows.length} entries · ${money(total, cur, 2)}`} flush>
          {rows.length ? (
            <table className="tbl"><thead><tr><th>Date</th><th>Ingredient</th><th>Reason</th><th className="r">Cost</th><th aria-label="Remove" /></tr></thead>
              <tbody>{rows.map(r => <tr key={r.id}><td className="num muted">{r.date}</td><td>{r.ingredient}<small>{r.quantity} units</small></td><td>{r.reason}</td><td className="r num strong">{money(r.cost, cur, 2)}</td><td className="r"><button className="icon-btn sm" aria-label={`Remove ${r.ingredient}`} onClick={() => setRows(x => x.filter(a => a.id !== r.id))}><Trash2 size={14} /></button></td></tr>)}</tbody></table>
          ) : <EmptyState title="No entries yet">Add your first entry to see a cost total.</EmptyState>}
        </Panel>
        <Panel title="Log waste" sub="Session only">
          <div className="stack">
            <Field label="Ingredient"><input className="input" value={ingredient} onChange={e => setIngredient(e.target.value)} placeholder="e.g. Tomatoes" /></Field>
            <div className="form-row two">
              <Field label="Quantity"><input className="input" inputMode="decimal" value={qty} onChange={e => setQty(e.target.value)} placeholder="0" /></Field>
              <Field label="Unit cost"><input className="input" inputMode="decimal" value={unitCost} onChange={e => setUnitCost(e.target.value)} placeholder="0.00" /></Field>
            </div>
            <Field label="Reason"><select className="input" value={reason} onChange={e => setReason(e.target.value)}><option value="">Choose reason…</option>{REASONS.map(([v, l]) => <option key={v} value={l}>{l}</option>)}</select></Field>
            <button className="btn primary" onClick={add}><Plus size={15} aria-hidden /> Record waste</button>
          </div>
        </Panel>
      </div>
    </>
  );
}
