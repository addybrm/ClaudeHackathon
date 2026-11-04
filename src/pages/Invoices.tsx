import { useCallback, useMemo, useState } from 'react';
import { useDropzone, type FileRejection } from 'react-dropzone';
import { Check, FileText, Plus, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { confirmInvoice, getIngredients, getSuppliers, listInvoices, uploadInvoice } from '../api';
import { useApp } from '../app-context';
import { useAsync } from '../hooks';
import { Banner, EmptyState, Field, PageHeader, Panel, Pill, Skeleton, money, signed } from '../ui';

const UNITS: Record<string, string[]> = { kg: ['kg', 'g'], l: ['l', 'ml'], each: ['each'], portion: ['portion'] };
const FACTOR: Record<string, number> = { g: 0.001, ml: 0.001 };
const METHOD: Record<string, { label: string; source: string }> = {
  csv: { label: 'Read from CSV', source: 'csv' }, pdf_text: { label: 'Read from PDF text', source: 'pdf' },
  claude_vision: { label: 'Read by Claude: check every line', source: 'image' }, manual_required: { label: 'Manual entry', source: 'image' }, manual: { label: 'Manual entry', source: 'manual' },
};
const today = () => new Date().toISOString().slice(0, 10);

type Ln = { key: number; ing: string; qty: string; unit: string; price: string; desc?: string };
type Draft = { filename: string; method: string; notice: string | null; supplierId: string; supplierName: string; date: string; number: string; lines: Ln[]; locationId: string };
let seq = 0;
const blank = (): Ln => ({ key: ++seq, ing: '', qty: '', unit: '', price: '' });

export function InvoicePage() {
  const { core, live, params, can, locations, refresh, go } = useApp();
  const cur = core.restaurant.currency;
  const canWrite = can('invoice:write');
  const ing = useAsync(() => (live ? getIngredients() : null), [live]);
  const sup = useAsync(() => (live ? getSuppliers({}) : null), [live]);
  const hist = useAsync(() => (live ? listInvoices() : null), [live]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saved, setSaved] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [serverErrors, setServerErrors] = useState<string[]>([]);
  const [offline, setOffline] = useState<{ name: string; lines: { name: string; price: number; qty: number }[] }[]>([]);
  const byId = useMemo(() => new Map((ing.data ?? []).map(i => [i.id, i])), [ing.data]);

  const startDraft = (d: Partial<Draft>) => { setSaved(null); setServerErrors([]); setDraft({ filename: 'Manual entry', method: 'manual', notice: null, supplierId: '', supplierName: '', date: today(), number: '', lines: [blank()], locationId: String(params.locationId ?? locations[0]?.id ?? 1), ...d }); };

  const onFile = useCallback(async (file: File) => {
    if (!live) {
      if (/\.csv$/i.test(file.name)) {
        const rows = (await file.text()).trim().split(/\r?\n/), head = (rows.shift() ?? '').split(',').map(x => x.trim().toLowerCase());
        const [i, p, q] = [head.indexOf('ingredient'), head.indexOf('unit_price'), head.indexOf('quantity')];
        const lines = rows.map(r => r.split(',').map(x => x.trim())).filter(c => i >= 0 && p >= 0 && q >= 0 && c.length > Math.max(i, p, q)).map(c => ({ name: c[i], price: Number(c[p]), qty: Number(c[q]) })).filter(l => l.name && Number.isFinite(l.price) && Number.isFinite(l.qty));
        setOffline(o => [{ name: file.name, lines }, ...o]);
        toast.info('CSV previewed offline', { description: `${lines.length} lines read. Nothing is saved without the backend.` });
      } else toast.error('Invoice reading needs the backend', { description: 'Connect the API to extract PDF or image invoices.' });
      return;
    }
    setBusy(true); setSaved(null);
    try {
      const d = await uploadInvoice(file);
      startDraft({
        filename: d.filename ?? file.name, method: d.extraction_method, notice: d.notice ?? null, supplierId: d.supplier_id ? String(d.supplier_id) : '', supplierName: d.supplier_name ?? '',
        date: d.invoice_date ?? '', number: d.invoice_number ?? '',
        lines: d.lines.length ? d.lines.map((l: any): Ln => ({ key: ++seq, ing: l.ingredient_id ?? '', qty: l.quantity != null ? String(l.quantity) : '', unit: l.unit ?? '', price: l.unit_price != null ? String(l.unit_price) : '', desc: l.description })) : [blank()],
      });
      toast.success('Invoice read: please review it', { description: `${d.lines.length} lines found. Nothing is saved yet.` });
    } catch (e: any) { toast.error('Could not read this invoice', { description: e.message }); } finally { setBusy(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, params.locationId, locations]);

  const onRejected = (r: FileRejection[]) => toast.error('File not accepted', { description: r[0]?.errors[0]?.code === 'file-too-large' ? 'Files must be under 5 MB.' : 'Upload a CSV, PDF, PNG, JPG or WebP file under 5 MB.' });
  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop: (f: File[]) => { if (f[0]) void onFile(f[0]); }, onDropRejected: onRejected, noClick: true, multiple: false, maxSize: 5 * 1024 * 1024, disabled: !canWrite || busy,
    accept: { 'application/pdf': ['.pdf'], 'text/csv': ['.csv'], 'image/png': ['.png'], 'image/jpeg': ['.jpg', '.jpeg'], 'image/webp': ['.webp'] },
  });

  // ---- validation (mirrors the server so most problems are caught before saving)
  const issues = useMemo(() => {
    if (!draft) return { header: [] as string[], lines: [] as string[][] };
    const header: string[] = [];
    if (!draft.supplierId && !draft.supplierName.trim()) header.push('Choose a supplier or enter a new supplier name.');
    if (!draft.date) header.push('Enter the invoice date.');
    else if (draft.date > today()) header.push('The invoice date cannot be in the future.');
    else if (draft.date < new Date(Date.now() - 730 * 864e5).toISOString().slice(0, 10)) header.push('The invoice date is more than two years old.');
    const lines = draft.lines.map(l => {
      const e: string[] = [], info = byId.get(l.ing), p = Number(l.price), q = Number(l.qty);
      if (!l.ing) e.push('Choose an ingredient.');
      if (!(q > 0)) e.push('Quantity must be above zero.');
      if (!(p > 0)) e.push('Unit price must be above zero.');
      if (p >= 10000) e.push('Unit price looks too high.');
      if (info && l.unit && !(UNITS[info.unit] ?? [info.unit]).includes(l.unit)) e.push(`Unit must be ${(UNITS[info.unit] ?? [info.unit]).join(' or ')}.`);
      return e;
    });
    if (!draft.lines.length) header.push('Add at least one line.');
    return { header, lines };
  }, [draft, byId]);
  const valid = !!draft && issues.header.length === 0 && issues.lines.every(l => l.length === 0) && draft.lines.length > 0;
  const total = draft?.lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.price) || 0), 0) ?? 0;

  const setLine = (key: number, patch: Partial<Ln>) => setDraft(d => d && { ...d, lines: d.lines.map(l => (l.key === key ? { ...l, ...patch } : l)) });

  const confirm = async () => {
    if (!draft || !valid) return;
    setBusy(true); setServerErrors([]);
    try {
      const r = await confirmInvoice({
        supplier_id: draft.supplierId ? Number(draft.supplierId) : undefined, supplier_name: draft.supplierId ? undefined : draft.supplierName.trim(),
        location_id: Number(draft.locationId), invoice_number: draft.number.trim() || undefined, invoice_date: draft.date, source: METHOD[draft.method]?.source ?? 'manual',
        lines: draft.lines.map(l => ({ ingredient_id: l.ing, quantity: Number(l.qty), unit: l.unit || byId.get(l.ing)?.unit, unit_price: Number(l.price), description: l.desc })),
      });
      setSaved(r); setDraft(null); refresh(); hist.reload(); sup.reload();
      toast.success('Invoice saved', { description: `${r.supplier}: ${money(r.total, cur, 2)}. Price history updated.` });
    } catch (e: any) { setServerErrors([e.message, ...(e.errors ?? [])]); toast.error('Invoice not saved', { description: 'Please correct the problems shown.' }); } finally { setBusy(false); }
  };

  return (
    <>
      <PageHeader eyebrow="Assist" title="Invoices" subtitle="Upload a supplier invoice, check what was read, correct anything wrong, then confirm. Nothing is saved until you confirm."
        actions={<><button className="btn" disabled={!live || !canWrite || busy} onClick={() => startDraft({})}><Plus size={14} aria-hidden /> Enter manually</button><button className="btn primary" disabled={!canWrite || busy} onClick={open}><Upload size={14} aria-hidden /> Upload invoice</button></>} />
      {!canWrite && <Banner tone="info">Your role cannot upload or confirm invoices. Owners, managers and finance administrators can.</Banner>}
      {!live && <Banner tone="info">Offline: CSV files can be previewed, but invoices are only read, checked and saved with the backend connected.</Banner>}

      {saved && (
        <Panel title="Invoice saved" actions={<button className="btn sm" onClick={() => setSaved(null)}>Done</button>}>
          <div className="saved">
            <span className="tick"><Check size={18} aria-hidden /></span>
            <div>
              <b>{saved.supplier} · {saved.invoice_number ?? 'no number'}</b>
              <p>{saved.lines.length} lines · {money(saved.total, cur, 2)} · dated {saved.invoice_date}. Price history is updated.</p>
              {saved.price_increase_alerts.length > 0 ? (
                <div className="banner warn"><div><b>{saved.price_increase_alerts.length} price {saved.price_increase_alerts.length === 1 ? 'increase' : 'increases'} detected:</b> {saved.price_increase_alerts.map((a: any) => `${a.name} ${signed(a.change_pct)} (${money(a.previous_price, cur, 2)} → ${money(a.unit_price, cur, 2)})`).join('; ')}.</div><button className="btn sm" onClick={() => go('Supplier Intelligence')}>View supplier changes</button></div>
              ) : <p className="muted">No unusual price increases.</p>}
            </div>
          </div>
        </Panel>
      )}

      {!draft && (
        <div {...getRootProps({ className: `drop${isDragActive ? ' over' : ''}${busy ? ' busy' : ''}` })}>
          <input {...getInputProps()} aria-label="Upload invoice file" />
          <span className="drop-icon"><Upload size={20} aria-hidden /></span>
          <b>{busy ? 'Reading invoice…' : isDragActive ? 'Drop the invoice to read it' : 'Drop an invoice here'}</b>
          <p>or <button type="button" className="link" onClick={open} disabled={!canWrite || busy}>browse files</button></p>
          <small>CSV · text PDF · PNG, JPG or WebP (read by Claude when connected) · up to 5 MB</small>
        </div>
      )}

      {draft && (
        <Panel title="Review invoice" sub={<><FileText size={13} aria-hidden /> {draft.filename} · <Pill tone={draft.method === 'claude_vision' ? 'warn' : 'neu'}>{METHOD[draft.method]?.label ?? draft.method}</Pill></>}
          actions={<button className="btn sm" disabled={busy} onClick={() => { setDraft(null); setServerErrors([]); }}>Discard draft</button>}>
          {draft.notice && <Banner tone="info">{draft.notice}</Banner>}
          <div className="form-row four">
            <Field label="Supplier">
              <select className="input" value={draft.supplierId || (draft.supplierName ? '__new' : '')} onChange={e => setDraft(d => d && (e.target.value === '__new' ? { ...d, supplierId: '' } : { ...d, supplierId: e.target.value, supplierName: '' }))}>
                <option value="">Choose supplier…</option>
                {(sup.data?.suppliers ?? []).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
                <option value="__new">New supplier…</option>
              </select>
            </Field>
            {!draft.supplierId && <Field label="New supplier name"><input className="input" value={draft.supplierName} onChange={e => setDraft(d => d && { ...d, supplierName: e.target.value })} placeholder="Supplier name" /></Field>}
            <Field label="Invoice date"><input className="input" type="date" max={today()} value={draft.date} onChange={e => setDraft(d => d && { ...d, date: e.target.value })} /></Field>
            <Field label="Invoice number" hint="Optional. Used to prevent duplicates"><input className="input" value={draft.number} onChange={e => setDraft(d => d && { ...d, number: e.target.value })} /></Field>
            {!params.locationId && locations.length > 1 && <Field label="Location"><select className="input" value={draft.locationId} onChange={e => setDraft(d => d && { ...d, locationId: e.target.value })}>{locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></Field>}
          </div>

          {ing.loading && !ing.data ? <Skeleton rows={4} height={30} /> : (
            <div className="scroll"><table className="tbl lines">
              <thead><tr><th>Ingredient</th><th className="r">Quantity</th><th>Unit</th><th className="r">Unit price</th><th className="r">Line total</th><th>vs current price</th><th aria-label="Remove" /></tr></thead>
              <tbody>
                {draft.lines.map((l, idx) => {
                  const info = byId.get(l.ing), p = Number(l.price), q = Number(l.qty), unit = l.unit || info?.unit || '';
                  const perUnit = p > 0 ? p / (FACTOR[unit] ?? 1) : 0;
                  const change = info && perUnit > 0 && info.current_price > 0 ? ((perUnit - info.current_price) / info.current_price) * 100 : null;
                  const errs = issues.lines[idx] ?? [];
                  return (
                    <tr key={l.key} className={errs.length ? 'has-issue' : ''}>
                      <td>
                        <select className="input" aria-label={`Ingredient, line ${idx + 1}`} value={l.ing} onChange={e => setLine(l.key, { ing: e.target.value, unit: '' })}>
                          <option value="">Choose ingredient…</option>{(ing.data ?? []).map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                        </select>
                        {l.desc && l.desc !== info?.name && <small className="muted">Invoice says: “{l.desc}”</small>}
                        {errs.length > 0 && <small className="err-text">{errs.join(' ')}</small>}
                      </td>
                      <td className="r"><input className="input r" inputMode="decimal" aria-label={`Quantity, line ${idx + 1}`} value={l.qty} onChange={e => setLine(l.key, { qty: e.target.value })} /></td>
                      <td><select className="input" aria-label={`Unit, line ${idx + 1}`} value={unit} onChange={e => setLine(l.key, { unit: e.target.value })} disabled={!info}>{info ? (UNITS[info.unit] ?? [info.unit]).map(u => <option key={u}>{u}</option>) : <option value="">—</option>}</select></td>
                      <td className="r"><input className="input r" inputMode="decimal" aria-label={`Unit price, line ${idx + 1}`} value={l.price} onChange={e => setLine(l.key, { price: e.target.value })} /></td>
                      <td className="r num strong">{p > 0 && q > 0 ? money(p * q, cur, 2) : '—'}</td>
                      <td>{change == null ? <span className="muted">—</span> : <Pill tone={change >= 5 ? 'neg' : change <= -5 ? 'pos' : 'neu'}>{signed(change)}</Pill>}{info && <small className="muted num">now {money(info.current_price, cur, 2)}/{info.unit}</small>}</td>
                      <td className="r"><button className="icon-btn sm" aria-label={`Remove line ${idx + 1}`} onClick={() => setDraft(d => d && { ...d, lines: d.lines.filter(x => x.key !== l.key) })}><Trash2 size={14} /></button></td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot><tr><td colSpan={4}><button className="btn sm" onClick={() => setDraft(d => d && { ...d, lines: [...d.lines, blank()] })}><Plus size={13} aria-hidden /> Add line</button></td><td className="r num strong">{money(total, cur, 2)}</td><td colSpan={2} /></tr></tfoot>
            </table></div>
          )}

          {issues.header.length > 0 && <ul className="form-errors">{issues.header.map((h, i) => <li key={i}>{h}</li>)}</ul>}
          {serverErrors.length > 0 && <ul className="form-errors" role="alert">{serverErrors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
          <div className="confirm-bar">
            <span className="muted">{valid ? 'Everything looks valid. Confirming saves the invoice and updates price history.' : 'Fix the highlighted items to enable confirmation.'}</span>
            <button className="btn primary" disabled={!valid || busy} onClick={confirm}><Check size={14} aria-hidden /> {busy ? 'Saving…' : `Confirm and save · ${money(total, cur, 2)}`}</button>
          </div>
        </Panel>
      )}

      {!live && offline.map((o, i) => (
        <Panel key={i} title={o.name} sub="Offline preview, not saved" flush>
          <table className="tbl"><thead><tr><th>Ingredient</th><th className="r">Quantity</th><th className="r">Unit price</th></tr></thead>
            <tbody>{o.lines.map((l, j) => <tr key={j}><td>{l.name}</td><td className="r num">{l.qty}</td><td className="r num">{money(l.price, cur, 2)}</td></tr>)}</tbody></table>
        </Panel>
      ))}

      {live && (
        <Panel title="Recent invoices" sub="Most recent first" flush>
          {hist.loading && !hist.data ? <div className="pad"><Skeleton rows={4} /></div> : hist.data?.invoices.length ? (
            <div className="scroll"><table className="tbl compact">
              <thead><tr><th>Date</th><th>Invoice</th><th>Supplier</th><th>Source</th><th className="r">Lines</th><th className="r">Total</th></tr></thead>
              <tbody>{hist.data.invoices.map((i: any) => <tr key={i.id}><td className="num muted">{i.invoice_date}</td><td>{i.invoice_number ?? '—'}</td><td>{i.supplier}</td><td><Pill tone="neu">{i.source}</Pill></td><td className="r num">{i.line_count}</td><td className="r num strong">{money(i.total, cur, 2)}</td></tr>)}</tbody>
            </table></div>
          ) : <EmptyState title="No invoices yet">Upload your first supplier invoice to start tracking prices.</EmptyState>}
        </Panel>
      )}
    </>
  );
}
