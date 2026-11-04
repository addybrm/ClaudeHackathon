import { z } from "zod";
import { clearFailures, createSession, recordFailure, throttled, verifyPassword } from "@/lib/auth";
import { query } from "@/lib/db";
import { fail, handle, json } from "../../_util";

const Body = z.object({ email: z.string().trim().toLowerCase().max(200), password: z.string().max(200) });

export const POST = handle(async (req: Request) => {
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success || !p.data.email || !p.data.password) return fail("Enter your email and password");
  const key = `${p.data.email}|${req.headers.get("x-forwarded-for") ?? "local"}`;
  if (throttled(key)) return fail("Too many attempts. Wait 15 minutes and try again.", 429);
  const [u] = await query<{ id: string; password_hash: string }>(`select id, password_hash from app_users where lower(email) = $1`, [p.data.email]);
  if (!u || !(await verifyPassword(p.data.password, u.password_hash))) {
    recordFailure(key);
    return fail("That email and password don't match.", 401);
  }
  clearFailures(key);
  const [m] = await query<{ business_id: string }>(`select m.business_id from memberships m join businesses b on b.id = m.business_id where m.user_id = $1 order by b.is_demo, b.created_at limit 1`, [u.id]);
  await createSession(u.id, m?.business_id ?? null);
  return json({ ok: true });
});
