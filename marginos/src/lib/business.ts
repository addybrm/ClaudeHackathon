import { query, num } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import type { BusinessCtx } from "@/lib/finance/engine";
import { availablePeriods } from "@/lib/finance/engine";
import { isPeriodKey } from "@/lib/finance/period";

async function loadBusiness(id: string): Promise<BusinessCtx | null> {
  const rows = await query<Record<string, unknown>>(`select id, name, location, vat_rate, prices_include_vat, is_demo from businesses where id = $1`, [id]);
  const r = rows[0];
  if (!r) return null;
  return { id: r.id as string, name: r.name as string, location: (r.location as string) ?? null, vatRate: num(r.vat_rate), pricesIncludeVat: Boolean(r.prices_include_vat), isDemo: Boolean(r.is_demo) };
}

/** Most recently created business. Only for tests and scripts, which run outside a signed-in request. */
export async function latestBusiness(): Promise<BusinessCtx | null> {
  const r = await query<{ id: string }>(`select id from businesses order by created_at desc limit 1`);
  return r[0] ? loadBusiness(r[0].id) : null;
}

/**
 * The restaurant open in the signed-in user's session. Every query is scoped by its id;
 * a user only ever reaches businesses they are a member of.
 */
export async function getActiveBusiness(): Promise<BusinessCtx | null> {
  const u = await currentUser();
  if (!u) return process.env.VITEST ? latestBusiness() : null;
  if (u.businessId) {
    const ok = await query(`select 1 from memberships where user_id = $1 and business_id = $2`, [u.id, u.businessId]);
    if (ok.length) return loadBusiness(u.businessId);
  }
  const first = await query<{ business_id: string }>(`select business_id from memberships m join businesses b on b.id = m.business_id where m.user_id = $1 order by b.is_demo, b.created_at limit 1`, [u.id]);
  if (!first[0]) return null;
  await query(`update sessions set business_id = $2 where token_hash = $1`, [u.tokenHash, first[0].business_id]);
  return loadBusiness(first[0].business_id);
}

/** Create an empty restaurant workspace with its data sources and in-house channels. */
export async function createWorkspace(input: { name: string; location?: string | null; platforms?: { name: string; commission_rate: number }[]; ownerUserId?: string }) {
  const [b] = await query<{ id: string }>(`insert into businesses (name, location) values ($1,$2) returning id`, [input.name, input.location ?? null]);
  const sources = [
    ["pos_sales", "POS sales export"], ["supplier_invoice", "Supplier invoices"], ["menu_recipes", "Menu & recipes"],
    ["delivery_settlement", "Delivery platform settlements"], ["waste", "Waste log"], ["labour", "Rota & labour"], ["supplier_orders", "Supplier order confirmations"],
  ];
  for (const [kind, label] of sources) await query(`insert into data_sources (business_id, kind, label) values ($1,$2,$3)`, [b.id, kind, label]);
  await query(`insert into sales_channels (business_id, kind, name) values ($1, 'dine_in', 'Dine-in'), ($1, 'collection', 'Collection')`, [b.id]);
  for (const pl of input.platforms ?? []) {
    await query(`insert into sales_channels (business_id, kind, name, platform, commission_rate) values ($1, 'delivery', $2, $2, $3)`, [b.id, pl.name, pl.commission_rate]);
  }
  if (input.ownerUserId) await query(`insert into memberships (user_id, business_id, role) values ($1,$2,'owner')`, [input.ownerUserId, b.id]);
  return b.id;
}

/** Resolve the reporting period from a query param, defaulting to the latest month with sales. */
export async function resolvePeriodKey(b: BusinessCtx, requested?: string | string[]): Promise<{ key: string | null; available: string[] }> {
  const available = await availablePeriods(b);
  const req = Array.isArray(requested) ? requested[0] : requested;
  if (isPeriodKey(req) && available.includes(req)) return { key: req, available };
  return { key: available[0] ?? null, available };
}
