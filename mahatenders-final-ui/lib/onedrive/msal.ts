import "server-only";

import { ConfidentialClientApplication } from "@azure/msal-node";
import { GRAPH_SCOPES, readOneDriveConfig } from "./config";
import { createTokenCachePlugin, getTokenCacheStore } from "./token-cache";

export function createOneDriveMsalClient(sessionId: string) {
  const config = readOneDriveConfig();
  if (!config) throw new Error("Microsoft sign-in is not configured.");
  const store = getTokenCacheStore();
  return new ConfidentialClientApplication({
    auth: {
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      authority: "https://login.microsoftonline.com/consumers",
    },
    cache: { cachePlugin: createTokenCachePlugin(sessionId, store) },
  });
}

export async function getOneDriveAccessToken(sessionId: string): Promise<string> {
  const client = createOneDriveMsalClient(sessionId);
  const accounts = await client.getTokenCache().getAllAccounts();
  const account = accounts[0];
  if (!account) throw new Error("OneDrive is not connected for this session.");
  const result = await client.acquireTokenSilent({ account, scopes: GRAPH_SCOPES.filter((scope) => scope === "Files.ReadWrite") });
  if (!result?.accessToken) throw new Error("Microsoft did not return an access token.");
  return result.accessToken;
}
