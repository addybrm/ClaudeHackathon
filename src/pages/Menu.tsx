import { Fragment, useMemo, useState } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChevronDown, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { archiveDish, getIngredients, saveDish, type Dish, type Status } from '../api';
import { useApp } from '../app-context';
import { COLORS } from '../derive';
import { useAsync } from '../hooks';
import { Bar, Banner, CLASS_HINT, CLASS_LABEL, EmptyState, Field, Modal, PageHeader, Panel, Pill, Segmented, StatusPill, Th, cx, money, num, pct, signed } from '../ui';

type Sort = { key: string; dir: 1 | -1 };
const VALUE: Record<string, (d: Dish) => number | string> = {
  rank: d => d.rank, name: d => d.name.toLowerCase(), price: d => d.price, cost: d => d.cost, grossProfit: d => d.grossProfit,
  marginPct: d => d.marginPct, foodCostPct: d => d.foodCostPct, marginChangePp: d => d.marginChangePp ?? 0, units: d => d.units,
};
const CATEGORIES = ['Starters', 'Mains', 'Sides', 'Desserts', 'Drinks'];

export function MenuPage() {
  const { core, live, can, refresh } = useApp();
  const cur = core.restaurant.currency;
  const [filter, setFilter] = useState<'all' | Status>('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<Sort>({ key: 'rank', dir: 1 });
  const [open, setOpen] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ dish?: Dish } | null>(null);
  const [archiving, setArchiving] = useState<Dish | null>(null);
  const canEdit = can('menu:write');

  const rows = useMemo(() => {
    const f = core.dishes.filter(d => (filter === 'all' || d.status === filter) && d.name.toLowerCase().includes(search.trim().toLowerCase()));
    const v = VALUE[sort.key] ?? VALUE.rank;
    return [...f].sort((a, b) => (v(a) > v(b) ? 1 : v(a) < v(b) ? -1 : 0) * sort.dir);
  }, [core.dishes, filter, search, sort]);
  const onSort = (key: string) => setSort(s => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: key === 'name' || key === 'rank' ? 1 : -1 }));
  const th = { sort, onSort };

  const revenue = core.dishes.reduce((s, d) => s + d.revenue, 0);
  const gp = core.dishes.reduce((s, d) => s + d.gpContribution, 0);
  const blended = live && revenue > 0 ? (gp / revenue) * 100 : core.dishes.reduce((s, d) => s + d.marginPct, 0) / Math.max(core.dishes.length, 1);
  const attention = core.dishes.filter(d => d.status !== 'healthy').length;

  const doArchive = async () => {
    if (!archiving) return;
    try { await archiveDish(archiving.id); toast.success(`${archiving.name} archived`, { description: 'Sales history is kept.' }); setArchiving(null); setOpen(null); refresh(); }
    catch (e: any) { toast.error('Could not archive dish', { description: e.message }); }
  };
  return (
    <>
      <PageHeader eyebrow="Analyse" title="Menu Intelligence" subtitle="What every plate really earns. Expand a dish for its recipe cost breakdown."
        actions={<button className="btn primary" disabled={!canEdit} title={canEdit ? undefined : 'Your role cannot edit the menu'} onClick={() => setEditor({})}><Plus size={15} aria-hidden /> Add menu item</button>} />
      {!live && <Banner tone="info">Recipe editing is saved to the backend. Offline, new items are added to this browser session only.</Banner>}

      <section className="kpis k3" aria-label="Menu summary">
        <div className="kpi"><div className="kpi-l">Menu items</div><div className="kpi-v">{core.dishes.length}</div></div>
        <div className="kpi"><div className="kpi-l">{live ? 'Blended gross margin' : 'Average gross margin'}</div><div className="kpi-v">{pct(blended)}</div><div className="kpi-f">{live ? 'Weighted by sales' : 'Simple average'}</div></div>
        <div className="kpi"><div className="kpi-l">Needs attention</div><div className="kpi-v">{attention}</div><div className="kpi-f">Food cost above the {core.kpis.target_food_cost_pct}% target</div></div>
      </section>

      <Panel flush>
        <div className="toolbar">
          <Segmented label="Filter by status" value={filter} onChange={setFilter} options={[{ value: 'all', label: 'All' }, { value: 'healthy', label: 'Healthy' }, { value: 'watch', label: 'Watch' }, { value: 'critical', label: 'Critical' }]} />
          <label className="search"><Search size={14} aria-hidden /><input aria-label="Search menu" placeholder="Search dishes" value={search} onChange={e => setSearch(e.target.value)} /></label>
        </div>
        {rows.length ? (
          <div className="scroll">
            <table className="tbl hover">
              <thead>
                <tr>
                  <Th sortKey="rank" {...th}>#</Th><Th sortKey="name" {...th}>Dish</Th><Th sortKey="price" align="right" {...th}>Price</Th><Th sortKey="cost" align="right" {...th}>Cost</Th>
                  <Th sortKey="grossProfit" align="right" {...th}>Profit / plate</Th><Th sortKey="marginPct" {...th}>Gross margin</Th><Th sortKey="foodCostPct" align="right" {...th}>Food cost</Th>
                  {live && <Th sortKey="marginChangePp" align="right" {...th}>Margin Δ</Th>}{live && <Th sortKey="units" align="right" {...th}>Sold</Th>}<th>Status</th><th aria-label="Expand" />
                </tr>
              </thead>
              <tbody>
                {rows.map(d => (
                  <Fragment key={d.id}>
                    <tr className={cx('click', open === d.id && 'is-open')} onClick={() => setOpen(open === d.id ? null : d.id)}>
                      <td className="muted num">{d.rank || '—'}</td>
                      <td><b>{d.name}</b><small>{d.category}{d.menuClass && ` · ${CLASS_LABEL[d.menuClass]}`}</small></td>
                      <td className="r num">{money(d.price, cur, 2)}</td><td className="r num">{money(d.cost, cur, 2)}</td>
                      <td className="r num strong">{money(d.grossProfit, cur, 2)}</td>
                      <td><span className="mrg"><b className="num">{pct(d.marginPct)}</b><Bar value={d.marginPct} tone={d.status === 'healthy' ? 'sage' : d.status === 'watch' ? 'warn' : 'neg'} /></span></td>
                      <td className="r num">{pct(d.foodCostPct)}</td>
                      {live && <td className="r num"><span className={d.marginChangePp != null && d.marginChangePp < -0.05 ? 'neg-text' : 'muted'}>{signed(d.marginChangePp, 1, ' pts')}</span></td>}
                      {live && <td className="r num">{d.units.toLocaleString('en-GB')}</td>}
                      <td><StatusPill status={d.status} /></td>
                      <td className="r"><button className="icon-btn sm" aria-label={`${open === d.id ? 'Collapse' : 'Expand'} ${d.name}`} aria-expanded={open === d.id}><ChevronDown size={15} className={open === d.id ? 'flip' : ''} /></button></td>
                    </tr>
                    {open === d.id && (
                      <tr className="expand"><td colSpan={live ? 11 : 9}><DishDetail dish={d} cur={cur} live={live} canEdit={canEdit} onEdit={() => setEditor({ dish: d })} onArchive={() => setArchiving(d)} /></td></tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyState title="No dishes match" action={<button className="btn sm" onClick={() => { setFilter('all'); setSearch(''); }}>Clear filters</button>}>Try a different status or search term.</EmptyState>}
        <div className="tbl-foot">Showing {rows.length} of {core.dishes.length} dishes{live && ` · ${core.period?.days} day period`}</div>
      </Panel>

      {editor && <DishEditor dish={editor.dish} onClose={() => setEditor(null)} />}
      {archiving && (
        <Modal title="Archive this dish?" onClose={() => setArchiving(null)}
          footer={<><button className="btn" onClick={() => setArchiving(null)}>Cancel</button><button className="btn danger" onClick={doArchive}>Archive dish</button></>}>
          <p><b>{archiving.name}</b> will be removed from the active menu and from profitability analysis. Its sales history is kept.</p>
        </Modal>
      )}
    </>
  );
}

function DishDetail({ dish: d, cur, live, canEdit, onEdit, onArchive }: { dish: Dish; cur: string; live: boolean; canEdit: boolean; onEdit: () => void; onArchive: () => void }) {
  const total = d.ingredients.reduce((s, i) => s + i.lineCost, 0) || d.cost;
  return (
    <div className="detail">
      <div>
        <div className="mini-h">Recipe cost breakdown</div>
        {d.ingredients.length ? (
          <table className="tbl compact">
            <thead><tr><th>Ingredient</th><th className="r">Quantity</th><th className="r">Unit cost</th><th className="r">Cost</th><th>Share</th><th className="r">Price change</th></tr></thead>
            <tbody>
              {[...d.ingredients].sort((a, b) => b.lineCost - a.lineCost).map(i => (
                <tr key={i.id}>
                  <td>{i.name}</td><td className="r num">{i.quantity} {i.unit}</td><td className="r num">{money(i.unitCost, cur, 2)}</td><td className="r num strong">{money(i.lineCost, cur, 2)}</td>
                  <td><span className="mrg"><span className="num muted">{pct((i.lineCost / total) * 100, 0)}</span><Bar value={i.lineCost} max={total} tone="brand" /></span></td>
                  <td className="r num"><span className={i.changePct != null && i.changePct > 0.05 ? 'neg-text' : 'muted'}>{signed(i.changePct)}</span></td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={3}>Total ingredient cost</td><td className="r num strong">{money(d.cost, cur, 2)}</td><td colSpan={2} /></tr></tfoot>
          </table>
        ) : <p className="muted">{live ? 'No recipe lines recorded for this dish.' : 'Recipe detail is not part of the offline sample.'}</p>}
      </div>
      <div className="detail-side">
        {d.costTrend.length > 1 && (
          <div>
            <div className="mini-h">Ingredient cost per plate</div>
            <div className="spark">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={d.costTrend} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke={COLORS.grid} />
                  <XAxis dataKey="week" hide /><YAxis hide domain={['dataMin - 0.2', 'dataMax + 0.2']} />
                  <Tooltip formatter={(v) => money(Number(v), cur, 2)} contentStyle={{ border: `1px solid ${COLORS.grid}`, borderRadius: 6, boxShadow: 'none', fontSize: 12 }} />
                  <Line dataKey="cost" name="Cost" stroke={COLORS.brand} strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <small className="muted">{signed(d.costChangePct)} over the period</small>
          </div>
        )}
        <dl className="facts">
          <div><dt>Price for {d.foodCostPct > 30 ? 'a 30%' : 'the'} food-cost target</dt><dd className="num">{money(d.suggestedPrice, cur, 2)}</dd></div>
          {d.markupPct != null && <div><dt>Markup (profit ÷ cost)</dt><dd className="num">{pct(d.markupPct, 0)}</dd></div>}
          {d.menuClass && <div><dt>Menu class</dt><dd><Pill tone={d.menuClass === 'star' ? 'pos' : d.menuClass === 'dog' ? 'neg' : 'warn'}>{CLASS_LABEL[d.menuClass]}</Pill><small>{CLASS_HINT[d.menuClass]}</small></dd></div>}
        </dl>
        {live && (
          <div className="row gap">
            <button className="btn sm" disabled={!canEdit} onClick={onEdit}><Pencil size={13} aria-hidden /> Edit recipe</button>
            <button className="btn sm danger-ghost" disabled={!canEdit} onClick={onArchive}><Trash2 size={13} aria-hidden /> Archive</button>
          </div>
        )}
      </div>
    </div>
  );
}

type Line = { ing: string; qty: string };

function DishEditor({ dish, onClose }: { dish?: Dish; onClose: () => void }) {
  const { live, core, refresh, addLocalDish } = useApp();
  const cur = core.restaurant.currency;
  const ing = useAsync(() => (live ? getIngredients() : null), [live]);
  const [name, setName] = useState(dish?.name ?? ''), [category, setCategory] = useState(dish?.category ?? 'Mains'), [price, setPrice] = useState(dish ? String(dish.price) : '');
  const [lines, setLines] = useState<Line[]>(dish?.ingredients.length ? dish.ingredients.map(i => ({ ing: i.id, qty: String(i.quantity) })) : [{ ing: '', qty: '' }]);
  const [offlineCost, setOfflineCost] = useState('');
  const [busy, setBusy] = useState(false), [errs, setErrs] = useState<string[]>([]);
  const byId = useMemo(() => new Map((ing.data ?? []).map(i => [i.id, i])), [ing.data]);

  const p = Number(price);
  const cost = live ? lines.reduce((s, l) => s + (Number(l.qty) || 0) * (byId.get(l.ing)?.current_price ?? 0), 0) : Number(offlineCost);
  const showPreview = p > 0 && cost >= 0 && (live ? lines.some(l => l.ing && Number(l.qty) > 0) : offlineCost !== '');

  const validate = () => {
    const e: string[] = [];
    if (name.trim().length < 2) e.push('Enter a dish name (at least 2 characters).');
    if (!(p > 0) || p > 1000) e.push('Selling price must be between 0 and 1,000.');
    if (live) {
      const used = lines.filter(l => l.ing || l.qty);
      if (!used.length) e.push('Add at least one ingredient.');
      used.forEach((l, i) => { if (!l.ing) e.push(`Line ${i + 1}: choose an ingredient.`); if (!(Number(l.qty) > 0)) e.push(`Line ${i + 1}: quantity must be above zero.`); });
      const ids = used.map(l => l.ing).filter(Boolean);
      if (new Set(ids).size !== ids.length) e.push('Each ingredient can appear only once.');
    } else if (!(Number(offlineCost) >= 0) || offlineCost === '') e.push('Enter the ingredient cost per plate.');
    return e;
  };

  const submit = async () => {
    const e = validate();
    setErrs(e);
    if (e.length) return;
    setBusy(true);
    try {
      if (!live) {
        const c = Number(offlineCost), gpv = p - c, fc = (c / p) * 100;
        addLocalDish({ id: `local_${Date.now()}`, name: name.trim(), category, price: p, cost: c, grossProfit: gpv, marginPct: (gpv / p) * 100, foodCostPct: fc, markupPct: c > 0 ? (gpv / c) * 100 : null, units: 0, revenue: 0, gpContribution: 0, rank: 0, marginChangePp: null, costChangePct: null, suggestedPrice: c / 0.3, status: fc <= 30 ? 'healthy' : fc <= 35 ? 'watch' : 'critical', menuClass: null, ingredients: [], costTrend: [] });
        toast.success(`${name.trim()} added to this session`);
      } else {
        await saveDish({ name: name.trim(), category, selling_price: p, recipe: lines.filter(l => l.ing).map(l => ({ ingredient_id: l.ing, quantity: Number(l.qty) })) }, dish?.id);
        toast.success(dish ? `${name.trim()} updated` : `${name.trim()} added to the menu`);
        refresh();
      }
      onClose();
    } catch (x: any) { setErrs([x.message, ...(x.errors ?? [])]); }
    finally { setBusy(false); }
  };

  const set = (i: number, patch: Partial<Line>) => setLines(ls => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <Modal wide title={dish ? `Edit ${dish.name}` : 'Add menu item'} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || (live && ing.loading)} onClick={submit}>{busy ? 'Saving…' : dish ? 'Save changes' : 'Add to menu'}</button></>}>
      <div className="stack">
        <div className="form-row">
          <Field label="Dish name"><input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Beer-battered haddock" autoFocus /></Field>
          <Field label="Category"><input className="input" list="dish-cats" value={category} onChange={e => setCategory(e.target.value)} /><datalist id="dish-cats">{CATEGORIES.map(c => <option key={c} value={c} />)}</datalist></Field>
          <Field label={`Selling price (${cur})`}><input className="input" inputMode="decimal" value={price} onChange={e => setPrice(e.target.value)} placeholder="0.00" /></Field>
        </div>
        {live ? (
          <div>
            <div className="mini-h">Recipe: quantities in each ingredient's own unit</div>
            {ing.error && <p className="err-text">Could not load ingredients: {ing.error}</p>}
            {lines.map((l, i) => {
              const info = byId.get(l.ing);
              return (
                <div className="rline" key={i}>
                  <select className="input" aria-label={`Ingredient ${i + 1}`} value={l.ing} onChange={e => set(i, { ing: e.target.value })}>
                    <option value="">Choose ingredient…</option>
                    {(ing.data ?? []).map(o => <option key={o.id} value={o.id}>{o.name} ({money(o.current_price, cur, 2)}/{o.unit})</option>)}
                  </select>
                  <span className="qty"><input className="input" inputMode="decimal" aria-label={`Quantity ${i + 1}`} value={l.qty} onChange={e => set(i, { qty: e.target.value })} placeholder="0" /><em>{info?.unit ?? ''}</em></span>
                  <span className="num muted r">{info ? money((Number(l.qty) || 0) * info.current_price, cur, 2) : ''}</span>
                  <button className="icon-btn sm" aria-label={`Remove line ${i + 1}`} onClick={() => setLines(ls => (ls.length > 1 ? ls.filter((_, j) => j !== i) : [{ ing: '', qty: '' }]))}><Trash2 size={14} /></button>
                </div>
              );
            })}
            <button className="btn sm" onClick={() => setLines(ls => [...ls, { ing: '', qty: '' }])}><Plus size={13} aria-hidden /> Add ingredient</button>
          </div>
        ) : <Field label={`Ingredient cost per plate (${cur})`}><input className="input" inputMode="decimal" value={offlineCost} onChange={e => setOfflineCost(e.target.value)} placeholder="0.00" /></Field>}
        {showPreview && (
          <div className="preview">
            <span>Ingredient cost <b className="num">{money(cost, cur, 2)}</b></span><span>Gross profit <b className="num">{money(p - cost, cur, 2)}</b></span>
            <span>Gross margin <b className="num">{pct(((p - cost) / p) * 100)}</b></span><span>Food cost <b className="num">{pct((cost / p) * 100)}</b></span>
            <span>Price for 30% food cost <b className="num">{money(cost / 0.3, cur, 2)}</b></span>
          </div>
        )}
        {errs.length > 0 && <ul className="form-errors" role="alert">{errs.map((e, i) => <li key={i}>{e}</li>)}</ul>}
      </div>
    </Modal>
  );
}
