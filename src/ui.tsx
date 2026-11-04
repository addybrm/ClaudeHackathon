import { useEffect, useRef, type ReactNode } from 'react';
import { AlertTriangle, ArrowDownRight, ArrowUpRight, X } from 'lucide-react';
import type { Status } from './api';

// ------------------------------------------------------------------ formatting
export const money = (v: number | null | undefined, currency = 'GBP', digits = 0) =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Number.isFinite(v as number) ? (v as number) : 0);
export const num = (v: number | null | undefined, digits = 1) => (Number.isFinite(v as number) ? (v as number).toFixed(digits) : '—');
export const pct = (v: number | null | undefined, digits = 1) => (v == null || !Number.isFinite(v) ? '—' : `${v.toFixed(digits)}%`);
export const signed = (v: number | null | undefined, digits = 1, suffix = '%') => (v == null || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(digits)}${suffix}`);
export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');
export const STATUS_LABEL: Record<Status, string> = { healthy: 'Healthy', watch: 'Watch', critical: 'Critical' };
export const CLASS_LABEL: Record<string, string> = { star: 'Star', plowhorse: 'Plowhorse', puzzle: 'Puzzle', dog: 'Dog' };
export const CLASS_HINT: Record<string, string> = {
  star: 'Popular and profitable: promote it', plowhorse: 'Popular but low profit: reprice or trim cost',
  puzzle: 'Profitable but slow: give it visibility', dog: 'Slow and low profit: review or remove',
};

// ------------------------------------------------------------------ page chrome
export function PageHeader({ eyebrow, title, subtitle, actions }: { eyebrow?: string; title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="ph">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="ph-actions">{actions}</div>}
    </header>
  );
}

export function Panel({ title, sub, actions, children, flush, className }: { title?: ReactNode; sub?: ReactNode; actions?: ReactNode; children: ReactNode; flush?: boolean; className?: string }) {
  return (
    <section className={cx('panel', className)}>
      {(title || actions) && (
        <div className="panel-h">
          <div>{title && <h2>{title}</h2>}{sub && <p>{sub}</p>}</div>
          {actions && <div className="panel-a">{actions}</div>}
        </div>
      )}
      <div className={flush ? 'panel-b flush' : 'panel-b'}>{children}</div>
    </section>
  );
}

export function Pill({ tone = 'neu', children, dot }: { tone?: 'pos' | 'warn' | 'neg' | 'neu' | 'brand'; children: ReactNode; dot?: boolean }) {
  return <span className={`pill ${tone}`}>{dot && <i />}{children}</span>;
}
export function StatusPill({ status }: { status: Status }) {
  return <Pill tone={status === 'healthy' ? 'pos' : status === 'watch' ? 'warn' : 'neg'} dot>{STATUS_LABEL[status]}</Pill>;
}
export function SeverityPill({ severity }: { severity: 'high' | 'medium' | 'info' }) {
  return <Pill tone={severity === 'high' ? 'neg' : severity === 'medium' ? 'warn' : 'brand'}>{severity === 'high' ? 'High' : severity === 'medium' ? 'Medium' : 'Opportunity'}</Pill>;
}

/** Percentage change with direction. `goodWhen` says which direction is favourable. */
export function Delta({ value, goodWhen = 'up', suffix = '%', digits = 1 }: { value: number | null | undefined; goodWhen?: 'up' | 'down'; suffix?: string; digits?: number }) {
  if (value == null || !Number.isFinite(value)) return <span className="delta flat">—</span>;
  const rounded = Math.round(value * 10 ** digits) / 10 ** digits;
  if (rounded === 0) return <span className="delta flat">0{suffix}</span>;
  const good = (rounded > 0) === (goodWhen === 'up');
  const Icon = rounded > 0 ? ArrowUpRight : ArrowDownRight;
  return <span className={cx('delta', good ? 'good' : 'bad')}><Icon size={13} aria-hidden />{Math.abs(rounded).toFixed(digits)}{suffix}</span>;
}

export function Banner({ tone = 'info', children, action }: { tone?: 'info' | 'warn' | 'neg' | 'pos'; children: ReactNode; action?: ReactNode }) {
  return <div className={`banner ${tone}`} role={tone === 'neg' ? 'alert' : 'status'}><AlertTriangle size={15} aria-hidden /><div>{children}</div>{action}</div>;
}
export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return <div className="empty"><b>{title}</b>{children && <p>{children}</p>}{action}</div>;
}
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return <div className="empty err" role="alert"><b>Something went wrong</b><p>{message}</p>{onRetry && <button className="btn sm" onClick={onRetry}>Try again</button>}</div>;
}
export function Skeleton({ rows = 4, height = 16 }: { rows?: number; height?: number }) {
  return <div className="skel-wrap" aria-busy="true" aria-label="Loading">{Array.from({ length: rows }, (_, i) => <div key={i} className="skel" style={{ height, width: `${100 - (i % 3) * 12}%` }} />)}</div>;
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="tablist" aria-label={label}>
      {options.map(o => <button key={o.value} role="tab" aria-selected={value === o.value} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>{o.label}</button>)}
    </div>
  );
}

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  return <label className="field"><span>{label}</span>{children}{hint && !error && <small>{hint}</small>}{error && <small className="err-text">{error}</small>}</label>;
}

export function Bar({ value, max = 100, tone = 'brand' }: { value: number; max?: number; tone?: 'brand' | 'warn' | 'neg' | 'sage' }) {
  const w = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return <span className={`bar ${tone}`} role="presentation"><i style={{ width: `${w}%` }} /></span>;
}

export function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const first = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    first.current?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); prev?.focus?.(); };
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={onClose}>
      <div className={cx('modal', wide && 'wide')} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={first} onMouseDown={e => e.stopPropagation()}>
        <div className="modal-h"><h2>{title}</h2><button className="icon-btn" aria-label="Close dialog" onClick={onClose}><X size={16} /></button></div>
        <div className="modal-b">{children}</div>
        {footer && <div className="modal-f">{footer}</div>}
      </div>
    </div>
  );
}

/** Sort header cell. */
export function Th({ children, sortKey, sort, onSort, align }: { children: ReactNode; sortKey?: string; sort?: { key: string; dir: 1 | -1 }; onSort?: (k: string) => void; align?: 'right' }) {
  const active = sortKey && sort?.key === sortKey;
  return (
    <th className={align === 'right' ? 'r' : undefined} aria-sort={active ? (sort!.dir === 1 ? 'ascending' : 'descending') : undefined}>
      {sortKey && onSort ? <button className="th-btn" onClick={() => onSort(sortKey)}>{children}{active && <span aria-hidden>{sort!.dir === 1 ? '↑' : '↓'}</span>}</button> : children}
    </th>
  );
}
