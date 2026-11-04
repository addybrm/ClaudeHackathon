import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic check only: no session cookie means sign in first. Every page and API route
 * still validates the session against the database before reading any data.
 */
const PUBLIC = ["/login", "/signup", "/api/auth/", "/icon.svg", "/favicon.ico"];

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(p))) return NextResponse.next();
  if (req.cookies.get("mos_session")) return NextResponse.next();
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  const url = new URL("/login", req.url);
  if (pathname !== "/") url.searchParams.set("next", pathname + req.nextUrl.search);
  return NextResponse.redirect(url);
}

export const config = { matcher: ["/((?!_next/static|_next/image).*)"] };
