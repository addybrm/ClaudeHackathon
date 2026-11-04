/* MarginOS API client (contract: docs/API_CONTRACT.md, v2).
   Live mode talks to the FastAPI backend. If VITE_USE_API is not "true", or the backend is unreachable,
   the app falls back to a small, clearly labelled offline sample so the UI never looks broken. */

export type Params = { start?: string; end?: string; locationId?: number };
export type Role = 'owner' | 'manager' | 'kitchen' | 'finance';
export type Permission = 'read' | 'menu:write' | 'invoice:write' | 'waste:write' | 'report:read' | 'admin';
export type User = { email: string; name: string; role: Role; demo: boolean };

const PERMS: Record<Permission, Role[]> = {
  read: ['owner', 'manager', 'kitchen', 'finance'],
  'menu:write': ['owner', 'manager'],
  'invoice:write': ['owner', 'manager', 'finance'],
  'waste:write': ['owner', 'manager', 'kitchen'],
  'report:read': ['owner', 'manager', 'finance'],
  admin: ['owner'],
};
export const can = (u: User, p: Permission) => PERMS[p].includes(u.role);
export const DEMO_USER: User = { email: 'owner@marginos.demo', name: 'Demo owner', role: 'owner', demo: true };
export const ROLE_LABEL: Record<Role, string> = { owner: 'Owner', manager: 'Manager', kitchen: 'Kitchen manager', finance: 'Finance administrator' };

// ---------------------------------------------------------------- transport
export class ApiError extends Error {
  status: number;
  errors: string[];
  constructor(status: number, message: string, errors: string[] = []) {
    super(message);
    this.status = status;
    this.errors = errors;
  }
}
export const useApi = () => import.meta.env.VITE_USE_API === 'true';
const BASE = () => import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000';
let token: string | null = null;
try { token = sessionStorage.getItem('marginos.token'); } catch { /* storage unavailable */ }
export const setToken = (t: string | null) => {
  token = t;
  try { if (t) sessionStorage.setItem('marginos.token', t); else sessionStorage.removeItem('marginos.token'); } catch { /* ignore */ }
};
export const hasToken = () => !!token;

async function send(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  try {
    return await fetch(`${BASE()}${path}`, { ...init, headers });
  } catch {
    throw new ApiError(0, 'Cannot reach the MarginOS API. Check that the backend is running.');
  }
}
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await send(path, init);
  if (!r.ok) {
    let msg = `Request failed (${r.status})`;
    let errors: string[] = [];
    try {
      const d = (await r.json()).detail;
      if (typeof d === 'string') msg = d;
      else if (Array.isArray(d)) msg = d.map((x: any) => x.msg ?? String(x)).join('; ');
      else if (d?.message) { msg = d.message; errors = d.errors ?? []; }
    } catch { /* keep default */ }
    throw new ApiError(r.status, msg, errors);
  }
  return r.json() as Promise<T>;
}
const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const put = (body: unknown): RequestInit => ({ ...json(body), method: 'PUT' });
const qs = (p: Params = {}, extra: Record<string, string | number | undefined> = {}) => {
  const u = new URLSearchParams();
  if (p.start) u.set('start', p.start);
  if (p.end) u.set('end', p.end);
  if (p.locationId) u.set('location_id', String(p.locationId));
  Object.entries(extra).forEach(([k, v]) => v !== undefined && u.set(k, String(v)));
  const s = u.toString();
  return s ? `?${s}` : '';
};

// ---------------------------------------------------------------- domain types
export type Period = { start: string; end: string; days: number; weeks_of_sales: number; data_available: { start: string; end: string }; location: string };
export type Status = 'healthy' | 'watch' | 'critical';
export type MenuClass = 'star' | 'plowhorse' | 'puzzle' | 'dog';
export type IngLine = { id: string; name: string; quantity: number; unit: string; unitCost: number; lineCost: number; changePct: number | null };
export type Dish = {
  id: string; name: string; category: string; price: number; cost: number; grossProfit: number; marginPct: number; foodCostPct: number;
  markupPct: number | null; units: number; revenue: number; gpContribution: number; rank: number; marginChangePp: number | null;
  costChangePct: number | null; suggestedPrice: number; status: Status; menuClass: MenuClass | null; ingredients: IngLine[];
  costTrend: { week: string; cost: number }[];
};
export type PriceChange = {
  id: string; name: string; unit: string; supplier: string; from: number; to: number; changePct: number; weeklyImpact: number;
  affected: { dishId: string; name: string; perPortion: number; weeklyImpact: number }[];
};
export type AlertItem = {
  id: string; type: string; severity: 'high' | 'medium' | 'info'; title: string; message: string; impact?: number;
  impactBasis?: 'week' | 'period'; suggestedPrice?: number; entity: { ingredient_id?: string; dish_id?: string };
};
export type Kpis = {
  revenue: number; ingredient_expenditure: number; gross_profit: number; gross_margin_pct: number; food_cost_pct: number;
  theoretical_food_cost_pct: number | null; waste_cost: number; unexplained_variance: number; target_food_cost_pct: number;
  changes: { revenue: number | null; ingredient_expenditure: number | null; gross_profit: number | null; waste_cost: number | null };
};
export type TrendPoint = { label: string; revenue: number; spend: number };
export type Core = {
  live: boolean;
  restaurant: { name: string; region: string; isDemo: boolean; currency: string };
  period: Period | null;
  kpis: Kpis; trend: TrendPoint[]; dishes: Dish[]; alerts: AlertItem[]; priceChanges: PriceChange[];
  leakage: { total: number; annualised: number; weekly: number };
};
export type Rec = { area: string; action: string; estimated_impact: number; basis: string };

const dayLabel = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
export const fmtDay = dayLabel;

export function normalizeDish(d: any): Dish {
  return {
    id: d.id, name: d.name, category: d.category, price: d.selling_price ?? d.menu_price, cost: d.ingredient_cost, grossProfit: d.gross_profit,
    marginPct: d.gross_margin_pct, foodCostPct: d.food_cost_pct, markupPct: d.markup_pct ?? null, units: d.units_sold ?? d.weekly_units_sold ?? 0,
    revenue: d.revenue ?? 0, gpContribution: d.gross_profit_contribution ?? 0, rank: d.profitability_rank ?? 0,
    marginChangePp: d.margin_change_pp ?? null, costChangePct: d.cost_change_pct ?? null,
    suggestedPrice: d.suggested_price_for_target ?? d.suggested_price ?? d.menu_price,
    status: d.status, menuClass: d.menu_class ?? null,
    ingredients: (d.ingredients ?? []).map((i: any) => ({ id: i.ingredient_id ?? i.id, name: i.name, quantity: i.quantity, unit: i.unit, unitCost: i.unit_cost ?? 0, lineCost: i.line_cost ?? i.cost ?? 0, changePct: i.unit_cost_change_pct ?? null })),
    costTrend: (d.cost_trend ?? []).map((t: any) => ({ week: t.week_start === 'current' ? 'Now' : dayLabel(t.week_start), cost: t.ingredient_cost })),
  };
}
export function normalizeChange(c: any): PriceChange {
  return {
    id: c.ingredient_id ?? c.id, name: c.name, unit: c.unit, supplier: c.supplier, from: c.price_at_period_start ?? c.previous_price, to: c.current_price,
    changePct: c.change_pct, weeklyImpact: c.weekly_cost_impact ?? 0,
    affected: (c.affected_dishes ?? []).map((a: any) => ({ dishId: a.dish_id, name: a.name, perPortion: a.cost_change_per_portion, weeklyImpact: a.weekly_impact })),
  };
}
function normalizeAlert(a: any): AlertItem {
  const week = a.impact_gbp_weekly != null;
  return {
    id: a.id, type: a.type, severity: a.severity, title: a.title, message: a.message ?? a.detail ?? '', impact: a.impact_gbp_weekly ?? a.impact_gbp_period ?? undefined,
    impactBasis: week ? 'week' : a.impact_gbp_period != null ? 'period' : undefined, suggestedPrice: a.suggested_price, entity: a.entity ?? {},
  };
}

// ---------------------------------------------------------------- core data
export async function loadCore(p: Params): Promise<Core> {
  if (!useApi()) return offlineCore();
  const [d, m, a, c] = await Promise.all([
    request<any>(`/api/dashboard${qs(p)}`), request<any>(`/api/menu${qs(p)}`), request<any>(`/api/alerts${qs(p)}`),
    request<any>(`/api/suppliers/price-changes${qs(p)}`),
  ]);
  const k = d.kpis, ch = k.changes_vs_previous_period_pct ?? {};
  return {
    live: true,
    restaurant: { name: String(d.restaurant.name).replace(/\s*\(fictional demo\)/i, ''), region: d.restaurant.region, isDemo: !!d.restaurant.is_demo_data, currency: d.restaurant.currency ?? 'GBP' },
    period: d.period,
    kpis: {
      revenue: k.revenue, ingredient_expenditure: k.ingredient_expenditure, gross_profit: k.gross_profit, gross_margin_pct: k.gross_margin_pct,
      food_cost_pct: k.food_cost_pct, theoretical_food_cost_pct: k.theoretical_food_cost_pct ?? null, waste_cost: k.waste_cost,
      unexplained_variance: k.unexplained_variance, target_food_cost_pct: k.target_food_cost_pct,
      changes: { revenue: ch.revenue ?? null, ingredient_expenditure: ch.ingredient_expenditure ?? null, gross_profit: ch.gross_profit ?? null, waste_cost: ch.waste_cost ?? null },
    },
    trend: (d.trend ?? []).map((t: any) => ({ label: dayLabel(t.week_start), revenue: t.revenue, spend: t.ingredient_expenditure })),
    dishes: (m.dishes ?? []).map(normalizeDish),
    alerts: (a.alerts ?? []).map(normalizeAlert),
    priceChanges: (c.changes ?? []).map(normalizeChange),
    leakage: { total: d.profit_leakage?.total ?? 0, annualised: d.profit_leakage?.annualised ?? 0, weekly: (d.profit_leakage?.total ?? 0) / (d.period?.weeks_of_sales || 1) },
  };
}

export async function getHealth(): Promise<{ available: boolean; advisorLive: boolean; authRequired: boolean }> {
  if (!useApi()) return { available: false, advisorLive: false, authRequired: false };
  try {
    const h = await request<any>('/api/health');
    return { available: true, advisorLive: !!h.advisor?.live_ai, authRequired: h.auth_mode === 'required' };
  } catch {
    return { available: false, advisorLive: false, authRequired: false };
  }
}

// ---------------------------------------------------------------- auth
export async function login(email: string, password: string): Promise<User> {
  const r = await request<any>('/api/auth/login', json({ email, password }));
  setToken(r.access_token);
  return { ...r.user, demo: false };
}
export async function getMe(): Promise<User> {
  const r = await request<any>('/api/auth/me');
  return { email: r.email, name: r.name, role: r.role, demo: !!r.demo_session };
}

// ---------------------------------------------------------------- endpoints
export const getLocations = () => request<{ id: number; name: string; city: string }[]>('/api/locations');
export const getIngredients = () => request<{ id: string; name: string; unit: string; category: string; current_price: number; current_supplier: string | null }[]>('/api/ingredients');
export const getSuppliers = (p: Params) => request<any>(`/api/suppliers${qs(p)}`);
export const getComparison = (p: Params) => request<any>(`/api/suppliers/comparison${qs(p)}`);
export const getPriceHistory = (id: string) => request<any>(`/api/ingredients/${encodeURIComponent(id)}/price-history`);
export const getLeakage = (p: Params) => request<any>(`/api/leakage${qs(p)}`);
export const getForecast = (weeks: number, p: Params) => request<any>(`/api/forecast${qs({ locationId: p.locationId }, { weeks })}`);
export const simulate = (body: unknown) => request<any>('/api/simulate', json(body));
export const getReport = (p: Params) => request<any>(`/api/reports${qs(p)}`);
export async function downloadReport(p: Params): Promise<{ blob: Blob; name: string }> {
  const r = await send(`/api/reports/download${qs(p)}`);
  if (!r.ok) throw new ApiError(r.status, r.status === 403 ? 'Your role cannot download reports.' : `Download failed (${r.status})`);
  const name = /filename="([^"]+)"/.exec(r.headers.get('content-disposition') ?? '')?.[1] ?? 'marginos-report.md';
  return { blob: await r.blob(), name };
}
export const getWaste = (p: Params) => request<any>(`/api/waste${qs(p)}`);
export const postWaste = (body: unknown) => request<any>('/api/waste', json(body));
export const listInvoices = () => request<{ invoices: any[] }>('/api/invoices?limit=20');
export function uploadInvoice(file: File, supplier?: string) {
  const f = new FormData();
  f.append('file', file);
  if (supplier) f.append('supplier', supplier);
  return request<any>('/api/invoices/upload', { method: 'POST', body: f });
}
export const confirmInvoice = (body: unknown) => request<any>('/api/invoices', json(body));
export const saveDish = (body: unknown, id?: string) => request<any>(id ? `/api/menu/${encodeURIComponent(id)}` : '/api/menu', id ? put(body) : json(body));
export const archiveDish = (id: string) => request<any>(`/api/menu/${encodeURIComponent(id)}`, { method: 'DELETE' });

export type AdvisorReply = { answer: string; notice: string | null; label: string; live: boolean; provider: string; scenario: any | null; intent: string | null };
export async function askAdvisor(question: string, p: Params): Promise<AdvisorReply> {
  if (!useApi()) return offlineAdvisor(question);
  try {
    const d = await request<any>('/api/advisor', json({ question, start: p.start, end: p.end, location_id: p.locationId }));
    return { answer: d.answer, notice: d.live_ai ? null : d.notice, label: d.label, live: !!d.live_ai, provider: d.provider, scenario: d.scenario ?? null, intent: d.intent ?? null };
  } catch (e) {
    if (e instanceof ApiError && e.status !== 0) throw e;
    return { ...offlineAdvisor(question), notice: 'The advisor API is unreachable. This is a rule-based offline sample, not Claude.' };
  }
}

// ---------------------------------------------------------------- offline sample (clearly labelled in the UI)
const mk = (name: string, category: string, price: number, cost: number, units: number): Dish => {
  const gp = price - cost, fc = (cost / price) * 100;
  return {
    id: name.toLowerCase().replace(/[^a-z0-9]+/g, '_'), name, category, price, cost, grossProfit: gp, marginPct: (gp / price) * 100, foodCostPct: fc, markupPct: (gp / cost) * 100,
    units, revenue: price * units, gpContribution: gp * units, rank: 0, marginChangePp: null, costChangePct: null, suggestedPrice: cost / 0.3,
    status: fc <= 30 ? 'healthy' : fc <= 35 ? 'watch' : 'critical', menuClass: null, ingredients: [], costTrend: [],
  };
};
export function offlineCore(): Core {
  const dishes = [mk('Burrata & Heirloom Tomato', 'Starters', 16, 4.32, 186), mk('Wild Mushroom Risotto', 'Mains', 24, 7.2, 142), mk('Pan-Seared Sea Bass', 'Mains', 32, 12.16, 98),
    mk('Truffle Tagliatelle', 'Mains', 26, 6.24, 164), mk('Heritage Chicken', 'Mains', 28, 11.2, 87), mk('Chocolate Fondant', 'Desserts', 12, 2.52, 121),
    mk('Seasonal Leaf Salad', 'Starters', 14, 5.04, 73), mk('Crispy Calamari', 'Starters', 17, 5.27, 115)]
    .sort((a, b) => b.gpContribution - a.gpContribution).map((d, i) => ({ ...d, rank: i + 1 }));
  return {
    live: false,
    restaurant: { name: 'Sample restaurant', region: 'Offline sample data', isDemo: true, currency: 'GBP' },
    period: null,
    kpis: { revenue: 68420, ingredient_expenditure: 21894, gross_profit: 46526, gross_margin_pct: 68, food_cost_pct: 32, theoretical_food_cost_pct: null, waste_cost: 0, unexplained_variance: 0, target_food_cost_pct: 30, changes: { revenue: 12.8, ingredient_expenditure: 4.2, gross_profit: 16.4, waste_cost: null } },
    trend: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map((label, i) => ({ label, revenue: [48, 53, 49, 61, 58, 66, 62, 72, 68, 76, 71, 84][i] * 1000, spend: [17, 19, 18, 20, 19, 22, 21, 24, 23, 25, 23, 27][i] * 1000 })),
    dishes,
    alerts: [
      { id: 'a1', type: 'supplier_price_increase', severity: 'high', title: 'Olive oil up 14.2%', message: 'Extra virgin olive oil rose from £8.90 to £10.16 per litre.', impact: 194.36, impactBasis: 'week', entity: {} },
      { id: 'a2', type: 'high_food_cost', severity: 'medium', title: 'Heritage Chicken: food cost 40%', message: 'Above the 30% target. Review portion size or price.', entity: {} },
    ],
    priceChanges: [
      { id: 'oil', name: 'Extra virgin olive oil', unit: 'l', supplier: 'Sample supplier A', from: 8.9, to: 10.16, changePct: 14.2, weeklyImpact: 194.36, affected: [] },
      { id: 'chicken', name: 'Chicken breast', unit: 'kg', supplier: 'Sample supplier B', from: 6.27, to: 6.8, changePct: 8.4, weeklyImpact: 61.2, affected: [] },
    ],
    leakage: { total: 1100, annualised: 14300, weekly: 275 },
  };
}
function offlineAdvisor(q: string): AdvisorReply {
  const l = q.toLowerCase();
  const answer = l.includes('cost') ? 'In the offline sample, food cost is 32% of revenue. Reviewing the thinnest-margin dishes against recent supplier increases is the highest-impact next step.'
    : l.includes('dish') || l.includes('menu') ? 'In the offline sample, Truffle Tagliatelle has one of the strongest margins. Feature it, and review Heritage Chicken before changing prices.'
      : 'Offline sample: revenue is up 12.8% and gross profit up 16.4%. Check the olive oil increase and your lowest-margin dishes to protect that gain.';
  return { answer, notice: 'Offline sample answer from fixed rules. It is not generated from your data and not from Claude.', label: 'Offline sample: not live AI', live: false, provider: 'offline', scenario: null, intent: null };
}
