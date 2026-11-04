/** MarginOS mark, traced from "Minimal MarginOS Brand Identity.png": geometric M with a blue facet. */
export const BRAND_BLUE = "#3b47f5";

export function Mark({ size = 20, ink = "currentColor", facet = BRAND_BLUE, className }: { size?: number; ink?: string; facet?: string; className?: string }) {
  return (
    <svg width={size} height={(size * 220) / 345} viewBox="0 0 345 220" className={className} aria-hidden>
      <polygon points="0,85 120,5 175,37 175,118 120,85 77,113 77,180 0,220" fill={ink} />
      <polygon points="345,15 345,137 207,220 145,220 145,180 270,102 270,62" fill={ink} />
      <polygon points="175,37 242,0 345,0 345,15 175,118" fill={facet} />
    </svg>
  );
}

export function Wordmark({ size = 15 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <Mark size={size * 1.45} ink="var(--ink)" facet="var(--brand)" />
      <span className="h-4 w-px bg-line-strong" aria-hidden />
      <span className="font-semibold tracking-[-0.02em] text-ink" style={{ fontSize: size }}>MarginOS</span>
    </span>
  );
}
