import { NextRequest, NextResponse } from "next/server";
import { cookieOptions, sessionCookieName } from "@/lib/onedrive/cookies";
import { getTokenCacheStore } from "@/lib/onedrive/token-cache";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }
  const sessionId = request.cookies.get(sessionCookieName())?.value;
  if (sessionId && process.env.NODE_ENV === "development") {
    const store = getTokenCacheStore();
    await store.delete(sessionId);
  }
  const response = NextResponse.json({ status: "disconnected" });
  response.cookies.set(sessionCookieName(), "", cookieOptions(0));
  return response;
}
