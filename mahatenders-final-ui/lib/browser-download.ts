"use client";

function safeFilename(value: string | undefined, fallback: string): string {
  const normalized = (value || fallback)
    .replace(/^.*[\\/]/, "")
    .replace(/[<>:\"|?*\u0000-\u001f]/g, "_")
    .trim();
  return normalized && normalized !== "." ? normalized : fallback;
}

function responseFilename(response: Response, fallback: string): string {
  const disposition = response.headers.get("content-disposition") ?? "";
  const encoded = disposition.match(/filename\*\s*=\s*UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try {
      return safeFilename(decodeURIComponent(encoded.trim().replace(/^"|"$/g, "")), fallback);
    } catch {
      // Fall back to the plain filename header when the encoded value is invalid.
    }
  }
  const plain = disposition.match(/filename\s*=\s*(?:"((?:\\.|[^"])*)"|([^;]*))/i);
  const filename = plain?.[1]?.replace(/\\(.)/g, "$1") ?? plain?.[2]?.trim();
  return safeFilename(filename, fallback);
}

async function responseError(response: Response, fallback: string): Promise<Error> {
  const body = await response.text().catch(() => "");
  try {
    const parsed = JSON.parse(body) as { error?: unknown; message?: unknown };
    if (typeof parsed.error === "string") return new Error(parsed.error);
    if (typeof parsed.message === "string") return new Error(parsed.message);
  } catch {
    // Non-JSON error bodies should not be shown raw in the UI.
  }
  return new Error(`${fallback} (HTTP ${response.status}).`);
}

export async function downloadFileResponse(response: Response, fallbackFilename: string): Promise<void> {
  if (!response.ok) throw await responseError(response, "The file could not be downloaded");

  const blob = await response.blob();
  if (!blob.size) throw new Error("The downloaded file was empty.");

  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = responseFilename(response, fallbackFilename);
  link.hidden = true;
  document.body.appendChild(link);
  link.click();
  link.remove();

  // Keep the object URL alive long enough for the browser to begin the download.
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}
