import { z } from "zod";
import { SOURCE_TYPES, stageUpload, type SourceType } from "@/lib/imports/pipeline";
import { fail, handle, json, requireBusiness } from "../_util";

const MAX = 12 * 1024 * 1024;
const MIME_BY_EXT: Record<string, string> = { csv: "text/csv", pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };

export const maxDuration = 120;

export const POST = handle(async (req: Request) => {
  const b = await requireBusiness();
  const form = await req.formData();
  const file = form.get("file");
  const st = z.enum(SOURCE_TYPES as [SourceType, ...SourceType[]]).safeParse(form.get("sourceType"));
  if (!st.success) return fail("Choose a valid data source type");
  if (!(file instanceof File)) return fail("No file uploaded");
  if (file.size === 0) return fail("The file is empty");
  if (file.size > MAX) return fail("File is larger than 12 MB");
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const mime = MIME_BY_EXT[ext] ?? file.type;
  if (st.data !== "supplier_invoice" && mime !== "text/csv") return fail("This data source must be imported as a CSV file");
  if (st.data === "supplier_invoice" && !["application/pdf", "image/png", "image/jpeg", "image/webp"].includes(mime)) return fail("Supplier invoices must be PDF, PNG, JPEG or WebP");
  const res = await stageUpload(b, { sourceType: st.data, fileName: file.name, mime, bytes: Buffer.from(await file.arrayBuffer()) });
  if (res.duplicate) return json({ duplicate: true, existingId: res.existingId, error: res.message }, 409);
  return json({ id: res.id });
});
