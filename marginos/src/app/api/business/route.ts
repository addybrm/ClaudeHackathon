import { z } from "zod";
import { currentUser, switchBusiness } from "@/lib/auth";
import { createWorkspace } from "@/lib/business";
import { fail, handle, json } from "../_util";

const Body = z.object({
  name: z.string().trim().min(2, "Enter the restaurant's name").max(80),
  location: z.string().trim().max(120).optional(),
  platforms: z.array(z.object({ name: z.string().trim().min(2).max(40), commission_rate: z.number().min(0).max(0.6) })).max(5).default([]),
});

/** Add another restaurant to the signed-in user's account and open it. */
export const POST = handle(async (req: Request) => {
  const u = await currentUser();
  if (!u) return fail("Sign in first", 401);
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Check the form");
  const id = await createWorkspace({ name: p.data.name, location: p.data.location ?? null, platforms: p.data.platforms, ownerUserId: u.id });
  await switchBusiness(u, id);
  return json({ id });
});
