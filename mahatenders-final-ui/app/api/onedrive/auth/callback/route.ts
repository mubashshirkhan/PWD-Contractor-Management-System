import { NextRequest, NextResponse } from "next/server";
import { GRAPH_SCOPES, isValidOneDriveRedirectUri, readOneDriveConfig } from "@/lib/onedrive/config";
import { cookieOptions, oauthCookieName, openOAuthTransaction, sessionCookieName } from "@/lib/onedrive/cookies";
import { createOneDriveMsalClient } from "@/lib/onedrive/msal";

export const runtime = "nodejs";

function finish(request: NextRequest, result: "connected" | "error") {
  const response = NextResponse.redirect(new URL(`/?onedrive=${result}`, request.nextUrl.origin));
  response.cookies.set(oauthCookieName(), "", cookieOptions(0));
  return response;
}

export async function GET(request: NextRequest) {
  const config = readOneDriveConfig();
  const transactionValue = request.cookies.get(oauthCookieName())?.value;
  const transaction = transactionValue ? openOAuthTransaction(transactionValue) : null;
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");

  if (!config || !isValidOneDriveRedirectUri(config.redirectUri) || !transaction || !code || !state || state !== transaction.state) {
    return finish(request, "error");
  }
  if (request.nextUrl.searchParams.has("error")) return finish(request, "error");

  try {
    const msal = createOneDriveMsalClient(transaction.sessionId);
    const result = await msal.acquireTokenByCode({
      code,
      scopes: GRAPH_SCOPES,
      redirectUri: config.redirectUri,
      codeVerifier: transaction.verifier,
      nonce: transaction.nonce,
    });
    if (!result?.account) return finish(request, "error");

    const response = finish(request, "connected");
    response.cookies.set(sessionCookieName(), transaction.sessionId, cookieOptions(60 * 60 * 24 * 30));
    return response;
  } catch {
    return finish(request, "error");
  }
}
