import { NextRequest, NextResponse } from "next/server";
import { CryptoProvider } from "@azure/msal-node";
import { GRAPH_SCOPES, isValidOneDriveRedirectUri, readOneDriveConfig } from "@/lib/onedrive/config";
import { cookieOptions, oauthCookieName, newSessionId, sealOAuthTransaction, sessionCookieName } from "@/lib/onedrive/cookies";
import { createOneDriveMsalClient, hasValidOneDriveSession } from "@/lib/onedrive/msal";
import { ensureTokenCacheStoreReady, PersistentTokenCacheRequiredError, TokenCacheEncryptionKeyError, TokenCacheStorageError } from "@/lib/onedrive/token-cache";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const config = readOneDriveConfig();
  if (!config || !isValidOneDriveRedirectUri(config.redirectUri)) {
    return NextResponse.json({ error: "Microsoft sign-in is not configured." }, { status: 503 });
  }
  try {
    await ensureTokenCacheStoreReady();
  } catch (error) {
    if (error instanceof TokenCacheEncryptionKeyError) {
      return NextResponse.json({ error: error.message, status: error.code }, { status: 503 });
    }
    if (error instanceof PersistentTokenCacheRequiredError) {
      return NextResponse.json({ error: "Persistent OneDrive cache storage is not configured.", status: "cache_setup_required" }, { status: 503 });
    }
    if (error instanceof TokenCacheStorageError) {
      return NextResponse.json({ error: error.message, status: "cache_database_unavailable" }, { status: 503 });
    }
    return NextResponse.json({ error: "The OneDrive sign-in cache is unavailable.", status: "cache_unavailable" }, { status: 503 });
  }

  const requestedSessionId = request.cookies.get(sessionCookieName())?.value;
  const currentSessionId = requestedSessionId && /^[A-Za-z0-9_-]{32,128}$/.test(requestedSessionId) ? requestedSessionId : undefined;
  const switchingAccount = request.nextUrl.searchParams.get("switch_account") === "1";
  if (currentSessionId && !switchingAccount) {
    try {
      if (await hasValidOneDriveSession(currentSessionId)) {
        return NextResponse.redirect(new URL("/?onedrive=connected", request.nextUrl.origin));
      }
    } catch (error) {
      if (error instanceof TokenCacheEncryptionKeyError) {
        return NextResponse.json({ error: error.message, status: error.code }, { status: 503 });
      }
      if (error instanceof PersistentTokenCacheRequiredError) {
        return NextResponse.json({ error: "Persistent OneDrive cache storage is not configured." }, { status: 503 });
      }
      if (error instanceof TokenCacheStorageError) {
        return NextResponse.json({ error: error.message, status: "cache_database_unavailable" }, { status: 503 });
      }
      return NextResponse.json({ error: "Microsoft sign-in could not check the saved session." }, { status: 503 });
    }
  }

  const cryptoProvider = new CryptoProvider();
  const { verifier, challenge } = await cryptoProvider.generatePkceCodes();
  const state = cryptoProvider.createNewGuid();
  const nonce = cryptoProvider.createNewGuid();
  const sessionId = switchingAccount || !currentSessionId ? newSessionId() : currentSessionId;
  try {
    const msal = createOneDriveMsalClient(sessionId);
    const authUrl = await msal.getAuthCodeUrl({
      scopes: GRAPH_SCOPES,
      redirectUri: config.redirectUri,
      state,
      nonce,
      codeChallenge: challenge,
      codeChallengeMethod: "S256",
      ...(switchingAccount ? { prompt: "select_account" as const } : {}),
    });

    const response = NextResponse.redirect(authUrl);
    response.cookies.set(oauthCookieName(), sealOAuthTransaction({ state, nonce, verifier, sessionId, ...(switchingAccount && currentSessionId ? { previousSessionId: currentSessionId } : {}), createdAt: Date.now() }), cookieOptions(10 * 60));
    return response;
  } catch (error) {
    if (error instanceof TokenCacheEncryptionKeyError) {
      return NextResponse.json({ error: error.message, status: error.code }, { status: 503 });
    }
    if (error instanceof PersistentTokenCacheRequiredError) {
      return NextResponse.json({ error: "Persistent OneDrive cache storage is not configured." }, { status: 503 });
    }
    if (error instanceof TokenCacheStorageError) {
      return NextResponse.json({ error: error.message, status: "cache_database_unavailable" }, { status: 503 });
    }
    return NextResponse.json({ error: "Microsoft sign-in could not be started." }, { status: 503 });
  }
}
