import fs from "node:fs";
import { query } from "@/lib/db";
import { fail, handle, requireBusiness } from "../../../_util";

/** Serve the original uploaded file (source evidence for invoices and imports). */
export const GET = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const b = await requireBusiness();
  const { id } = await ctx.params;
  const [f] = await query<{ storage_path: string | null; mime_type: string | null; file_name: string }>(
    `select storage_path, mime_type, file_name from uploaded_files where id = $1 and business_id = $2`,
    [id, b.id],
  );
  if (!f?.storage_path || !fs.existsSync(f.storage_path)) return fail("Original file not available (demo seed records have no source document)", 404);
  return new Response(new Uint8Array(fs.readFileSync(f.storage_path)), {
    headers: { "content-type": f.mime_type ?? "application/octet-stream", "content-disposition": `inline; filename="${f.file_name.replace(/"/g, "")}"` },
  });
});
