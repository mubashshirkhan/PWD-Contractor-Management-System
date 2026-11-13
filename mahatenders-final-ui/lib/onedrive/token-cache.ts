import "server-only";

import type { ICachePlugin } from "@azure/msal-node";

export class PersistentTokenCacheRequiredError extends Error {
  constructor() {
    super("A persistent encrypted MSAL token cache must be configured before production sign-in.");
    this.name = "PersistentTokenCacheRequiredError";
  }
}

export interface TokenCacheStore {
  get(sessionId: string): Promise<string | undefined>;
  set(sessionId: string, serializedCache: string): Promise<void>;
  delete(sessionId: string): Promise<void>;
}

type CacheGlobal = typeof globalThis & { __archDesignMsalDevCache?: Map<string, string> };
const cacheGlobal = globalThis as CacheGlobal;
const devCache = cacheGlobal.__archDesignMsalDevCache ??= new Map<string, string>();

const developmentStore: TokenCacheStore = {
  async get(sessionId) { return devCache.get(sessionId); },
  async set(sessionId, serializedCache) { devCache.set(sessionId, serializedCache); },
  async delete(sessionId) { devCache.delete(sessionId); },
};

export function getTokenCacheStore(): TokenCacheStore {
  if (process.env.NODE_ENV === "development") return developmentStore;
  throw new PersistentTokenCacheRequiredError();
}

export function createTokenCachePlugin(sessionId: string, store: TokenCacheStore): ICachePlugin {
  return {
    beforeCacheAccess: async (context) => {
      const serialized = await store.get(sessionId);
      if (serialized) context.tokenCache.deserialize(serialized);
    },
    afterCacheAccess: async (context) => {
      if (context.cacheHasChanged) {
        await store.set(sessionId, context.tokenCache.serialize());
      }
    },
  };
}
