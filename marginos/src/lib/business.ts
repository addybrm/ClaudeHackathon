import { query, num } from "@/lib/db";
import type { BusinessCtx } from "@/lib/finance/engine";
import { availablePeriods } from "@/lib/finance/engine";
import { isPeriodKey } from "@/lib/finance/period";

/**
 * MVP tenancy: a single local workspace with one active business (the most recently
 * created). Every query is still scoped by business_id so multi-tenant auth (Supabase RLS,
 * see supabase/migrations/0090_rls.sql) can be added without touching the analytics layer.
 */
export async function getActiveBusiness(): Promise<BusinessCtx | null> {
  const rows = await query<Record<string, unknown>>(
    `select id, name, location, vat_rate, prices_include_vat, is_demo from businesses order by created_at desc limit 1`,
  );
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id as string,
    name: r.name as string,
    location: (r.location as string) ?? null,
    vatRate: num(r.vat_rate),
    pricesIncludeVat: Boolean(r.prices_include_vat),
    isDemo: Boolean(r.is_demo),
  };
}

/** Resolve the reporting period from a query param, defaulting to the latest month with sales. */
export async function resolvePeriodKey(b: BusinessCtx, requested?: string | string[]): Promise<{ key: string | null; available: string[] }> {
  const available = await availablePeriods(b);
  const req = Array.isArray(requested) ? requested[0] : requested;
  if (isPeriodKey(req) && available.includes(req)) return { key: req, available };
  return { key: available[0] ?? null, available };
}
