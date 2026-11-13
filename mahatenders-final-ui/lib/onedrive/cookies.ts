import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const OAUTH_COOKIE = "arch_onedrive_oauth";
const SESSION_COOKIE = "arch_onedrive_session";

export type OAuthTransaction = {
  state: string;
  nonce: string;
  verifier: string;
  sessionId: string;
  createdAt: number;
};

function encryptionKey(): Buffer {
  const secret = process.env.ONEDRIVE_SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("ONEDRIVE_SESSION_SECRET must contain at least 32 characters.");
  return createHash("sha256").update(secret).digest();
}

export function sealOAuthTransaction(value: OAuthTransaction): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString("base64url")).join(".");
}

export function openOAuthTransaction(value: string): OAuthTransaction | null {
  try {
    const [ivValue, tagValue, encryptedValue] = value.split(".");
    if (!ivValue || !tagValue || !encryptedValue) return null;
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivValue, "base64url"));
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(encryptedValue, "base64url")), decipher.final()]).toString("utf8");
    const transaction = JSON.parse(plaintext) as OAuthTransaction;
    if (Date.now() - transaction.createdAt > 10 * 60 * 1000) return null;
    if (![transaction.state, transaction.nonce, transaction.verifier, transaction.sessionId].every((part) => typeof part === "string" && part.length > 0)) return null;
    return transaction;
  } catch {
    return null;
  }
}

export function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

export function oauthCookieName() { return OAUTH_COOKIE; }
export function sessionCookieName() { return SESSION_COOKIE; }
export function newSessionId() { return randomBytes(32).toString("base64url"); }
