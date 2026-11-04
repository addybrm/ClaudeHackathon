import { loadDemo, removeDemo } from "@/lib/demo/seed";
import { handle, json } from "../_util";

/** Load (or reset) the fictional demo restaurant. Idempotent: replaces any existing demo business. */
export const POST = handle(async () => json(await loadDemo()));

export const DELETE = handle(async () => {
  await removeDemo();
  return json({ ok: true });
});
