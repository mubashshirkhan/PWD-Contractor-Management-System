import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { OneDriveGraphError } from "@/lib/onedrive/graph";
import { WorkOrderNotInitializedError, WorkOrderWorkbookError, isWorkOrderConflict } from "./service";
import { WorkOrderValidationError } from "./model";
export async function readWorkOrderBody(request: NextRequest): Promise<unknown> { try { return await request.json(); } catch { throw new WorkOrderValidationError("Request body must be valid JSON."); } }
export function workOrderApiError(error: unknown) {
  if (error instanceof WorkOrderValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
  if (isWorkOrderConflict(error)) return NextResponse.json({ error: "The workbook changed during this operation. Reload and try again." }, { status: 409 });
  if (error instanceof WorkOrderNotInitializedError) return NextResponse.json({ error: error.message, code: "WORKBOOK_NOT_INITIALIZED" }, { status: 409 });
  if (error instanceof WorkOrderWorkbookError) return NextResponse.json({ error: error.message, code: "WORKBOOK_SCHEMA_CONFLICT" }, { status: 409 });
  if (error instanceof OneDriveGraphError) return NextResponse.json({ error: error.status === 401 || error.status === 403 ? "OneDrive access needs to be reconnected." : error.status === 404 ? "The existing Work Orders folder or workbook was not found." : "OneDrive could not complete the Work Orders request." }, { status: error.status === 401 || error.status === 403 ? 401 : error.status === 404 ? 404 : 502 });
  return NextResponse.json({ error: "The Work Orders OneDrive operation failed." }, { status: 502 });
}
