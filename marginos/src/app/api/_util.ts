import { NextResponse } from "next/server";
import { getActiveBusiness } from "@/lib/business";

export const json = (data: unknown, status = 200) => NextResponse.json(data, { status });
export const fail = (message: string, status = 400) => NextResponse.json({ error: message }, { status });

export class HttpError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export async function requireBusiness() {
  const b = await getActiveBusiness();
  if (!b) throw new HttpError("No business yet — load the demo restaurant or create a workspace first.", 409);
  return b;
}

export function handle<A extends unknown[]>(fn: (...a: A) => Promise<Response>) {
  return async (...a: A) => {
    try {
      return await fn(...a);
    } catch (err) {
      if (err instanceof HttpError) return fail(err.message, err.status);
      console.error("[api]", err);
      return fail(err instanceof Error ? err.message : "Unexpected error", 500);
    }
  };
}
