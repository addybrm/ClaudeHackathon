import { z } from "zod";
import { investigate, type InvestigationEvent } from "@/lib/ai/investigator";
import { getActiveBusiness } from "@/lib/business";
import { isPeriodKey } from "@/lib/finance/period";

const Body = z.object({
  question: z.string().trim().min(3).max(1000),
  period: z.string().refine(isPeriodKey).optional(),
  history: z.array(z.object({ question: z.string().max(1000), finding: z.string().max(1000) })).max(6).optional(),
  forceDemo: z.boolean().optional(),
});

export const maxDuration = 300;

/** Streams investigation progress as newline-delimited JSON events. */
export async function POST(req: Request) {
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return Response.json({ error: "Ask a question of at least 3 characters." }, { status: 400 });
  const b = await getActiveBusiness();
  if (!b) return Response.json({ error: "No business yet — load the demo restaurant first." }, { status: 409 });
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (e: InvestigationEvent) => controller.enqueue(enc.encode(JSON.stringify(e) + "\n"));
      try {
        await investigate(b, p.data.question, { periodKey: p.data.period, history: p.data.history, forceDemo: p.data.forceDemo }, emit);
      } catch (err) {
        console.error("[investigate]", err);
        emit({ type: "error", message: err instanceof Error ? err.message : String(err) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" } });
}
