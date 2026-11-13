import { NextResponse } from "next/server";
import { CryptoProvider } from "@azure/msal-node";
import { GRAPH_SCOPES, isValidOneDriveRedirectUri, readOneDriveConfig } from "@/lib/onedrive/config";
import { cookieOptions, oauthCookieName, newSessionId, sealOAuthTransaction } from "@/lib/onedrive/cookies";
import { createOneDriveMsalClient } from "@/lib/onedrive/msal";

export const runtime = "nodejs";

export async function GET() {
  const config = readOneDriveConfig();
  if (!config || !isValidOneDriveRedirectUri(config.redirectUri)) {
    return NextResponse.json({ error: "Microsoft sign-in is not configured." }, { status: 503 });
  }

  const cryptoProvider = new CryptoProvider();
  const { verifier, challenge } = await cryptoProvider.generatePkceCodes();
  const state = cryptoProvider.createNewGuid();
  const nonce = cryptoProvider.createNewGuid();
  const sessionId = newSessionId();
  const msal = createOneDriveMsalClient(sessionId);
  const authUrl = await msal.getAuthCodeUrl({
    scopes: GRAPH_SCOPES,
    redirectUri: config.redirectUri,
    state,
    nonce,
    codeChallenge: challenge,
    codeChallengeMethod: "S256",
    prompt: "select_account",
  });

  const response = NextResponse.redirect(authUrl);
  response.cookies.set(oauthCookieName(), sealOAuthTransaction({ state, nonce, verifier, sessionId, createdAt: Date.now() }), cookieOptions(10 * 60));
  return response;
}
