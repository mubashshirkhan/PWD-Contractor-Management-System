import { NextRequest, NextResponse } from "next/server";
import { cookieOptions, sessionCookieName } from "@/lib/onedrive/cookies";
import { getTokenCacheStore, PersistentTokenCacheRequiredError, TokenCacheEncryptionKeyError, TokenCacheStorageError } from "@/lib/onedrive/token-cache";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }
  const sessionId = request.cookies.get(sessionCookieName())?.value;
  if (sessionId) {
    try {
      await getTokenCacheStore().delete(sessionId);
    } catch (error) {
      if (error instanceof TokenCacheEncryptionKeyError) {
        return NextResponse.json({ error: error.message, status: error.code }, { status: 503 });
      }
      if (error instanceof PersistentTokenCacheRequiredError || error instanceof TokenCacheStorageError) {
        return NextResponse.json({ error: "The saved OneDrive session could not be cleared. Please retry." }, { status: 503 });
      }
      throw error;
    }
  }
  const response = NextResponse.json({ status: "disconnected" });
  response.cookies.set(sessionCookieName(), "", cookieOptions(0));
  return response;
}
