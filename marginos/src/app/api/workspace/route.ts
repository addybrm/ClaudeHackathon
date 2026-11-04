import { z } from "zod";
import { currentUser, switchBusiness } from "@/lib/auth";
import { fail, handle, json } from "../_util";

/** Switch the restaurant open in this session. */
export const POST = handle(async (req: Request) => {
  const u = await currentUser();
  if (!u) return fail("Sign in first", 401);
  const p = z.object({ businessId: z.string().uuid() }).safeParse(await req.json().catch(() => null));
  if (!p.success) return fail("Choose a restaurant");
  try {
    await switchBusiness(u, p.data.businessId);
  } catch (e) {
    return fail((e as Error).message, 403);
  }
  return json({ ok: true });
});
