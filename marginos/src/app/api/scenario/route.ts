import { z } from "zod";
import { priceScenarioForItem } from "@/lib/finance/engine";
import { isPeriodKey, period } from "@/lib/finance/period";
import { fail, handle, json, requireBusiness } from "../_util";

const Body = z.object({
  period: z.string().refine(isPeriodKey),
  menuItemId: z.string().uuid(),
  newPriceGross: z.number().positive().max(500),
  channel: z.enum(["dine_in", "collection", "delivery"]),
  demandChangePct: z.number().min(-100).max(200).default(0),
});

export const POST = handle(async (req: Request) => {
  const b = await requireBusiness();
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(p.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  return json(await priceScenarioForItem(b, period(p.data.period), p.data));
});
