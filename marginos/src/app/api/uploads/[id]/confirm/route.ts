import { z } from "zod";
import { confirmUpload } from "@/lib/imports/pipeline";
import { fail, handle, json, requireBusiness } from "../../../_util";

const Body = z.object({
  overrides: z
    .object({ lines: z.array(z.object({ index: z.number().int().min(0), ingredientId: z.string().uuid().nullable(), include: z.boolean(), baseQuantity: z.number().positive().nullable() })) })
    .optional(),
});

export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const b = await requireBusiness();
  const { id } = await ctx.params;
  const p = Body.safeParse(await req.json().catch(() => ({})));
  if (!p.success) return fail("Invalid confirmation payload");
  try {
    return json(await confirmUpload(b, id, p.data.overrides));
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err), 409);
  }
});
