import { destroySession } from "@/lib/auth";
import { handle, json } from "../../_util";

export const POST = handle(async () => {
  await destroySession();
  return json({ ok: true });
});
