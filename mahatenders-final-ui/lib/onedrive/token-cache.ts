import "server-only";

import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, stat, unlink, utimes, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ICachePlugin } from "@azure/msal-node";

export class PersistentTokenCacheRequiredError extends Error {
  constructor() {
    super("A persistent encrypted MSAL token cache must be configured before sign-in.");
    this.name = "PersistentTokenCacheRequiredError";
  }
}

export class TokenCacheStorageError extends Error {
  constructor() {
    super("The encrypted Microsoft sign-in cache is unavailable.");
    this.name = "TokenCacheStorageError";
  }
}

export interface TokenCacheStore {
  get(sessionId: string): Promise<string | undefined>;
  set(sessionId: string, serializedCache: string): Promise<void>;
  delete(sessionId: string): Promise<void>;
}

const CACHE_FORMAT = "v1";
const CACHE_INACTIVITY_MS = 30 * 24 * 60 * 60 * 1000;

function cacheDirectory(): string {
  const base = process.platform === "win32"
    ? join(homedir(), "AppData", "Local")
    : join(homedir(), ".local", "share");
  return join(base, "Arch Design Studio", "onedrive-msal-cache");
}

function sessionFile(sessionId: string): string {
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(sessionId)) throw new TokenCacheStorageError();
  const name = createHmac("sha256", "Arch Design Studio MSAL cache filename v1")
    .update(sessionId)
    .digest("hex");
  return join(cacheDirectory(), `${name}.cache`);
}

function encryptionKey(): Buffer {
  const secret = process.env.ONEDRIVE_SESSION_SECRET;
  if (!secret || secret.length < 32) throw new PersistentTokenCacheRequiredError();
  return createHmac("sha256", secret).update("Arch Design Studio MSAL cache encryption v1").digest();
}

function encrypt(serializedCache: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(serializedCache, "utf8"), cipher.final()]);
  return [CACHE_FORMAT, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

function decrypt(value: string): string {
  const [format, ivValue, tagValue, encryptedValue, ...extra] = value.split(".");
  if (format !== CACHE_FORMAT || !ivValue || !tagValue || !encryptedValue || extra.length) throw new Error("Invalid token cache format.");
  const iv = Buffer.from(ivValue, "base64url");
  const tag = Buffer.from(tagValue, "base64url");
  const encrypted = Buffer.from(encryptedValue, "base64url");
  if (iv.length !== 12 || tag.length !== 16 || !encrypted.length) throw new Error("Invalid token cache payload.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

const persistentStore: TokenCacheStore = {
  async get(sessionId) {
    const file = sessionFile(sessionId);
    try {
      const metadata = await stat(file);
      if (Date.now() - metadata.mtimeMs > CACHE_INACTIVITY_MS) {
        await unlink(file);
        return undefined;
      }
      const encrypted = await readFile(file, "utf8");
      try {
        const serialized = decrypt(encrypted);
        const accessedAt = new Date();
        await utimes(file, accessedAt, accessedAt);
        return serialized;
      } catch (error) {
        if (error instanceof PersistentTokenCacheRequiredError) throw error;
        await unlink(file).catch((unlinkError) => { if (!isMissingFile(unlinkError)) throw unlinkError; });
        return undefined;
      }
    } catch (error) {
      if (isMissingFile(error)) return undefined;
      if (error instanceof PersistentTokenCacheRequiredError || error instanceof TokenCacheStorageError) throw error;
      throw new TokenCacheStorageError();
    }
  },

  async set(sessionId, serializedCache) {
    const file = sessionFile(sessionId);
    const directory = cacheDirectory();
    const temporaryFile = `${file}.${randomBytes(8).toString("hex")}.tmp`;
    try {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      if (process.platform !== "win32") await chmod(directory, 0o700);
      await writeFile(temporaryFile, encrypt(serializedCache), { encoding: "utf8", mode: 0o600, flag: "wx" });
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

export function getTokenCacheStore(): TokenCacheStore {
  if (process.env.NODE_ENV !== "development") throw new PersistentTokenCacheRequiredError();
  return persistentStore;
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
