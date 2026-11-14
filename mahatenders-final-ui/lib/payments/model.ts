export const PAYMENTS_FOLDER = "Financial Management";
export const PAYMENTS_WORKBOOK = "PaymentsExpenses.xlsx";
export const PAYMENTS_SHEET = "Transactions";
export const PAYMENTS_TABLE = "Transactions";
export const TRANSACTION_TYPES = ["Money Received", "Expense"] as const;
export const PAYMENT_METHODS = ["Cash", "UPI", "Bank Transfer", "Cheque", "Other"] as const;
export const TRANSACTION_COLUMNS = ["TransactionId", "Type", "ProjectId", "ProjectName", "Description", "Amount", "Date", "PaymentMethod", "Remarks", "CreatedAt", "UpdatedAt"] as const;
export type TransactionType = typeof TRANSACTION_TYPES[number];
export type PaymentMethod = typeof PAYMENT_METHODS[number];
export type TransactionInput = { type: TransactionType; projectId: string | null; description: string; amount: number; date: string; paymentMethod: PaymentMethod | null; remarks: string | null };
export type TransactionRecord = TransactionInput & { transactionId: string; projectName: string | null; createdAt: string; updatedAt: string };
export class TransactionValidationError extends Error { constructor(message: string) { super(message); this.name = "TransactionValidationError"; } }

function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new TransactionValidationError("Enter transaction details."); return value as Record<string, unknown>; }
function optionalText(value: unknown, label: string, max: number): string | null { if (value === undefined || value === null || value === "") return null; if (typeof value !== "string") throw new TransactionValidationError(`${label} must be text.`); const text = value.trim(); if (text.length > max) throw new TransactionValidationError(`${label} is too long.`); return text || null; }
function requiredText(value: unknown, label: string, max: number): string { const text = optionalText(value, label, max); if (!text) throw new TransactionValidationError(`${label} is required.`); return text; }
function validDate(value: unknown): string { if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new TransactionValidationError("Choose a valid transaction date."); const date = new Date(`${value}T00:00:00.000Z`); if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new TransactionValidationError("Choose a valid transaction date."); return value; }
export function validateTransaction(value: unknown): TransactionInput {
  const input = object(value);
  if (typeof input.type !== "string" || !TRANSACTION_TYPES.includes(input.type as TransactionType)) throw new TransactionValidationError("Choose Money Received or Expense.");
  const amount = typeof input.amount === "number" ? input.amount : typeof input.amount === "string" && input.amount.trim() ? Number(input.amount) : Number.NaN;
  if (!Number.isFinite(amount) || amount <= 0) throw new TransactionValidationError("Amount must be greater than zero.");
  const method = input.paymentMethod === undefined || input.paymentMethod === null || input.paymentMethod === "" ? null : input.paymentMethod;
  if (typeof method !== "string" || (method !== null && !PAYMENT_METHODS.includes(method as PaymentMethod))) throw new TransactionValidationError("Choose a supported payment method.");
  return { type: input.type as TransactionType, projectId: optionalText(input.projectId, "Project", 100), description: requiredText(input.description, "Description", 300), amount, date: validDate(input.date), paymentMethod: method as PaymentMethod | null, remarks: optionalText(input.remarks, "Reference / remarks", 1000) };
}

export function calculateTransactionTotals(records: readonly Pick<TransactionRecord, "type" | "amount">[]) {
  const totalReceived = roundInr(records.filter((record) => record.type === "Money Received").reduce((sum, record) => sum + record.amount, 0));
  const totalExpenses = roundInr(records.filter((record) => record.type === "Expense").reduce((sum, record) => sum + record.amount, 0));
  return { totalReceived, totalExpenses, totalPaid: totalExpenses, remainingBalance: roundInr(totalReceived - totalExpenses) };
}
export function roundInr(value: number) { return Math.round((value + Number.EPSILON) * 100) / 100; }
