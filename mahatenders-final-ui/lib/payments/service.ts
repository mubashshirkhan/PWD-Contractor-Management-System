import "server-only";

import { randomUUID } from "node:crypto";
import { Workbook, type CellValue, type Worksheet } from "exceljs";
import { addTableRecord, createStructuredTable, deleteTableRecord, openWorkbook, readTableRecords, serializeWorkbook, structuredTableColumnNames, updateTableRecord } from "@/lib/onedrive/workbook";
import { downloadWorkbookByItemId, findDriveItemByPath, findWorkbookByFolderAndName, OneDriveConflictError, OneDriveGraphError, uploadNewFileContentsSafely, uploadWorkbookContentsSafely, type OneDriveDriveItem } from "@/lib/onedrive/graph";
import { readOneDriveConfig } from "@/lib/onedrive/config";
import { listProjects } from "@/lib/projects/service";
import { calculateTransactionTotals, PAYMENT_METHODS, PAYMENTS_FOLDER, PAYMENTS_SHEET, PAYMENTS_TABLE, PAYMENTS_WORKBOOK, TRANSACTION_COLUMNS, TRANSACTION_TYPES, TransactionValidationError, validateTransaction, type PaymentMethod, type TransactionInput, type TransactionRecord, type TransactionType } from "./model";

export class PaymentsWorkbookError extends Error { constructor(message: string) { super(message); this.name = "PaymentsWorkbookError"; } }
export class PaymentsWorkbookNotInitializedError extends Error { constructor() { super("Initialize PaymentsExpenses.xlsx in the existing Financial Management folder before saving transactions."); this.name = "PaymentsWorkbookNotInitializedError"; } }
export class PaymentsFolderMissingError extends Error { constructor() { super("The existing Arch Design Studio/Financial Management folder was not found. Create that folder in OneDrive, then initialize the workbook here."); this.name = "PaymentsFolderMissingError"; } }
type Loaded = { path: string; folderExists: boolean; item: OneDriveDriveItem | null; workbook: Workbook | null };

function folderPath() { const config = readOneDriveConfig(); if (!config) throw new Error("Microsoft sign-in is not configured."); return `${config.rootFolder}/${PAYMENTS_FOLDER}`; }
function sheet(workbook: Workbook): Worksheet { const value = workbook.getWorksheet(PAYMENTS_SHEET); if (!value || !value.getTable(PAYMENTS_TABLE)) throw new PaymentsWorkbookError("The Transactions table is missing from PaymentsExpenses.xlsx."); return value; }
function text(value: CellValue): string | null { if (value === null || value === undefined || value === "") return null; if (value instanceof Date) return value.toISOString().slice(0, 10); return String(value).trim() || null; }
function readRecords(workbook: Workbook): TransactionRecord[] {
  const result = readTableRecords(sheet(workbook), PAYMENTS_TABLE).map((row) => {
    const id = text(row.TransactionId as CellValue); const typeText = text(row.Type as CellValue); const type = TRANSACTION_TYPES.find((value) => value.toLowerCase() === typeText?.toLowerCase());
    const amountValue = row.Amount as CellValue; const amount = amountValue === null || amountValue === undefined || amountValue === "" ? Number.NaN : Number(amountValue);
    const date = text(row.Date as CellValue); const description = text(row.Description as CellValue); const projectId = text(row.ProjectId as CellValue);
    const methodValue = text(row.PaymentMethod as CellValue); const paymentMethod = methodValue ? PAYMENT_METHODS.find((value) => value.toLowerCase() === methodValue.toLowerCase()) : null;
    if (!id || !type || !Number.isFinite(amount) || amount <= 0 || !date || !description || (methodValue && !paymentMethod)) throw new PaymentsWorkbookError("A saved transaction has invalid identifying, type, amount, date, or description data.");
    return { transactionId: id, type, projectId, projectName: text(row.ProjectName as CellValue), description, amount, date, paymentMethod: paymentMethod as PaymentMethod | null, remarks: text(row.Remarks as CellValue), createdAt: text(row.CreatedAt as CellValue) ?? "", updatedAt: text(row.UpdatedAt as CellValue) ?? "" };
  });
  if (new Set(result.map((record) => record.transactionId)).size !== result.length) throw new PaymentsWorkbookError("Transaction IDs in the workbook must be unique.");
  return result.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
}
function validateSchema(workbook: Workbook) { const columns = structuredTableColumnNames(sheet(workbook), PAYMENTS_TABLE); if (!columns || columns.join("\0") !== TRANSACTION_COLUMNS.join("\0")) throw new PaymentsWorkbookError("The Transactions table has an unsupported column layout. Existing workbook data was left unchanged."); }
async function load(sessionId: string): Promise<Loaded> {
  const path = folderPath(); let folder;
  try { folder = await findDriveItemByPath(sessionId, path); }
  catch (error) { if (error instanceof OneDriveGraphError && error.status === 404) return { path, folderExists: false, item: null, workbook: null }; throw error; }
  if (!folder.folder) throw new PaymentsWorkbookError("The Financial Management path exists in OneDrive but is not a folder.");
  try { const item = await findWorkbookByFolderAndName(sessionId, path, PAYMENTS_WORKBOOK); const file = await downloadWorkbookByItemId(sessionId, item.id); return { path, folderExists: true, item: file.item, workbook: await openWorkbook(file.content) }; }
  catch (error) { if (error instanceof OneDriveGraphError && error.status === 404) return { path, folderExists: true, item: null, workbook: null }; throw error; }
}
async function persist(sessionId: string, item: OneDriveDriveItem, workbook: Workbook) { await uploadWorkbookContentsSafely(sessionId, item.id, await serializeWorkbook(workbook), item.eTag); const file = await downloadWorkbookByItemId(sessionId, item.id); const saved = await openWorkbook(file.content); validateSchema(saved); return saved; }
function toRow(record: TransactionRecord) { return { TransactionId: record.transactionId, Type: record.type, ProjectId: record.projectId, ProjectName: record.projectName, Description: record.description, Amount: record.amount, Date: record.date, PaymentMethod: record.paymentMethod, Remarks: record.remarks, CreatedAt: record.createdAt, UpdatedAt: record.updatedAt }; }
async function resolveProject(sessionId: string, projectId: string | null) {
  if (!projectId) return { projectId: null, projectName: null };
  const data = await listProjects(sessionId); const project = data.projects.find((record) => record.projectId === projectId && !record.isArchived);
  if (!project) throw new TransactionValidationError("Select an existing, active project, or leave Project blank for a general transaction.");
  return { projectId: project.projectId, projectName: project.projectName };
}
async function materialize(sessionId: string, input: TransactionInput, previous?: TransactionRecord): Promise<TransactionRecord> {
  const project = await resolveProject(sessionId, input.projectId); const now = new Date().toISOString();
  return { ...input, ...project, transactionId: previous?.transactionId ?? `TXN-${randomUUID().toUpperCase()}`, createdAt: previous?.createdAt ?? now, updatedAt: now };
}
function verifyReadback(expected: TransactionRecord, actual?: TransactionRecord) { if (!actual || Object.keys(expected).some((key) => expected[key as keyof TransactionRecord] !== actual[key as keyof TransactionRecord])) throw new Error("OneDrive did not return the saved transaction values on readback."); return actual; }

export async function getTransactionRegister(sessionId: string) { const current = await load(sessionId); if (!current.folderExists || !current.workbook) return { folderExists: current.folderExists, initialized: false, transactions: [] as TransactionRecord[], totals: calculateTransactionTotals([]) }; validateSchema(current.workbook); const transactions = readRecords(current.workbook); return { folderExists: true, initialized: true, transactions, totals: calculateTransactionTotals(transactions) }; }
export async function initializePaymentsWorkbook(sessionId: string) {
  const current = await load(sessionId); if (!current.folderExists) throw new PaymentsFolderMissingError();
  if (current.item && current.workbook) { validateSchema(current.workbook); const downloaded = await downloadWorkbookByItemId(sessionId, current.item.id); const checked = await openWorkbook(downloaded.content); validateSchema(checked); return { created: false, count: readRecords(checked).length }; }
  const workbook = new Workbook(); const worksheet = workbook.addWorksheet(PAYMENTS_SHEET); createStructuredTable(worksheet, PAYMENTS_TABLE, [...TRANSACTION_COLUMNS]);
  const item = await uploadNewFileContentsSafely(sessionId, current.path, PAYMENTS_WORKBOOK, await serializeWorkbook(workbook)); const saved = await openWorkbook((await downloadWorkbookByItemId(sessionId, item.id)).content); validateSchema(saved); return { created: true, count: readRecords(saved).length };
}
function requireWorkbook(current: Loaded): asserts current is Loaded & { folderExists: true; item: OneDriveDriveItem; workbook: Workbook } { if (!current.folderExists) throw new PaymentsFolderMissingError(); if (!current.item || !current.workbook) throw new PaymentsWorkbookNotInitializedError(); }
export async function createTransaction(sessionId: string, raw: unknown) { const input = validateTransaction(raw); const current = await load(sessionId); requireWorkbook(current); validateSchema(current.workbook); const created = await materialize(sessionId, input); addTableRecord(sheet(current.workbook), PAYMENTS_TABLE, toRow(created)); return verifyReadback(created, readRecords(await persist(sessionId, current.item, current.workbook)).find((record) => record.transactionId === created.transactionId)); }
export async function updateTransaction(sessionId: string, id: string, raw: unknown) { const input = validateTransaction(raw); const current = await load(sessionId); requireWorkbook(current); validateSchema(current.workbook); const previous = readRecords(current.workbook).find((record) => record.transactionId === id); if (!previous) return null; const updated = await materialize(sessionId, input, previous); if (!updateTableRecord(sheet(current.workbook), PAYMENTS_TABLE, "TransactionId", id, toRow(updated))) return null; return verifyReadback(updated, readRecords(await persist(sessionId, current.item, current.workbook)).find((record) => record.transactionId === id)); }
export async function deleteTransaction(sessionId: string, id: string) { const current = await load(sessionId); requireWorkbook(current); validateSchema(current.workbook); if (!deleteTableRecord(sheet(current.workbook), PAYMENTS_TABLE, "TransactionId", id)) return false; if (readRecords(await persist(sessionId, current.item, current.workbook)).some((record) => record.transactionId === id)) throw new Error("OneDrive did not confirm the transaction deletion."); return true; }
export const isPaymentsConflict = (error: unknown): error is OneDriveConflictError => error instanceof OneDriveConflictError;
export const isPaymentsGraphError = (error: unknown): error is OneDriveGraphError => error instanceof OneDriveGraphError;
