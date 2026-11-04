import { SAMPLE_FILES, sampleContent } from "@/lib/demo/samples";

export async function GET(_req: Request, ctx: { params: Promise<{ name: string }> }) {
  const { name } = await ctx.params;
  const meta = SAMPLE_FILES.find((s) => s.name === name);
  const body = meta ? sampleContent(name) : null;
  if (!meta || !body) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(body), {
    headers: { "content-type": meta.mime, "content-disposition": `${meta.mime === "application/pdf" ? "inline" : "attachment"}; filename="${name}"` },
  });
}
