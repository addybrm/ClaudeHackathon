import { useState, type FormEvent } from 'react';
import { Activity, Bell, Calendar, Check, ChevronDown, CircleHelp, FileText, LayoutDashboard, LineChart, LogOut, MapPin, Menu as MenuIcon, Package, Recycle, Settings, Sparkles, Upload, UtensilsCrossed, X } from 'lucide-react';
import { toast } from 'sonner';
import { ROLE_LABEL, login as apiLogin, type Core, type User } from './api';
import { useApp, type Page } from './app-context';
import { useDismiss } from './hooks';
import { Logo } from './Logo';
import { Field, Modal, Pill, cx } from './ui';

export const NAV: { group: string; items: { page: Page; icon: typeof LayoutDashboard }[] }[] = [
  { group: 'Monitor', items: [{ page: 'Overview', icon: LayoutDashboard }] },
  { group: 'Analyse', items: [{ page: 'Menu Intelligence', icon: UtensilsCrossed }, { page: 'Supplier Intelligence', icon: Package }, { page: 'Profit Leakage', icon: Activity }, { page: 'Food Waste', icon: Recycle }] },
  { group: 'Plan', items: [{ page: 'Forecasting', icon: LineChart }, { page: 'Reports', icon: FileText }] },
  { group: 'Assist', items: [{ page: 'AI Business Advisor', icon: Sparkles }, { page: 'Invoices', icon: Upload }] },
];
export const ALL_PAGES: Page[] = [...NAV.flatMap(g => g.items.map(i => i.page)), 'Settings'];

// ------------------------------------------------------------------ period
export type Preset = '4w' | '8w' | 'all' | 'custom';
export type Range = { preset: Preset; start?: string; end?: string };
export const PRESET_LABEL: Record<Preset, string> = { '4w': 'Last 4 weeks', '8w': 'Last 8 weeks', all: 'All available data', custom: 'Custom range' };
/** Pages whose data follows the selected period. */
export const PERIOD_PAGES: Page[] = ['Overview', 'Menu Intelligence', 'Supplier Intelligence', 'Profit Leakage', 'Food Waste', 'Reports', 'AI Business Advisor'];

const fmt = (iso?: string) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

function PeriodPicker({ range, setRange, core }: { range: Range; setRange: (r: Range) => void; core: Core }) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState({ start: range.start ?? '', end: range.end ?? '' });
  const ref = useDismiss<HTMLDivElement>(open, () => setOpen(false));
  const avail = core.period?.data_available;
  if (!core.live || !core.period) return <span className="chip muted"><Calendar size={14} aria-hidden /> Sample period</span>;
  const customOk = custom.start && custom.end && custom.start <= custom.end && (!avail || (custom.start >= avail.start && custom.end <= avail.end));
  return (
    <div className="pop-wrap" ref={ref}>
      <button className="chip" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <Calendar size={14} aria-hidden /><span>{fmt(core.period.start)} – {fmt(core.period.end)}</span><ChevronDown size={14} aria-hidden />
      </button>
      {open && (
        <div className="pop right" role="dialog" aria-label="Choose reporting period">
          <div className="pop-title">Reporting period</div>
          {(['4w', '8w', 'all'] as Preset[]).map(p => (
            <button key={p} className={cx('pop-item', range.preset === p && 'on')} onClick={() => { setRange({ preset: p }); setOpen(false); }}>
              {PRESET_LABEL[p]}{range.preset === p && <Check size={14} aria-hidden />}
            </button>
          ))}
          <div className="pop-sep" />
          <div className="pop-title">Custom range</div>
          <div className="pop-dates">
            <input type="date" aria-label="Start date" value={custom.start} min={avail?.start} max={avail?.end} onChange={e => setCustom(c => ({ ...c, start: e.target.value }))} />
            <input type="date" aria-label="End date" value={custom.end} min={avail?.start} max={avail?.end} onChange={e => setCustom(c => ({ ...c, end: e.target.value }))} />
          </div>
          <button className="btn sm primary" disabled={!customOk} onClick={() => { setRange({ preset: 'custom', ...custom }); setOpen(false); }}>Apply range</button>
          {avail && <small className="pop-note">Data available {fmt(avail.start)} – {fmt(avail.end)}</small>}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ workspace
function WorkspaceMenu({ locationId, setLocationId }: { locationId?: number; setLocationId: (id?: number) => void }) {
  const { core, locations, live } = useApp();
  const [open, setOpen] = useState(false);
  const ref = useDismiss<HTMLDivElement>(open, () => setOpen(false));
  const loc = locations.find(l => l.id === locationId);
  return (
    <div className="pop-wrap ws" ref={ref}>
      <button className="ws-btn" aria-haspopup="listbox" aria-expanded={open} onClick={() => locations.length && setOpen(o => !o)}>
        <span className="ws-avatar" aria-hidden>{core.restaurant.name.charAt(0)}</span>
        <span className="ws-text"><strong>{core.restaurant.name}</strong><small>{loc ? `${loc.name}, ${loc.city}` : live ? 'All locations' : core.restaurant.region}</small></span>
        {locations.length > 0 && <ChevronDown size={14} aria-hidden />}
      </button>
      {open && (
        <div className="pop left" role="listbox" aria-label="Choose location">
          <div className="pop-title">Location</div>
          <button role="option" aria-selected={!locationId} className={cx('pop-item', !locationId && 'on')} onClick={() => { setLocationId(undefined); setOpen(false); }}>All locations{!locationId && <Check size={14} aria-hidden />}</button>
          {locations.map(l => (
            <button key={l.id} role="option" aria-selected={locationId === l.id} className={cx('pop-item', locationId === l.id && 'on')} onClick={() => { setLocationId(l.id); setOpen(false); }}>
              <span><MapPin size={13} aria-hidden /> {l.name}<small>{l.city}</small></span>{locationId === l.id && <Check size={14} aria-hidden />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Sidebar({ page, open, onClose, locationId, setLocationId }: { page: Page; open: boolean; onClose: () => void; locationId?: number; setLocationId: (id?: number) => void }) {
  const { go } = useApp();
  const nav = (p: Page) => { go(p); onClose(); };
  return (
    <>
      {open && <div className="scrim" onClick={onClose} aria-hidden />}
      <aside className={cx('sidebar', open && 'open')} aria-label="Main navigation">
        <div className="sb-brand"><Logo tone="light" /><button className="icon-btn sb-close" aria-label="Close navigation" onClick={onClose}><X size={18} /></button></div>
        <WorkspaceMenu locationId={locationId} setLocationId={setLocationId} />
        <nav>
          {NAV.map(g => (
            <div className="nav-group" key={g.group}>
              <div className="nav-cap">{g.group}</div>
              {g.items.map(({ page: p, icon: Icon }) => (
                <button key={p} className={cx('nav-link', page === p && 'active')} aria-current={page === p ? 'page' : undefined} onClick={() => nav(p)}><Icon size={16} aria-hidden /><span>{p}</span></button>
              ))}
            </div>
          ))}
        </nav>
        <div className="sb-foot">
          <button className={cx('nav-link', page === 'Settings' && 'active')} aria-current={page === 'Settings' ? 'page' : undefined} onClick={() => nav('Settings')}><Settings size={16} aria-hidden /><span>Settings</span></button>
          <button className="nav-link" onClick={() => toast.info('Help & support', { description: 'Contact your MarginOS workspace administrator, or see docs/PRODUCT_SPEC.md for how each figure is calculated.' })}><CircleHelp size={16} aria-hidden /><span>Help & support</span></button>
        </div>
      </aside>
    </>
  );
}

// ------------------------------------------------------------------ topbar
function UserMenu() {
  const { user, live, health, openLogin, signOut } = useApp();
  const [open, setOpen] = useState(false);
  const ref = useDismiss<HTMLDivElement>(open, () => setOpen(false));
  const initials = user.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  return (
    <div className="pop-wrap" ref={ref}>
      <button className="avatar" aria-label="Account menu" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)}>{initials}</button>
      {open && (
        <div className="pop right" role="menu">
          <div className="pop-user"><strong>{user.name}</strong><small>{user.email}</small><Pill tone="brand">{ROLE_LABEL[user.role]}</Pill></div>
          {user.demo && <p className="pop-note">{live ? 'Demo session: no sign-in required in this environment.' : 'Offline sample session.'}</p>}
          <div className="pop-sep" />
          {live && <button className="pop-item" role="menuitem" onClick={() => { setOpen(false); openLogin(); }}>{user.demo ? 'Sign in' : 'Switch account'}</button>}
          {live && !user.demo && <button className="pop-item" role="menuitem" onClick={() => { setOpen(false); signOut(); }}><span><LogOut size={13} aria-hidden /> Sign out</span></button>}
          {live && user.demo && health.authRequired && <small className="pop-note">Sign-in is required by this server.</small>}
        </div>
      )}
    </div>
  );
}

export function Topbar({ page, range, setRange, onMenu }: { page: Page; range: Range; setRange: (r: Range) => void; onMenu: () => void }) {
  const { core, live, go, loading } = useApp();
  const actionable = core.alerts.filter(a => a.severity !== 'info').length;
  return (
    <div className="topbar">
      <button className="icon-btn tb-menu" aria-label="Open navigation" onClick={onMenu}><MenuIcon size={19} /></button>
      <div className="crumb"><span>{core.restaurant.name}</span><span aria-hidden>/</span><strong>{page}</strong></div>
      <div className="tb-right">
        {PERIOD_PAGES.includes(page) && <PeriodPicker range={range} setRange={setRange} core={core} />}
        <span className={cx('src', live ? (core.restaurant.isDemo ? 'demo' : 'live') : 'offline')} title={live ? (core.restaurant.isDemo ? 'Connected to the API. The restaurant and all figures are fictional demonstration data.' : 'Connected to the API.') : 'The backend is not connected: figures are a fixed offline sample.'}>
          <i />{loading ? 'Syncing…' : live ? (core.restaurant.isDemo ? 'Live API · fictional data' : 'Live data') : 'Offline sample'}
        </span>
        <button className="icon-btn bell" aria-label={`${actionable} alerts needing attention`} onClick={() => go('Profit Leakage')}><Bell size={17} />{actionable > 0 && <b>{actionable > 9 ? '9+' : actionable}</b>}</button>
        <UserMenu />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ sign in
const DEMO_ACCOUNTS: { email: string; label: string }[] = [
  { email: 'owner@marginos.demo', label: 'Owner' }, { email: 'manager@marginos.demo', label: 'Manager' },
  { email: 'kitchen@marginos.demo', label: 'Kitchen' }, { email: 'finance@marginos.demo', label: 'Finance' },
];

export function LoginForm({ onDone, showDemo }: { onDone: (u: User) => void; showDemo: boolean }) {
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [busy, setBusy] = useState(false), [err, setErr] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try { onDone(await apiLogin(email.trim().toLowerCase(), password)); }
    catch (x: any) { setErr(x?.status === 401 ? 'Incorrect email or password.' : x?.message ?? 'Sign-in failed.'); }
    finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} className="stack" noValidate>
      <Field label="Email"><input className="input" type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} autoFocus /></Field>
      <Field label="Password"><input className="input" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} /></Field>
      {err && <div className="form-error" role="alert">{err}</div>}
      <button className="btn primary block" disabled={busy || !email || !password}>{busy ? 'Signing in…' : 'Sign in'}</button>
      {showDemo && (
        <div className="demo-accts">
          <small>Demo accounts (fictional, password <code>demo-password</code>)</small>
          <div>{DEMO_ACCOUNTS.map(a => <button type="button" key={a.email} className="btn sm" onClick={() => { setEmail(a.email); setPassword('demo-password'); }}>{a.label}</button>)}</div>
        </div>
      )}
    </form>
  );
}

export function LoginModal({ onClose, onDone, showDemo }: { onClose: () => void; onDone: (u: User) => void; showDemo: boolean }) {
  return <Modal title="Sign in to MarginOS" onClose={onClose}><LoginForm onDone={onDone} showDemo={showDemo} /></Modal>;
}

export function LoginScreen({ onDone }: { onDone: (u: User) => void }) {
  return (
    <div className="login-screen">
      <div className="login-card">
        <Logo />
        <h1>Sign in</h1>
        <p>Your restaurant's financial data is private. Sign in to continue.</p>
        <LoginForm onDone={onDone} showDemo />
      </div>
    </div>
  );
}
