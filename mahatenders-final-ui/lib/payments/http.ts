import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { OneDriveGraphError } from "@/lib/onedrive/graph";
import { PaymentsFolderMissingError, PaymentsWorkbookError, PaymentsWorkbookNotInitializedError, isPaymentsConflict } from "./service";
import { TransactionValidationError } from "./model";
export async function readTransactionBody(request: NextRequest): Promise<unknown> { try { return await request.json(); } catch { throw new TransactionValidationError("Enter valid transaction details."); } }
export function paymentsApiError(error: unknown) {
  if (error instanceof TransactionValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
  if (isPaymentsConflict(error)) return NextResponse.json({ error: "The workbook changed while saving. Refresh the transactions and try again." }, { status: 409 });
  if (error instanceof PaymentsFolderMissingError) return NextResponse.json({ error: error.message, code: "PAYMENTS_FOLDER_MISSING" }, { status: 404 });
  if (error instanceof PaymentsWorkbookNotInitializedError) return NextResponse.json({ error: error.message, code: "PAYMENTS_WORKBOOK_NOT_INITIALIZED" }, { status: 409 });
  if (error instanceof PaymentsWorkbookError) return NextResponse.json({ error: error.message, code: "PAYMENTS_WORKBOOK_SCHEMA_ERROR" }, { status: 409 });
  if (error instanceof OneDriveGraphError) {
    const status = error.status === 401 || error.status === 403 ? 401 : error.status === 404 ? 404 : 502;
    return NextResponse.json({ error: status === 401 ? "OneDrive access needs to be reconnected." : status === 404 ? "The Financial Management folder or PaymentsExpenses.xlsx workbook could not be found." : "OneDrive could not complete this Payments & Expenses request." }, { status });
  }
  return NextResponse.json({ error: "The Payments & Expenses OneDrive operation failed. No successful save was confirmed." }, { status: 502 });
}
