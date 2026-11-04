"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Wordmark } from "./logo";
import { cx } from "./ui";

const NAV = [
  { href: "/", label: "Overview", icon: "M3 13h4v8H3zM10 9h4v12h-4zM17 4h4v17h-4z" },
  { href: "/investigator", label: "Investigator", icon: "M11 4a7 7 0 1 0 4.95 11.95L20 20M8 11h6M11 8v6" },
  { href: "/menu", label: "Menu analysis", icon: "M4 5h16M4 12h16M4 19h10" },
  { href: "/costs", label: "Cost intelligence", icon: "M4 19l5-6 4 3 7-9M15 7h5v5" },
  { href: "/waste-labour", label: "Waste & labour", icon: "M6 7h12l-1 13H7zM9 7V4h6v3M4 7h16" },
  { href: "/stock", label: "Stock & expiry", icon: "M4 8l8-4 8 4v8l-8 4-8-4zM4 8l8 4 8-4M12 12v8" },
  { href: "/data", label: "Data centre", icon: "M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zm0 0v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" },
];

export interface ShellUser { name: string; email: string }
export interface ShellBusiness { id: string; name: string; isDemo: boolean }

export function Sidebar({ user, businesses, activeId, aiLive }: { user: ShellUser; businesses: ShellBusiness[]; activeId: string | null; aiLive: boolean }) {
  const pathname = usePathname();
  const sp = useSearchParams();
  const period = sp.get("period");
  return (
    <aside className="sticky top-0 hidden h-screen w-[236px] shrink-0 flex-col border-r border-line bg-bg md:flex">
      <div className="px-4 pb-2 pt-4">
        <Link href="/" className="inline-flex" aria-label="MarginOS home"><Wordmark size={15} /></Link>
      </div>
      <div className="px-2 pb-3">
        <WorkspaceSwitcher businesses={businesses} activeId={activeId} />
      </div>
      <nav className="flex-1 space-y-0.5 px-2" aria-label="Main">
        {NAV.map((n) => {
          const active = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
          return (
            <Link
              key={n.href}
              href={period && n.href !== "/data" ? `${n.href}?period=${period}` : n.href}
              aria-current={active ? "page" : undefined}
              className={cx("flex h-[34px] items-center gap-2.5 rounded-md px-2.5 text-[14px] transition-colors", active ? "bg-surface-3 font-medium text-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink")}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={active ? "text-ink" : "text-muted"}>
                <path d={n.icon} />
              </svg>
              {n.label}
            </Link>
          );
        })}
      </nav>
      <div className="px-4 pb-2 text-[12px] text-muted" title={aiLive ? "Investigations use Claude with tool calling" : "No ANTHROPIC_API_KEY set. Investigations use rule-based offline analysis, not AI."}>
        {aiLive ? "Claude connected" : "Claude offline"}
      </div>
      <UserRow user={user} />
    </aside>
  );
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
}

function WorkspaceSwitcher({ businesses, activeId }: { businesses: ShellBusiness[]; activeId: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);
  const active = businesses.find((b) => b.id === activeId) ?? businesses[0];
  const hasSample = businesses.some((b) => b.isDemo);
  const go = async (fn: () => Promise<Response>) => {
    setBusy(true);
    try {
      const r = await fn();
      if (r.ok) { setOpen(false); router.push("/"); router.refresh(); }
    } finally {
      setBusy(false);
    }
  };
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 rounded-md border border-line bg-surface px-2.5 py-2 text-left hover:border-line-strong"
      >
        <span className="flex size-7 shrink-0 items-center justify-center rounded bg-ink text-[12px] font-semibold text-white">{active ? initials(active.name) : "?"}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-ink">{active?.name ?? "No restaurant"}</span>
          <span className="block text-[12px] text-muted">{active?.isDemo ? "Sample data" : "Restaurant"}</span>
        </span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="text-muted" aria-hidden><path d="M7 10l5-5 5 5M7 14l5 5 5-5" /></svg>
      </button>
      {open && (
        <div role="menu" className="absolute left-0 right-0 top-full z-30 mt-1 rounded-md border border-line bg-surface p-1 shadow-[0_10px_30px_rgba(20,20,20,0.12)]">
          {businesses.map((b) => (
            <button key={b.id} role="menuitem" disabled={busy} onClick={() => go(() => fetch("/api/workspace", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ businessId: b.id }) }))}
              className={cx("flex w-full items-center justify-between rounded px-2.5 py-2 text-left text-[13px] hover:bg-surface-2", b.id === active?.id ? "font-medium text-ink" : "text-ink-2")}>
              <span className="truncate">{b.name}</span>
              {b.isDemo && <span className="text-[12px] text-muted">Sample</span>}
            </button>
          ))}
          <div className="my-1 h-px bg-[var(--rule)]" />
          <Link href="/onboarding" onClick={() => setOpen(false)} role="menuitem" className="block rounded px-2.5 py-2 text-[13px] text-ink-2 hover:bg-surface-2">Add a restaurant</Link>
          <button role="menuitem" disabled={busy} onClick={() => go(() => fetch("/api/demo", { method: "POST" }))} className="block w-full rounded px-2.5 py-2 text-left text-[13px] text-ink-2 hover:bg-surface-2">
            {busy ? "Preparing sample restaurant…" : hasSample ? "Reset the sample restaurant" : "Open the sample restaurant"}
          </button>
        </div>
      )}
    </div>
  );
}

function UserRow({ user }: { user: ShellUser }) {
  const router = useRouter();
  return (
    <div className="flex items-center gap-2.5 border-t border-line px-4 py-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-3 text-[12px] font-semibold text-ink-2">{initials(user.name)}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-ink">{user.name}</span>
        <span className="block truncate text-[12px] text-muted">{user.email}</span>
      </span>
      <button
        onClick={async () => { await fetch("/api/auth/logout", { method: "POST" }); router.push("/login"); router.refresh(); }}
        className="rounded px-1.5 py-1 text-[12px] text-muted hover:bg-surface-2 hover:text-ink"
      >
        Sign out
      </button>
    </div>
  );
}

export function MobileNav() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-line px-3 py-2 md:hidden">
      {NAV.map((n) => (
        <Link key={n.href} href={n.href} className={cx("whitespace-nowrap rounded px-2.5 py-1 text-[12px]", (n.href === "/" ? pathname === "/" : pathname.startsWith(n.href)) ? "bg-surface-3 text-ink" : "text-ink-2")}>
          {n.label}
        </Link>
      ))}
    </nav>
  );
}

export function PeriodPicker({ value, available, compareLabel }: { value: string; available: string[]; compareLabel?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const label = (k: string) => {
    const [y, m] = k.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  };
  return (
    <div className="flex items-center gap-2 text-[12px]">
      <label className="text-muted" htmlFor="period">Period</label>
      <select
        id="period"
        value={value}
        onChange={(e) => {
          const q = new URLSearchParams(sp.toString());
          q.set("period", e.target.value);
          router.push(`${pathname}?${q.toString()}`);
        }}
        className="h-7 rounded border border-line-strong bg-surface-2 px-2 text-[12px] text-ink"
      >
        {available.map((k) => (
          <option key={k} value={k}>{label(k)}</option>
        ))}
      </select>
      {compareLabel && <span className="text-muted">vs {compareLabel}</span>}
    </div>
  );
}
