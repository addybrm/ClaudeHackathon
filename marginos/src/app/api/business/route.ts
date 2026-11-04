import { z } from "zod";
import { query } from "@/lib/db";
import { fail, handle, json } from "../_util";

const Body = z.object({
  name: z.string().trim().min(2).max(80),
  location: z.string().trim().max(120).optional(),
  platforms: z.array(z.object({ name: z.string().trim().min(2).max(40), commission_rate: z.number().min(0).max(0.6) })).max(5).default([]),
});

/** Create an empty workspace for a real restaurant (no demo data). */
export const POST = handle(async (req: Request) => {
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(p.error.issues.map((i) => i.message).join("; "));
  const [b] = await query<{ id: string }>(`insert into businesses (name, location) values ($1,$2) returning id`, [p.data.name, p.data.location ?? null]);
  const sources = [
    ["pos_sales", "POS sales export"],
    ["supplier_invoice", "Supplier invoices"],
    ["menu_recipes", "Menu & recipes"],
    ["delivery_settlement", "Delivery platform settlements"],
    ["waste", "Waste log"],
    ["labour", "Rota & labour"],
    ["supplier_orders", "Supplier order confirmations"],
  ];
  for (const [kind, label] of sources) await query(`insert into data_sources (business_id, kind, label) values ($1,$2,$3)`, [b.id, kind, label]);
  await query(`insert into sales_channels (business_id, kind, name) values ($1, 'dine_in', 'Dine-in'), ($1, 'collection', 'Collection')`, [b.id]);
  for (const pl of p.data.platforms) {
    await query(`insert into sales_channels (business_id, kind, name, platform, commission_rate) values ($1, 'delivery', $2, $2, $3)`, [b.id, pl.name, pl.commission_rate]);
  }
  return json({ id: b.id });
});
