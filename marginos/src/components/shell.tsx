"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
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

export function Sidebar({ business, isDemo, aiLive }: { business: string | null; isDemo: boolean; aiLive: boolean }) {
  const pathname = usePathname();
  const sp = useSearchParams();
  const period = sp.get("period");
  return (
    <aside className="sticky top-0 hidden h-screen w-[216px] shrink-0 flex-col border-r border-line bg-[#111110] md:flex">
      <Link href="/" className="flex h-12 items-center border-b border-line px-4">
        <Wordmark size={14} />
      </Link>
      <nav className="flex-1 space-y-0.5 p-2">
        {NAV.map((n) => {
          const active = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
          return (
            <Link
              key={n.href}
              href={period && n.href !== "/data" ? `${n.href}?period=${period}` : n.href}
              className={cx("flex h-8 items-center gap-2.5 rounded px-2.5 text-[13px] transition-colors", active ? "bg-surface-3 text-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink")}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={active ? "text-accent" : "text-muted"}>
                <path d={n.icon} />
              </svg>
              {n.label}
            </Link>
          );
        })}
      </nav>
      <div className="space-y-2 border-t border-line p-3 text-[12px]">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-ink">{business ?? "No business"}</span>
          {isDemo && <span className="rounded border border-[color:var(--warn)]/35 px-1 text-[10px] font-semibold text-warn">DEMO</span>}
        </div>
        <div className="flex items-center gap-1.5 text-muted" title={aiLive ? "ANTHROPIC_API_KEY configured — investigations use Claude with tool calling" : "No ANTHROPIC_API_KEY — investigator runs deterministic demo mode"}>
          <span className="size-1.5 rounded-full" style={{ background: aiLive ? "var(--good)" : "var(--warn)" }} />
          {aiLive ? "Claude connected" : "AI demo mode (no API key)"}
        </div>
      </div>
    </aside>
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
