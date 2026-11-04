/** MarginOS brand: a bold, faceted "M" with one blue accent facet. Geometry traced from the brand sheet. */

const LEFT = '0,87 118,8 176,41 176,120 118,88 78,115 78,178 0,222';
const RIGHT = '270,63 346,16 346,138 208,222 145,222 145,182 270,105';
const BLUE = '176,41 242,1 346,1 346,16 176,120';

export function LogoMark({ height = 26, accent = 'var(--accent)', className }: { height?: number; accent?: string; className?: string }) {
  return (
    <svg className={className} height={height} viewBox="-3 -3 352 229" role="img" aria-label="MarginOS" fill="currentColor"
      stroke="currentColor" strokeWidth="5" strokeLinejoin="round" style={{ width: 'auto', display: 'block', flex: 'none' }}>
      <polygon points={LEFT} />
      <polygon points={RIGHT} />
      <polygon points={BLUE} fill={accent} stroke={accent} />
    </svg>
  );
}

export function Logo({ height = 22 }: { height?: number }) {
  return (
    <span className="logo">
      <LogoMark height={height} />
      <span className="logo-word">MarginOS</span>
    </span>
  );
}
