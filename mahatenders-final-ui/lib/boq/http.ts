import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { OneDriveConflictError, OneDriveGraphError } from "@/lib/onedrive/graph";
import {
  isBoqConflict,
  isBoqGraphError,
  isBoqNotInitialized,
  isBoqSchemaError,
  isBoqValidation,
} from "./service";
import { BoqValidationError } from "./model";

export async function readBoqRequestBody(request: NextRequest): Promise<unknown> {
  try { return await request.json(); }
  catch { throw new BoqValidationError("Request body must be valid JSON."); }
}

export function boqApiError(error: unknown): NextResponse {
  if (isBoqValidation(error)) return NextResponse.json({ error: error.message }, { status: 400 });
  if (isBoqConflict(error)) return NextResponse.json({ error: "BOQ.xlsx changed in OneDrive while saving. Reload the BOQ and retry." }, { status: 409 });
  if (isBoqNotInitialized(error)) return NextResponse.json({ error: error.message, code: "BOQ_WORKBOOK_NOT_INITIALIZED" }, { status: 409 });
  if (isBoqSchemaError(error)) return NextResponse.json({ error: error.message, code: "BOQ_WORKBOOK_SCHEMA_ERROR" }, { status: 409 });
  if (isBoqGraphError(error) || error instanceof OneDriveGraphError || error instanceof OneDriveConflictError) {
    if (error.status === 401 || error.status === 403) return NextResponse.json({ error: "OneDrive is disconnected or needs to be reconnected." }, { status: 401 });
    if (error.status === 404) return NextResponse.json({ error: "The existing OneDrive BOQ folder or workbook could not be found." }, { status: 404 });
  }
  return NextResponse.json({ error: "The BOQ OneDrive operation failed. No successful save was confirmed." }, { status: 502 });
}
