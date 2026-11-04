import { currentUser, switchBusiness } from "@/lib/auth";
import { loadDemo } from "@/lib/demo/seed";
import { query } from "@/lib/db";
import { fail, handle, json } from "../_util";

/** Add (or reset) the sample restaurant in the signed-in user's workspaces and open it. */
export const POST = handle(async () => {
  const u = await currentUser();
  if (!u) return fail("Sign in first", 401);
  const r = await loadDemo(u.id);
  await switchBusiness(u, r.businessId);
  return json(r);
});

/** Remove the user's sample restaurant. */
export const DELETE = handle(async () => {
  const u = await currentUser();
  if (!u) return fail("Sign in first", 401);
  await query(`delete from businesses where is_demo = true and id in (select business_id from memberships where user_id = $1)`, [u.id]);
  return json({ ok: true });
});
