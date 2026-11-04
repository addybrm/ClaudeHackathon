import Link from "next/link";
import type { ReactNode } from "react";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export function Panel({ title, subtitle, actions, children, className, pad = true }: { title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={cx("rounded-lg border border-line bg-surface", className)}>
      {(title || actions) && (
        <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-3.5">
          <div className="min-w-0">
            {title && <h2 className="text-[15px] font-semibold text-ink">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-[13px] text-muted">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={pad ? "p-5" : ""}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-[24px] font-semibold tracking-[-0.02em] text-ink">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-[14px] text-muted">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

type Tone = "neutral" | "good" | "warn" | "bad" | "accent" | "info";
const toneCls: Record<Tone, string> = {
  neutral: "border-line-strong text-ink-2 bg-surface-2",
  good: "border-[color:var(--good)]/30 text-good bg-[color:var(--good-bg)]",
  warn: "border-[color:var(--warn)]/30 text-warn bg-[color:var(--warn-bg)]",
  bad: "border-[color:var(--bad)]/30 text-bad bg-[color:var(--bad-bg)]",
  accent: "border-[color:var(--accent)]/30 text-accent bg-[color:var(--accent)]/5",
  info: "border-[#3b47f5]/25 text-[#2f3bd6] bg-[#3b47f5]/[0.07]",
};

export function Badge({ tone = "neutral", children, title, className }: { tone?: Tone; children: ReactNode; title?: string; className?: string }) {
  return (
    <span title={title} className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded border px-1.5 py-[1px] text-[11px] font-medium leading-4", toneCls[tone], className)}>
      {children}
    </span>
  );
}

/** Delta with direction-aware colouring. `goodWhen` says whether an increase is good. */
export function Delta({ value, suffix = "%", goodWhen = "up", dp = 1, className }: { value: number | null | undefined; suffix?: string; goodWhen?: "up" | "down" | "none"; dp?: number; className?: string }) {
  if (value === null || value === undefined || !Number.isFinite(value)) return <span className={cx("text-muted", className)}>—</span>;
  const up = value > 0;
  const flat = Math.abs(value) < 0.05;
  const good = goodWhen === "none" || flat ? null : (up && goodWhen === "up") || (!up && goodWhen === "down");
  return (
    <span className={cx("num inline-flex items-center gap-0.5 whitespace-nowrap font-medium", good === null ? "text-ink-2" : good ? "text-good" : "text-bad", className)}>
      <span aria-hidden className="text-[10px]">{flat ? "■" : up ? "▲" : "▼"}</span>
      {Math.abs(value).toFixed(dp)}
      {suffix}
    </span>
  );
}

export function Stat({ label, value, delta, sub, hint, flag }: { label: string; value: ReactNode; delta?: ReactNode; sub?: ReactNode; hint?: string; flag?: ReactNode }) {
  return (
    <div className="min-w-0 px-5 py-4" title={hint}>
      <div className="flex items-center gap-1.5 text-[13px] text-muted">
        {label}
        {flag}
      </div>
      <div className="num mt-1.5 text-[24px] font-semibold tracking-[-0.02em] text-ink">{value}</div>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-muted">
        {delta}
        {sub && <span>{sub}</span>}
      </div>
    </div>
  );
}

export function StatRow({ children, cols = 6 }: { children: ReactNode; cols?: number }) {
  const grid: Record<number, string> = { 3: "lg:grid-cols-3", 4: "lg:grid-cols-4", 5: "lg:grid-cols-5", 6: "lg:grid-cols-6" };
  return <div className={cx("grid grid-cols-2 divide-line rounded-lg border border-line bg-surface md:grid-cols-3 [&>*]:border-line [&>*]:border-b lg:[&>*]:border-b-0 lg:[&>*:not(:last-child)]:border-r", grid[cols])}>{children}</div>;
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-md border border-dashed border-line-strong px-6 py-10 text-center">
      <div className="text-[13px] font-medium text-ink">{title}</div>
      {children && <div className="mt-1 max-w-md text-[12px] text-muted">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Button({ children, href, variant = "secondary", size = "md", className, ...rest }: { children: ReactNode; href?: string; variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm" | "md"; className?: string } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const cls = cx(
    "inline-flex items-center justify-center gap-1.5 rounded-md border font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
    size === "sm" ? "h-8 px-3 text-[13px]" : "h-9 px-4 text-[14px]",
    variant === "primary" && "border-[#141414] bg-[#141414] text-white hover:bg-[#2b2b2b]",
    variant === "secondary" && "border-line-strong bg-surface-2 text-ink hover:bg-surface-3",
    variant === "ghost" && "border-transparent text-ink-2 hover:bg-surface-2 hover:text-ink",
    variant === "danger" && "border-[color:var(--bad)]/40 bg-transparent text-bad hover:bg-[color:var(--bad-bg)]",
    className,
  );
  if (href) return <Link href={href} className={cls}>{children}</Link>;
  return <button className={cls} {...rest}>{children}</button>;
}

export function DemoBanner() {
  return (
    <div className="border-b border-[color:var(--warn)]/25 bg-[color:var(--warn-bg)] px-6 py-1.5 text-[12px] text-warn">
      <strong className="font-semibold">DEMO DATA</strong>, The Copper Table is a fictional restaurant. All suppliers, platforms and figures are generated for demonstration and are not real performance.
    </div>
  );
}

export function KV({ k, v }: { k: ReactNode; v: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="text-muted">{k}</span>
      <span className="num text-right text-ink">{v}</span>
    </div>
  );
}

export function SeverityDot({ severity }: { severity: "critical" | "warning" | "info" | "good" }) {
  const c = severity === "critical" ? "var(--bad)" : severity === "warning" ? "var(--warn)" : severity === "good" ? "var(--good)" : "#8d8d86";
  return <span aria-hidden className="mt-[5px] inline-block size-1.5 shrink-0 rounded-full" style={{ background: c }} />;
}
