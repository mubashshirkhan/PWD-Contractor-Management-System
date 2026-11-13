import "server-only";

export const GRAPH_SCOPES = ["openid", "profile", "offline_access", "Files.ReadWrite"];

export type OneDriveConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  sessionSecret: string;
  rootFolder: string;
};

const REQUIRED_ENVIRONMENT = [
  "MICROSOFT_CLIENT_ID",
  "MICROSOFT_CLIENT_SECRET",
  "MICROSOFT_REDIRECT_URI",
  "ONEDRIVE_SESSION_SECRET",
] as const;

export function missingOneDriveEnvironment(): string[] {
  return REQUIRED_ENVIRONMENT.filter((key) => !process.env[key]?.trim());
}

export function readOneDriveConfig(): OneDriveConfig | null {
  if (missingOneDriveEnvironment().length > 0) return null;
  return {
    clientId: process.env.MICROSOFT_CLIENT_ID!.trim(),
    clientSecret: process.env.MICROSOFT_CLIENT_SECRET!.trim(),
    redirectUri: process.env.MICROSOFT_REDIRECT_URI!.trim(),
    sessionSecret: process.env.ONEDRIVE_SESSION_SECRET!,
    rootFolder: process.env.ONEDRIVE_ROOT_FOLDER?.trim() || "Arch Design Studio",
  };
}

export function isValidOneDriveRedirectUri(value: string): boolean {
  try {
    const uri = new URL(value);
    return uri.protocol === "https:" || (uri.protocol === "http:" && ["localhost", "127.0.0.1"].includes(uri.hostname));
  } catch {
    return false;
  }
}
