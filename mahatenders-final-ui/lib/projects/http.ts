import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { sessionCookieName } from "@/lib/onedrive/cookies";
import { ProjectValidationError } from "./model";
import {
  isOneDriveGraphFailure,
  isProjectConflict,
  isProjectNotInitialized,
  isProjectSchemaError,
  isProjectValidationError,
} from "./service";

export function projectSessionId(request: NextRequest): string | null {
  return request.cookies.get(sessionCookieName())?.value ?? null;
}

export function rejectCrossOriginWrite(request: NextRequest): NextResponse | null {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  const protocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || request.nextUrl.protocol.replace(":", "");
  const hostOrigin = host ? `${protocol}://${host}` : "";
  if (origin && (origin === request.nextUrl.origin || origin === hostOrigin)) return null;
  return NextResponse.json({ error: "Request origin was rejected." }, { status: 403 });
}

export function projectApiError(error: unknown): NextResponse {
  if (isProjectValidationError(error)) return NextResponse.json({ error: error.message }, { status: 400 });
  if (isProjectConflict(error)) return NextResponse.json({ error: "The workbook changed during this operation. Reload and retry." }, { status: 409 });
  if (isProjectNotInitialized(error)) return NextResponse.json({ error: error.message, code: "WORKBOOK_NOT_INITIALIZED" }, { status: 409 });
  if (isProjectSchemaError(error)) return NextResponse.json({ error: error.message, code: "WORKBOOK_SCHEMA_CONFLICT" }, { status: 409 });
  if (isOneDriveGraphFailure(error)) {
    if (error.status === 404) return NextResponse.json({ error: "The existing Project Tracking folder or workbook was not found." }, { status: 404 });
    if (error.status === 401 || error.status === 403) return NextResponse.json({ error: "OneDrive access needs to be reconnected." }, { status: 401 });
  }
  return NextResponse.json({ error: "The Project Tracking OneDrive operation failed." }, { status: 502 });
}

export async function readJsonBody(request: NextRequest): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ProjectValidationError("Request body must be valid JSON.");
  }
}
