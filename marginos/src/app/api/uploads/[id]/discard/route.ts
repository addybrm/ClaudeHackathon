import { discardUpload } from "@/lib/imports/pipeline";
import { handle, json, requireBusiness } from "../../../_util";

export const POST = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const b = await requireBusiness();
  const { id } = await ctx.params;
  await discardUpload(b, id);
  return json({ ok: true });
});
