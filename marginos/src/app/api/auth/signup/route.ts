import { z } from "zod";
import { createSession, hashPassword } from "@/lib/auth";
import { createWorkspace } from "@/lib/business";
import { query } from "@/lib/db";
import { fail, handle, json } from "../../_util";

const Body = z.object({
  name: z.string().trim().min(2, "Enter your name").max(80),
  email: z.string().trim().toLowerCase().email("Enter a valid email address").max(200),
  password: z.string().min(10, "Use at least 10 characters for your password").max(200),
  restaurant: z.string().trim().min(2, "Enter your restaurant's name").max(80),
  location: z.string().trim().max(120).optional(),
});

export const POST = handle(async (req: Request) => {
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Check the form and try again");
  const exists = await query(`select 1 from app_users where lower(email) = $1`, [p.data.email]);
  if (exists.length) return fail("An account with this email already exists. Sign in instead.", 409);
  const [u] = await query<{ id: string }>(`insert into app_users (email, name, password_hash) values ($1,$2,$3) returning id`, [p.data.email, p.data.name, await hashPassword(p.data.password)]);
  const bid = await createWorkspace({ name: p.data.restaurant, location: p.data.location || null, ownerUserId: u.id });
  await createSession(u.id, bid);
  return json({ ok: true });
});
