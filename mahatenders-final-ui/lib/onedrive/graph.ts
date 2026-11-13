import "server-only";

import { getOneDriveAccessToken } from "./msal";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const MAX_WORKBOOK_BYTES = 50 * 1024 * 1024;
const UPLOAD_CHUNK_BYTES = 5 * 1024 * 1024;

export type OneDriveDriveInfo = {
  id: string;
  driveType?: string;
  name?: string;
};

export type OneDriveDriveItem = {
  id: string;
  name: string;
  eTag: string;
  size?: number;
  file?: { mimeType?: string };
  folder?: { childCount?: number };
  parentReference?: { path?: string };
};

export class OneDriveGraphError extends Error {
  constructor(public readonly status: number, message = "Microsoft Graph request failed.") {
    super(message);
    this.name = "OneDriveGraphError";
  }
}

export class OneDriveConflictError extends OneDriveGraphError {
  constructor() {
    super(412, "The OneDrive file changed during the update. Reload it before trying again.");
    this.name = "OneDriveConflictError";
  }
}

async function graphRequest(sessionId: string, url: string, init: RequestInit = {}): Promise<Response> {
  const accessToken = await getOneDriveAccessToken(sessionId);
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${accessToken}`);
  headers.set("Accept", "application/json");
  const response = await fetch(url, { ...init, headers, cache: "no-store" });
  if (response.status === 412) throw new OneDriveConflictError();
  if (response.status === 409) throw new OneDriveConflictError();
  if (!response.ok) throw new OneDriveGraphError(response.status);
  return response;
}

async function graphJson<T>(sessionId: string, url: string, init?: RequestInit): Promise<T> {
  return await (await graphRequest(sessionId, url, init)).json() as T;
}

function encodeDrivePath(path: string): string {
  const segments = path.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
  if (!segments.length || segments.some((part) => part === "." || part === "..")) {
    throw new Error("A valid OneDrive folder path is required.");
  }
  return segments.map(encodeURIComponent).join("/");
}

function assertWorkbook(item: OneDriveDriveItem, fileName: string): OneDriveDriveItem {
  if (!item.file || item.name.toLocaleLowerCase() !== fileName.toLocaleLowerCase() || !item.name.toLocaleLowerCase().endsWith(".xlsx")) {
    throw new Error("The requested OneDrive item is not an .xlsx workbook.");
  }
  if (!item.id || !item.eTag) throw new Error("Microsoft Graph did not return the workbook ID and eTag.");
  return item;
}

export async function verifyOneDriveConnection(sessionId: string): Promise<OneDriveDriveInfo> {
  return await graphJson<OneDriveDriveInfo>(sessionId, `${GRAPH_BASE}/me/drive?$select=id,driveType,name`);
}

export async function findDriveItemByPath(sessionId: string, itemPath: string): Promise<OneDriveDriveItem> {
  const path = encodeDrivePath(itemPath);
  return await graphJson<OneDriveDriveItem>(sessionId, `${GRAPH_BASE}/me/drive/root:/${path}?$select=id,name,eTag,size,file,folder,parentReference`);
}

export async function findWorkbookByFolderAndName(
  sessionId: string,
  folderPath: string,
  fileName: string,
): Promise<OneDriveDriveItem> {
  if (!fileName || fileName.includes("/") || fileName.includes("\\") || fileName === "." || fileName === "..") {
    throw new Error("A valid workbook filename is required.");
  }
  const item = await findDriveItemByPath(sessionId, `${folderPath}/${fileName}`);
  return assertWorkbook(item, fileName);
}

export async function getWorkbookDriveItem(sessionId: string, itemId: string): Promise<OneDriveDriveItem> {
  if (!itemId) throw new Error("A OneDrive item ID is required.");
  return await graphJson<OneDriveDriveItem>(sessionId, `${GRAPH_BASE}/me/drive/items/${encodeURIComponent(itemId)}?$select=id,name,eTag,size,file,parentReference`);
}

async function downloadItemContent(sessionId: string, itemId: string): Promise<Buffer> {
  const accessToken = await getOneDriveAccessToken(sessionId);
  const graphResponse = await fetch(`${GRAPH_BASE}/me/drive/items/${encodeURIComponent(itemId)}/content`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/octet-stream" },
    cache: "no-store",
    redirect: "manual",
  });
  let response = graphResponse;
  if ([301, 302, 303, 307, 308].includes(graphResponse.status)) {
    const location = graphResponse.headers.get("location");
    if (!location || !location.startsWith("https://")) throw new Error("Microsoft Graph returned an invalid workbook download location.");
    response = await fetch(location, { cache: "no-store" });
  }
  if (!response.ok) throw new OneDriveGraphError(response.status, "The OneDrive workbook could not be downloaded.");
  const declaredSize = Number(response.headers.get("content-length") || 0);
  if (declaredSize > MAX_WORKBOOK_BYTES) throw new Error("The workbook exceeds the supported in-memory editing size.");
  const content = Buffer.from(await response.arrayBuffer());
  if (!content.length || content.length > MAX_WORKBOOK_BYTES) throw new Error("The workbook is empty or exceeds the supported in-memory editing size.");
  return content;
}

export type DownloadedWorkbook = { item: OneDriveDriveItem; content: Buffer };

export async function downloadWorkbookContents(
  sessionId: string,
  folderPath: string,
  fileName: string,
): Promise<DownloadedWorkbook> {
  const before = await findWorkbookByFolderAndName(sessionId, folderPath, fileName);
  const content = await downloadItemContent(sessionId, before.id);
  const after = await getWorkbookDriveItem(sessionId, before.id);
  if (before.eTag !== after.eTag) throw new OneDriveConflictError();
  return { item: after, content };
}

export async function downloadWorkbookByItemId(sessionId: string, itemId: string): Promise<DownloadedWorkbook> {
  const before = await getWorkbookDriveItem(sessionId, itemId);
  const content = await downloadItemContent(sessionId, itemId);
  const after = await getWorkbookDriveItem(sessionId, itemId);
  if (before.eTag !== after.eTag) throw new OneDriveConflictError();
  return { item: after, content };
}

export async function uploadWorkbookContentsSafely(
  sessionId: string,
  itemId: string,
  contents: Buffer,
  expectedETag: string,
): Promise<OneDriveDriveItem> {
  if (!itemId || !expectedETag) throw new Error("A workbook item ID and expected eTag are required.");
  if (!contents.length || contents.length > MAX_WORKBOOK_BYTES) throw new Error("The workbook is empty or exceeds the supported upload size.");

  const uploadSession = await graphJson<{ uploadUrl?: string }>(
    sessionId,
    `${GRAPH_BASE}/me/drive/items/${encodeURIComponent(itemId)}/createUploadSession`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "If-Match": expectedETag },
      body: JSON.stringify({ item: { "@microsoft.graph.conflictBehavior": "replace" } }),
    },
  );
  if (!uploadSession.uploadUrl?.startsWith("https://")) throw new Error("Microsoft Graph did not return a valid upload session.");

  const finalItem = await uploadUploadSession(uploadSession.uploadUrl, contents);
  if (finalItem.id !== itemId) throw new Error("Microsoft Graph did not confirm an update to the requested workbook item.");
  return finalItem;
}

export async function uploadNewFileContentsSafely(
  sessionId: string,
  folderPath: string,
  fileName: string,
  contents: Buffer,
): Promise<OneDriveDriveItem> {
  if (!fileName || fileName.includes("/") || fileName.includes("\\") || fileName === "." || fileName === "..") {
    throw new Error("A valid new workbook filename is required.");
  }
  if (!contents.length || contents.length > MAX_WORKBOOK_BYTES) throw new Error("The workbook is empty or exceeds the supported upload size.");
  const folder = await findDriveItemByPath(sessionId, folderPath);
  if (!folder.folder) throw new Error("The configured OneDrive path is not an existing folder.");
  const uploadSession = await graphJson<{ uploadUrl?: string }>(
    sessionId,
    `${GRAPH_BASE}/me/drive/items/${encodeURIComponent(folder.id)}:/${encodeURIComponent(fileName)}:/createUploadSession`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ item: { "@microsoft.graph.conflictBehavior": "fail" } }),
    },
  );
  if (!uploadSession.uploadUrl?.startsWith("https://")) throw new Error("Microsoft Graph did not return a valid upload session.");
  return await uploadUploadSession(uploadSession.uploadUrl, contents);
}

async function uploadUploadSession(uploadUrl: string, contents: Buffer): Promise<OneDriveDriveItem> {
  let finalItem: OneDriveDriveItem | undefined;
  for (let start = 0; start < contents.length; start += UPLOAD_CHUNK_BYTES) {
    const end = Math.min(start + UPLOAD_CHUNK_BYTES, contents.length) - 1;
    const chunk = contents.subarray(start, end + 1);
    const response = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Length": String(chunk.length),
        "Content-Range": `bytes ${start}-${end}/${contents.length}`,
      },
      body: chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) as ArrayBuffer,
      cache: "no-store",
    });
    if (response.status === 412 || response.status === 409) throw new OneDriveConflictError();
    if (![200, 201, 202].includes(response.status)) throw new OneDriveGraphError(response.status, "Microsoft Graph rejected the workbook upload.");
    if (response.status === 200 || response.status === 201) finalItem = await response.json() as OneDriveDriveItem;
  }
  if (!finalItem?.id) throw new Error("Microsoft Graph did not confirm the workbook upload.");
  return finalItem;
}
