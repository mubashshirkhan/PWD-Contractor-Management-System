import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { readOneDriveConfig } from "@/lib/onedrive/config";
import { sessionCookieName } from "@/lib/onedrive/cookies";
import {
  downloadWorkbookByItemId,
  downloadWorkbookContents,
  OneDriveConflictError,
  OneDriveGraphError,
  uploadWorkbookContentsSafely,
} from "@/lib/onedrive/graph";
import { createWorksheet, openWorkbook, serializeWorkbook } from "@/lib/onedrive/workbook";

export const runtime = "nodejs";

type TestRunGlobal = typeof globalThis & { __archOneDriveWorkbookTestRuns?: Map<string, "running" | "finished"> };
const testRunGlobal = globalThis as TestRunGlobal;
const testRuns = testRunGlobal.__archOneDriveWorkbookTestRuns ??= new Map();

export async function GET() {
  if (process.env.NODE_ENV !== "development") return new NextResponse(null, { status: 404 });
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OneDrive workbook verification</title><style>body{font:16px system-ui;max-width:720px;margin:4rem auto;padding:0 1rem;color:#222}button{padding:.7rem 1rem;background:#9b5a36;color:white;border:0;border-radius:6px;font:inherit;cursor:pointer}button:disabled{opacity:.6}pre{white-space:pre-wrap;background:#f3f3f3;padding:1rem;border-radius:6px}</style></head><body><h1>OneDrive workbook verification</h1><p>This local-only check adds a unique temporary worksheet to <strong>test.xlsx</strong>, downloads it to verify the value, and removes the temporary worksheet with an eTag-protected update.</p><button id="run">Run verification</button><pre id="result" aria-live="polite"></pre><script>const button=document.querySelector('#run');button.addEventListener('click',async()=>{button.disabled=true;const out=document.querySelector('#result');out.textContent='Running…';try{const response=await fetch(location.pathname,{method:'POST',credentials:'same-origin'});const body=await response.json();out.textContent=JSON.stringify(body,null,2);if(!response.ok)button.disabled=false;}catch{out.textContent='Request failed. Check the local Next.js server output.';button.disabled=false;}});</script></body></html>`;
  return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV !== "development") return new NextResponse(null, { status: 404 });
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  const protocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || request.nextUrl.protocol.replace(":", "");
  const hostOrigin = host ? `${protocol}://${host}` : "";
  if (!origin || (origin !== request.nextUrl.origin && origin !== hostOrigin)) {
    return NextResponse.json({ status: "failed", message: "Request origin was rejected." }, { status: 403 });
  }

  const sessionId = request.cookies.get(sessionCookieName())?.value;
  const config = readOneDriveConfig();
  if (!sessionId || !config) return NextResponse.json({ status: "failed", message: "Connect OneDrive in this browser session first." }, { status: 401 });
  if (testRuns.has(sessionId)) return NextResponse.json({ status: "already_run", message: "The one-time test for this local OneDrive session has already started." }, { status: 409 });
  testRuns.set(sessionId, "running");

  let fileId: string | undefined;
  let testSheetName: string | undefined;
  const marker = `onedrive-test-${randomUUID()}`;
  let originalSheetNames: string[] = [];
  let writeConfirmed = false;
  let readBackConfirmed = false;
  let cleanupConfirmed = false;
  let responseStatus = 200;
  let result: Record<string, unknown> = { status: "failed", message: "The OneDrive workbook verification failed." };

  try {
    const original = await downloadWorkbookContents(sessionId, config.rootFolder, "test.xlsx");
    fileId = original.item.id;
    const workbook = await openWorkbook(original.content);
    originalSheetNames = workbook.worksheets.map((worksheet) => worksheet.name);
    testSheetName = `OD_Test_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
    const testSheet = createWorksheet(workbook, testSheetName);
    testSheet.getCell("A1").value = marker;

    const updated = await serializeWorkbook(workbook);
    await uploadWorkbookContentsSafely(sessionId, fileId, updated, original.item.eTag);
    writeConfirmed = true;

    const readBack = await downloadWorkbookByItemId(sessionId, fileId);
    const readWorkbook = await openWorkbook(readBack.content);
    readBackConfirmed = readWorkbook.getWorksheet(testSheetName)?.getCell("A1").value === marker;
    if (!readBackConfirmed) throw new Error("The uploaded test value did not match on readback.");
    result = {
      status: "verified",
      file: "test.xlsx",
      located: true,
      downloadedBytes: original.content.length,
      uploaded: true,
      readBack: marker,
      temporaryWorksheet: testSheetName,
    };
  } catch (error) {
    if (error instanceof OneDriveConflictError) {
      responseStatus = 409;
      result = { status: "conflict", message: "The workbook changed concurrently; no stale update was applied." };
    } else if (error instanceof OneDriveGraphError && error.status === 404) {
      responseStatus = 404;
      result = { status: "failed", message: "test.xlsx was not found at the configured OneDrive folder path." };
    } else {
      responseStatus = 502;
      result = { status: "failed", message: "The OneDrive workbook verification failed." };
    }
  } finally {
    if (writeConfirmed && fileId && testSheetName) {
      try {
        const latest = await downloadWorkbookByItemId(sessionId, fileId);
        const latestWorkbook = await openWorkbook(latest.content);
        const temporarySheet = latestWorkbook.getWorksheet(testSheetName);
        if (temporarySheet && temporarySheet.getCell("A1").value === marker) {
          latestWorkbook.removeWorksheet(temporarySheet.id);
          await uploadWorkbookContentsSafely(sessionId, fileId, await serializeWorkbook(latestWorkbook), latest.item.eTag);
        }
        const finalDownload = await downloadWorkbookByItemId(sessionId, fileId);
        const finalWorkbook = await openWorkbook(finalDownload.content);
        const finalNames = finalWorkbook.worksheets.map((worksheet) => worksheet.name);
        cleanupConfirmed = !finalWorkbook.getWorksheet(testSheetName) && originalSheetNames.every((name) => finalNames.includes(name));
      } catch {
        cleanupConfirmed = false;
      }
    }
  }

  if (writeConfirmed && !cleanupConfirmed) {
    responseStatus = responseStatus === 200 ? 502 : responseStatus;
    result = { ...result, status: "cleanup_failed", cleanup: "requires_attention", message: "The temporary value was written, but safe cleanup could not be verified. Do not rerun until the workbook is inspected." };
  } else if (writeConfirmed) {
    result = { ...result, cleanup: "verified" };
  } else {
    result = { ...result, cleanup: "not_needed" };
  }
  if (writeConfirmed) testRuns.set(sessionId, "finished");
  else testRuns.delete(sessionId);
  return NextResponse.json(result, { status: responseStatus });
}
