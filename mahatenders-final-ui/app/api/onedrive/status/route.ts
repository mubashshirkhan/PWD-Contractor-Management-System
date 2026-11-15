import { NextRequest, NextResponse } from "next/server";
import { missingOneDriveEnvironment, readOneDriveConfig } from "@/lib/onedrive/config";
import { sessionCookieName } from "@/lib/onedrive/cookies";
import { verifyOneDriveConnection } from "@/lib/onedrive/graph";
import { ensureTokenCacheStoreReady, PersistentTokenCacheRequiredError, TokenCacheEncryptionKeyError, TokenCacheStorageError } from "@/lib/onedrive/token-cache";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const missing = missingOneDriveEnvironment();
  if (missing.length) return NextResponse.json({ status: "setup_required", missing });
  if (!readOneDriveConfig()) return NextResponse.json({ status: "setup_required" });
  try {
    await ensureTokenCacheStoreReady();
  } catch (error) {
    if (error instanceof TokenCacheEncryptionKeyError) {
      return NextResponse.json({ status: error.code, message: error.message }, { status: 503 });
    }
    if (error instanceof PersistentTokenCacheRequiredError) return NextResponse.json({ status: "cache_setup_required" }, { status: 503 });
    if (error instanceof TokenCacheStorageError) return NextResponse.json({ status: "cache_database_unavailable", message: error.message }, { status: 503 });
    return NextResponse.json({ status: "cache_unavailable" }, { status: 503 });
  }
  const sessionId = request.cookies.get(sessionCookieName())?.value;
  if (!sessionId) return NextResponse.json({ status: "disconnected" });

  try {
    const drive = await verifyOneDriveConnection(sessionId);
    return NextResponse.json({ status: "connected", driveType: drive.driveType ?? null });
  } catch (error) {
    if (error instanceof PersistentTokenCacheRequiredError) return NextResponse.json({ status: "cache_setup_required" }, { status: 503 });
    if (error instanceof TokenCacheStorageError) return NextResponse.json({ status: "cache_database_unavailable", message: error.message }, { status: 503 });
    return NextResponse.json({ status: "reconnect_required" }, { status: 401 });
  }
}
