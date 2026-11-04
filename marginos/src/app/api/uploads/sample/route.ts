import { z } from "zod";
import { SAMPLE_FILES, sampleContent } from "@/lib/demo/samples";
import { stageUpload, type SourceType } from "@/lib/imports/pipeline";
import { fail, handle, json, requireBusiness } from "../../_util";

export const maxDuration = 120;

/** Stage one of the bundled demo sample files exactly as if it had been uploaded. */
export const POST = handle(async (req: Request) => {
  const b = await requireBusiness();
  const p = z.object({ name: z.string() }).safeParse(await req.json().catch(() => null));
  const meta = p.success ? SAMPLE_FILES.find((s) => s.name === p.data.name) : undefined;
  if (!meta) return fail("Unknown sample file");
  const bytes = sampleContent(meta.name)!;
  const res = await stageUpload(b, { sourceType: meta.sourceType as SourceType, fileName: meta.name, mime: meta.mime, bytes });
  if (res.duplicate) return json({ duplicate: true, existingId: res.existingId, error: res.message }, 409);
  return json({ id: res.id });
});
