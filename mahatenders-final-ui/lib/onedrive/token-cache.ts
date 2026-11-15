import "server-only";

import { neonConfig, Pool, type PoolClient } from "@neondatabase/serverless";
import { attachDatabasePool } from "@vercel/functions";
import WebSocket from "ws";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, stat, unlink, utimes, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ICachePlugin } from "@azure/msal-node";

export class PersistentTokenCacheRequiredError extends Error {
  constructor() {
    super("Durable encrypted Microsoft sign-in cache configuration is required.");
    this.name = "PersistentTokenCacheRequiredError";
  }
}

export class TokenCacheStorageError extends Error {
  constructor() {
    super("The encrypted Microsoft sign-in cache is unavailable.");
    this.name = "TokenCacheStorageError";
  }
}

export type TokenCacheEncryptionKeyErrorCode =
  | "cache_encryption_key_missing"
  | "cache_encryption_key_invalid_base64"
  | "cache_encryption_key_invalid_length";

const encryptionKeyMessages: Record<TokenCacheEncryptionKeyErrorCode, string> = {
  cache_encryption_key_missing: "The server-side OneDrive cache encryption key is missing.",
  cache_encryption_key_invalid_base64: "The server-side OneDrive cache encryption key must be valid Base64.",
  cache_encryption_key_invalid_length: "The server-side OneDrive cache encryption key must decode to exactly 32 bytes.",
};

export class TokenCacheEncryptionKeyError extends Error {
  constructor(readonly code: TokenCacheEncryptionKeyErrorCode) {
    super(encryptionKeyMessages[code]);
    this.name = "TokenCacheEncryptionKeyError";
  }
}

type CacheLease = {
  serializedCache?: string;
  save(serializedCache: string): Promise<void>;
  clear(): Promise<void>;
  release(commit: boolean): Promise<void>;
};

export interface TokenCacheStore {
  get(sessionId: string): Promise<string | undefined>;
  set(sessionId: string, serializedCache: string): Promise<void>;
  delete(sessionId: string): Promise<void>;
  acquire(sessionId: string): Promise<CacheLease>;
  ensureReady(): Promise<void>;
}

const FILE_CACHE_FORMAT = "v1";
const DATABASE_CACHE_FORMAT = "v2";
const CACHE_INACTIVITY_MS = 30 * 24 * 60 * 60 * 1000;
const CACHE_TABLE = "app_auth.msal_token_cache";

neonConfig.webSocketConstructor = WebSocket;

function discardPoolClient(client: PoolClient, error: unknown): void {
  // Neon PoolClient.release(error) removes the client instead of returning it
  // to the pool. Do not let a release cleanup error replace the query error.
  try {
    client.release(error instanceof Error ? error : true);
  } catch {
    // The release attempt is made exactly once; the original operation error wins.
  }
}

function cacheDirectory(): string {
  const base = process.platform === "win32"
    ? join(homedir(), "AppData", "Local")
    : join(homedir(), ".local", "share");
  return join(base, "Arch Design Studio", "onedrive-msal-cache");
}

function validateSessionId(sessionId: string): void {
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(sessionId)) throw new TokenCacheStorageError();
}

function sessionFile(sessionId: string): string {
  validateSessionId(sessionId);
  const name = createHmac("sha256", "Arch Design Studio MSAL cache filename v1")
    .update(sessionId)
    .digest("hex");
  return join(cacheDirectory(), `${name}.cache`);
}

function localEncryptionKey(): Buffer {
  const secret = process.env.ONEDRIVE_SESSION_SECRET;
  if (!secret || secret.length < 32) throw new PersistentTokenCacheRequiredError();
  return createHmac("sha256", secret).update("Arch Design Studio MSAL cache encryption v1").digest();
}

function databaseEncryptionKey(): Buffer {
  const configured = process.env.ONEDRIVE_CACHE_ENCRYPTION_KEY?.trim();
  if (!configured) throw new TokenCacheEncryptionKeyError("cache_encryption_key_missing");
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(configured)) {
    throw new TokenCacheEncryptionKeyError("cache_encryption_key_invalid_base64");
  }
  const key = Buffer.from(configured, "base64");
  if (key.toString("base64") !== configured) throw new TokenCacheEncryptionKeyError("cache_encryption_key_invalid_base64");
  if (key.length !== 32) throw new TokenCacheEncryptionKeyError("cache_encryption_key_invalid_length");
  return key;
}

function encryptLocal(serializedCache: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", localEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(serializedCache, "utf8"), cipher.final()]);
  return [FILE_CACHE_FORMAT, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

function decryptLocal(value: string): string {
  const [format, ivValue, tagValue, encryptedValue, ...extra] = value.split(".");
  if (format !== FILE_CACHE_FORMAT || !ivValue || !tagValue || !encryptedValue || extra.length) throw new Error("Invalid token cache format.");
  const iv = Buffer.from(ivValue, "base64url");
  const tag = Buffer.from(tagValue, "base64url");
  const encrypted = Buffer.from(encryptedValue, "base64url");
  if (iv.length !== 12 || tag.length !== 16 || !encrypted.length) throw new Error("Invalid token cache payload.");
  const decipher = createDecipheriv("aes-256-gcm", localEncryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

function sessionLookupKey(sessionId: string): string {
  validateSessionId(sessionId);
  return createHash("sha256").update(sessionId, "utf8").digest("hex");
}

function isTokenCacheConfigurationError(error: unknown): error is PersistentTokenCacheRequiredError | TokenCacheEncryptionKeyError {
  return error instanceof PersistentTokenCacheRequiredError || error instanceof TokenCacheEncryptionKeyError;
}

function encryptDatabaseCache(sessionId: string, serializedCache: string): string {
  const lookupKey = sessionLookupKey(sessionId);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", databaseEncryptionKey(), iv);
  cipher.setAAD(Buffer.from(lookupKey, "utf8"));
  const encrypted = Buffer.concat([cipher.update(serializedCache, "utf8"), cipher.final()]);
  return [DATABASE_CACHE_FORMAT, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

function decryptDatabaseCache(sessionId: string, value: string): string {
  const [format, ivValue, tagValue, encryptedValue, ...extra] = value.split(".");
  if (format !== DATABASE_CACHE_FORMAT || !ivValue || !tagValue || !encryptedValue || extra.length) throw new Error("Invalid token cache format.");
  const iv = Buffer.from(ivValue, "base64url");
  const tag = Buffer.from(tagValue, "base64url");
  const encrypted = Buffer.from(encryptedValue, "base64url");
  if (iv.length !== 12 || tag.length !== 16 || !encrypted.length) throw new Error("Invalid token cache payload.");
  const decipher = createDecipheriv("aes-256-gcm", databaseEncryptionKey(), iv);
  decipher.setAAD(Buffer.from(sessionLookupKey(sessionId), "utf8"));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

const localPersistentStore: TokenCacheStore = {
  async ensureReady() {},

  async acquire(sessionId) {
    const file = sessionFile(sessionId);
    let serializedCache: string | undefined;
    try {
      const metadata = await stat(file);
      if (Date.now() - metadata.mtimeMs <= CACHE_INACTIVITY_MS) {
        try {
          serializedCache = decryptLocal(await readFile(file, "utf8"));
          const accessedAt = new Date();
          await utimes(file, accessedAt, accessedAt);
        } catch (error) {
          if (error instanceof PersistentTokenCacheRequiredError) throw error;
          await unlink(file).catch((unlinkError) => { if (!isMissingFile(unlinkError)) throw unlinkError; });
        }
      } else {
        await unlink(file);
      }
    } catch (error) {
      if (!isMissingFile(error)) {
        if (error instanceof PersistentTokenCacheRequiredError || error instanceof TokenCacheStorageError) throw error;
        throw new TokenCacheStorageError();
      }
    }
    return {
      serializedCache,
      save: (value) => localPersistentStore.set(sessionId, value),
      clear: () => localPersistentStore.delete(sessionId),
      release: async () => undefined,
    };
  },

  async get(sessionId) {
    const lease = await localPersistentStore.acquire(sessionId);
    await lease.release(true);
    return lease.serializedCache;
  },

  async set(sessionId, serializedCache) {
    const file = sessionFile(sessionId);
    const directory = cacheDirectory();
    const temporaryFile = `${file}.${randomBytes(8).toString("hex")}.tmp`;
    try {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      if (process.platform !== "win32") await chmod(directory, 0o700);
      await writeFile(temporaryFile, encryptLocal(serializedCache), { encoding: "utf8", mode: 0o600, flag: "wx" });
      await rename(temporaryFile, file);
      if (process.platform !== "win32") await chmod(file, 0o600);
    } catch (error) {
      await unlink(temporaryFile).catch(() => undefined);
      if (error instanceof PersistentTokenCacheRequiredError || error instanceof TokenCacheStorageError) throw error;
      throw new TokenCacheStorageError();
    }
  },

  async delete(sessionId) {
    try {
      await unlink(sessionFile(sessionId));
    } catch (error) {
      if (!isMissingFile(error)) throw new TokenCacheStorageError();
    }
  },
};

type CachePool = Pool & { __archCachePool?: true };
const globalPool = globalThis as typeof globalThis & { __archOneDriveCachePool?: CachePool };

function getDatabasePool(): Pool {
  // Validate before pool construction so bad key configuration fails before OAuth starts.
  databaseEncryptionKey();
  const connectionString = process.env.ONEDRIVE_TOKEN_CACHE_DATABASE_URL?.trim();
  if (!connectionString) throw new PersistentTokenCacheRequiredError();
  if (!globalPool.__archOneDriveCachePool) {
    const pool = new Pool({ connectionString, max: 2, connectionTimeoutMillis: 8_000, idleTimeoutMillis: 5_000 });
    // Neon Pool implements the pg-compatible release/options interface that Vercel
    // uses to keep an invocation alive until its idle timeout releases clients.
    // Keep this singleton open across requests; Vercel closes only idle clients on suspension.
    if (process.env.VERCEL === "1") {
      attachDatabasePool(pool as unknown as Parameters<typeof attachDatabasePool>[0]);
    }
    globalPool.__archOneDriveCachePool = Object.assign(pool, { __archCachePool: true as const });
  }
  return globalPool.__archOneDriveCachePool;
}

const databaseStore: TokenCacheStore = {
  async ensureReady() {
    try {
      await getDatabasePool().query(`SELECT 1 FROM ${CACHE_TABLE} LIMIT 0`);
    } catch (error) {
      if (error instanceof PersistentTokenCacheRequiredError || error instanceof TokenCacheEncryptionKeyError) throw error;
      if (typeof error === "object" && error !== null && "code" in error && error.code === "42P01") {
        throw new PersistentTokenCacheRequiredError();
      }
      throw new TokenCacheStorageError();
    }
  },

  async acquire(sessionId) {
    const lookupKey = sessionLookupKey(sessionId);
    const client: PoolClient = await getDatabasePool().connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO ${CACHE_TABLE} (session_key) VALUES ($1) ON CONFLICT (session_key) DO NOTHING`,
        [lookupKey],
      );
      const result = await client.query<{ cache_ciphertext: string | null; last_accessed_at: Date | string }>(
        `SELECT cache_ciphertext, last_accessed_at FROM ${CACHE_TABLE} WHERE session_key = $1 FOR UPDATE`,
        [lookupKey],
      );
      const row = result.rows[0];
      if (!row) throw new Error("Cache row could not be locked.");

      const lastAccessedAt = new Date(row.last_accessed_at).getTime();
      let serializedCache: string | undefined;
      if (row.cache_ciphertext && Number.isFinite(lastAccessedAt) && Date.now() - lastAccessedAt <= CACHE_INACTIVITY_MS) {
        try {
          serializedCache = decryptDatabaseCache(sessionId, row.cache_ciphertext);
        } catch {
          // Treat an unreadable entry as disconnected and allow a fresh sign-in.
        }
      }

      if (!serializedCache && row.cache_ciphertext) {
        await client.query(`UPDATE ${CACHE_TABLE} SET cache_ciphertext = NULL, updated_at = now() WHERE session_key = $1`, [lookupKey]);
      }
      await client.query(`UPDATE ${CACHE_TABLE} SET last_accessed_at = now() WHERE session_key = $1`, [lookupKey]);

      let released = false;
      return {
        serializedCache,
        save: async (value) => {
          await client.query(
            `UPDATE ${CACHE_TABLE} SET cache_ciphertext = $2, updated_at = now(), last_accessed_at = now() WHERE session_key = $1`,
            [lookupKey, encryptDatabaseCache(sessionId, value)],
          );
        },
        clear: async () => {
          await client.query(`UPDATE ${CACHE_TABLE} SET cache_ciphertext = NULL, updated_at = now(), last_accessed_at = now() WHERE session_key = $1`, [lookupKey]);
        },
        release: async (commit) => {
          if (released) return;
          released = true;
          try {
            await client.query(commit ? "COMMIT" : "ROLLBACK");
          } catch (error) {
            // COMMIT can fail after the server has changed transaction state, so
            // never return this client as healthy. A failed ROLLBACK is equally uncertain.
            discardPoolClient(client, error);
            throw error;
          }
          client.release();
        },
      };
    } catch (error) {
      let rollbackFailed = false;
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        rollbackFailed = true;
        discardPoolClient(client, rollbackError);
      }
      if (!rollbackFailed) {
        try {
          client.release();
        } catch {
          // Keep the original query error; do not attempt a second release.
        }
      }
      if (typeof error === "object" && error !== null && "code" in error && error.code === "42P01") {
        throw new PersistentTokenCacheRequiredError();
      }
      throw new TokenCacheStorageError();
    }
  },

  async get(sessionId) {
    const lease = await databaseStore.acquire(sessionId);
    try {
      await lease.release(true);
      return lease.serializedCache;
    } catch {
      await lease.release(false).catch(() => undefined);
      throw new TokenCacheStorageError();
    }
  },

  async set(sessionId, serializedCache) {
    const lease = await databaseStore.acquire(sessionId);
    try {
      await lease.save(serializedCache);
      await lease.release(true);
    } catch (error) {
      await lease.release(false).catch(() => undefined);
      throw isTokenCacheConfigurationError(error) ? error : new TokenCacheStorageError();
    }
  },

  async delete(sessionId) {
    const lease = await databaseStore.acquire(sessionId);
    try {
      await lease.clear();
      await lease.release(true);
    } catch {
      await lease.release(false).catch(() => undefined);
      throw new TokenCacheStorageError();
    }
  },
};

export function getTokenCacheStore(): TokenCacheStore {
  if (process.env.NODE_ENV === "development" && !process.env.ONEDRIVE_TOKEN_CACHE_DATABASE_URL?.trim()) {
    return localPersistentStore;
  }
  if (!process.env.ONEDRIVE_TOKEN_CACHE_DATABASE_URL?.trim()) {
    throw new PersistentTokenCacheRequiredError();
  }
  databaseEncryptionKey();
  return databaseStore;
}

export async function ensureTokenCacheStoreReady(): Promise<void> {
  await getTokenCacheStore().ensureReady();
}

export function createTokenCachePlugin(sessionId: string, store: TokenCacheStore): ICachePlugin {
  const leases = new WeakMap<object, CacheLease>();
  return {
    beforeCacheAccess: async (context) => {
      let lease: CacheLease;
      try {
        lease = await store.acquire(sessionId);
        leases.set(context, lease);
        if (lease.serializedCache) {
          try {
            context.tokenCache.deserialize(lease.serializedCache);
          } catch {
            await lease.clear();
          }
        }
      } catch (error) {
        const pendingLease = leases.get(context);
        if (pendingLease) await pendingLease.release(false).catch(() => undefined);
        throw error instanceof TokenCacheStorageError || isTokenCacheConfigurationError(error) ? error : new TokenCacheStorageError();
      }
    },
    afterCacheAccess: async (context) => {
      const lease = leases.get(context);
      leases.delete(context);
      if (!lease) throw new TokenCacheStorageError();
      try {
        if (context.cacheHasChanged) await lease.save(context.tokenCache.serialize());
        await lease.release(true);
      } catch (error) {
        await lease.release(false).catch(() => undefined);
        throw error instanceof TokenCacheStorageError || isTokenCacheConfigurationError(error) ? error : new TokenCacheStorageError();
      }
    },
  };
}
