import "server-only";

import { randomUUID } from "node:crypto";
import { Workbook, type CellValue, type Worksheet } from "exceljs";
import {
  addTableRecord,
  createStructuredTable,
  createWorksheet,
  deleteTableRecord,
  openWorkbook,
  readTableRecords,
  serializeWorkbook,
  structuredTableColumnNames,
  updateTableRecord,
  type WorkbookRecord,
} from "@/lib/onedrive/workbook";
import {
  downloadWorkbookByItemId,
  findDriveItemByPath,
  findWorkbookByFolderAndName,
  OneDriveConflictError,
  OneDriveGraphError,
  uploadNewFileContentsSafely,
  uploadWorkbookContentsSafely,
  type OneDriveDriveItem,
} from "@/lib/onedrive/graph";
import { readOneDriveConfig } from "@/lib/onedrive/config";
import { listProjects } from "@/lib/projects/service";
import {
  BOQ_COLUMNS,
  BOQ_FOLDER,
  BOQ_ITEMS_SHEET,
  BOQ_ITEMS_TABLE,
  BOQ_ITEM_COLUMNS,
  BOQ_SHEET,
  BOQ_STATUSES,
  BOQ_TABLE,
  BOQ_WORKBOOK,
  calculateBoq,
  BoqValidationError,
  validateBoqInput,
  type BoqInput,
  type BoqItemRecord,
  type BoqRecord,
  type BoqStatus,
} from "./model";

export class BoqSchemaError extends Error {
  constructor(message: string) { super(message); this.name = "BoqSchemaError"; }
}
export class BoqNotInitializedError extends Error {
  constructor() { super("Initialize BOQ.xlsx in the existing OneDrive BOQ folder before saving BOQs."); this.name = "BoqNotInitializedError"; }
}

type Loaded = { folderPath: string; item: OneDriveDriveItem | null; workbook: Workbook | null };

function folderPath(): string {
  const config = readOneDriveConfig();
  if (!config) throw new Error("Microsoft sign-in is not configured.");
  return `${config.rootFolder}/${BOQ_FOLDER}`;
}

function worksheet(workbook: Workbook, name: string, table: string): Worksheet {
  const sheet = workbook.getWorksheet(name);
  if (!sheet || !sheet.getTable(table)) throw new BoqSchemaError(`The BOQ workbook is missing the ${name} table.`);
  return sheet;
}

function rows(workbook: Workbook, name: string, table: string): WorkbookRecord[] {
  return readTableRecords(worksheet(workbook, name, table), table);
}

function readText(value: CellValue): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).trim() || null;
}

function readNumber(value: CellValue, label: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new BoqSchemaError(`Stored ${label} is invalid.`);
  return parsed;
}

function readStatus(value: CellValue): BoqStatus {
  const text = readText(value);
  const status = BOQ_STATUSES.find((candidate) => candidate.toLocaleLowerCase() === text?.toLocaleLowerCase());
  if (!status) throw new BoqSchemaError("A stored BOQ has an unrecognized status.");
  return status;
}

function itemsFor(workbook: Workbook, boqId: string): BoqItemRecord[] {
  return rows(workbook, BOQ_ITEMS_SHEET, BOQ_ITEMS_TABLE)
    .filter((row) => String(row.BoqId ?? "") === boqId)
    .map((row) => ({
      boqItemId: String(row.BoqItemId ?? ""),
      itemNumber: readNumber(row.ItemNumber as CellValue, "item number"),
      description: String(row.Description ?? ""),
      unit: String(row.Unit ?? ""),
      quantity: readNumber(row.Quantity as CellValue, "quantity"),
      rate: readNumber(row.Rate as CellValue, "rate"),
      amount: readNumber(row.Amount as CellValue, "item amount"),
    }));
}

function boqFromRow(workbook: Workbook, row: WorkbookRecord): BoqRecord {
  const boqId = String(row.BoqId ?? "");
  const boqNumber = String(row.BoqNumber ?? "");
  const title = String(row.Title ?? "");
  const date = readText(row.BoqDate as CellValue);
  const projectId = String(row.ProjectId ?? "");
  const projectName = String(row.ProjectName ?? "");
  if (!boqId || !boqNumber || !title || !date || !projectId || !projectName) throw new BoqSchemaError("A stored BOQ is missing required identifying information.");
  const input: BoqInput = {
    title,
    boqDate: date,
    projectId,
    workOrderId: readText(row.WorkOrderId as CellValue),
    description: readText(row.Description as CellValue),
    status: readStatus(row.Status as CellValue),
    taxPercent: readNumber(row.TaxPercent as CellValue, "tax percentage"),
    additionalCharges: readNumber(row.AdditionalCharges as CellValue, "additional charges"),
    discountPercent: readNumber(row.DiscountPercent as CellValue, "discount percentage"),
    items: itemsFor(workbook, boqId),
  };
  const calculated = calculateBoq(input);
  return {
    ...input,
    boqId,
    boqNumber,
    projectName,
    ...calculated,
    items: calculated.items.map((item, index) => ({ ...item, boqItemId: String(itemsFor(workbook, boqId)[index]?.boqItemId ?? ""), itemNumber: index + 1 })),
    createdAt: readText(row.CreatedAt as CellValue) ?? "",
    updatedAt: readText(row.UpdatedAt as CellValue) ?? "",
  };
}

function boqRecords(workbook: Workbook): BoqRecord[] {
  const records = rows(workbook, BOQ_SHEET, BOQ_TABLE).map((row) => boqFromRow(workbook, row));
  const ids = records.map((record) => record.boqId);
  const numbers = records.map((record) => record.boqNumber);
  if (new Set(ids).size !== ids.length || new Set(numbers).size !== numbers.length) throw new BoqSchemaError("BOQ IDs and numbers must be unique.");
  return records;
}

function itemRows(workbook: Workbook): WorkbookRecord[] { return rows(workbook, BOQ_ITEMS_SHEET, BOQ_ITEMS_TABLE); }

function ensureTable(workbook: Workbook, sheetName: string, tableName: string, columns: readonly string[]): boolean {
  let sheet = workbook.getWorksheet(sheetName);
  if (!sheet) sheet = createWorksheet(workbook, sheetName);
  const existing = structuredTableColumnNames(sheet, tableName);
  if (existing) {
    if (existing.length !== columns.length || existing.some((name, index) => name !== columns[index])) throw new BoqSchemaError(`The ${tableName} table does not match the supported BOQ schema.`);
    return false;
  }
  const internals = sheet as unknown as { tables?: Record<string, unknown> };
  if (Object.keys(internals.tables ?? {}).length || sheet.actualRowCount) throw new BoqSchemaError(`The ${sheetName} worksheet contains existing data and was left unchanged.`);
  createStructuredTable(sheet, tableName, [...columns]);
  return true;
}

function ensureSchema(workbook: Workbook): boolean {
  const changed1 = ensureTable(workbook, BOQ_SHEET, BOQ_TABLE, BOQ_COLUMNS);
  const changed2 = ensureTable(workbook, BOQ_ITEMS_SHEET, BOQ_ITEMS_TABLE, BOQ_ITEM_COLUMNS);
  return changed1 || changed2;
}

function validateSchema(workbook: Workbook): void {
  for (const [sheetName, tableName, columns] of [[BOQ_SHEET, BOQ_TABLE, BOQ_COLUMNS], [BOQ_ITEMS_SHEET, BOQ_ITEMS_TABLE, BOQ_ITEM_COLUMNS]] as const) {
    const sheet = workbook.getWorksheet(sheetName);
    const existing = sheet && structuredTableColumnNames(sheet, tableName);
    if (!existing || existing.join("\0") !== columns.join("\0")) throw new BoqSchemaError(`The ${tableName} table is missing or has an unsupported schema.`);
  }
}

async function load(sessionId: string): Promise<Loaded> {
  const path = folderPath();
  const folder = await findDriveItemByPath(sessionId, path);
  if (!folder.folder) throw new BoqSchemaError("The existing OneDrive folder Arch Design Studio/BOQ was not found as a folder.");
  try {
    const item = await findWorkbookByFolderAndName(sessionId, path, BOQ_WORKBOOK);
    const downloaded = await downloadWorkbookByItemId(sessionId, item.id);
    return { folderPath: path, item: downloaded.item, workbook: await openWorkbook(downloaded.content) };
  } catch (error) {
    if (error instanceof OneDriveGraphError && error.status === 404) return { folderPath: path, item: null, workbook: null };
    throw error;
  }
}

async function persist(sessionId: string, item: OneDriveDriveItem, workbook: Workbook): Promise<Workbook> {
  await uploadWorkbookContentsSafely(sessionId, item.id, await serializeWorkbook(workbook), item.eTag);
  const saved = await downloadWorkbookByItemId(sessionId, item.id);
  const result = await openWorkbook(saved.content);
  validateSchema(result);
  return result;
}

function numericFields(input: BoqInput) {
  const calculated = calculateBoq(input);
  return { calculated, input };
}

function headerRow(boq: BoqRecord): WorkbookRecord {
  return {
    BoqId: boq.boqId, BoqNumber: boq.boqNumber, Title: boq.title, BoqDate: boq.boqDate,
    ProjectId: boq.projectId, ProjectName: boq.projectName, WorkOrderId: boq.workOrderId,
    Description: boq.description, Status: boq.status, TaxPercent: boq.taxPercent,
    AdditionalCharges: boq.additionalCharges, DiscountPercent: boq.discountPercent,
    Subtotal: boq.subtotal, TaxAmount: boq.taxAmount, DiscountAmount: boq.discountAmount,
    GrandTotal: boq.grandTotal, CreatedAt: boq.createdAt, UpdatedAt: boq.updatedAt,
  };
}

function itemRow(boqId: string, item: BoqItemRecord): WorkbookRecord {
  return { BoqItemId: item.boqItemId, BoqId: boqId, ItemNumber: item.itemNumber, Description: item.description, Unit: item.unit, Quantity: item.quantity, Rate: item.rate, Amount: item.amount };
}

function uniqueBoqNumber(existing: Set<string>, year: number): string {
  let value = "";
  do { value = `BOQ-${year}-${randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`; } while (existing.has(value));
  return value;
}

function makeRecord(input: BoqInput, projectName: string, existing: BoqRecord[] = [], previous?: BoqRecord): BoqRecord {
  const { calculated } = numericFields(input);
  const now = new Date().toISOString();
  const boqId = previous?.boqId ?? `BOQ-${randomUUID().toUpperCase()}`;
  const boqNumber = previous?.boqNumber ?? uniqueBoqNumber(new Set(existing.map((record) => record.boqNumber)), Number(input.boqDate.slice(0, 4)));
  return {
    ...input,
    boqId,
    boqNumber,
    projectName,
    ...calculated,
    items: calculated.items.map((item, index) => ({ ...item, boqItemId: previous?.items[index]?.boqItemId ?? `BQI-${randomUUID().toUpperCase()}`, itemNumber: index + 1 })),
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
  };
}

async function requireProject(sessionId: string, projectId: string): Promise<string> {
  const result = await listProjects(sessionId);
  const project = result.projects.find((candidate) => candidate.projectId === projectId && !candidate.isArchived);
  if (!project) throw new BoqValidationError("Select an existing, active Project Tracking project.");
  return project.projectName;
}

export async function listBoqs(sessionId: string): Promise<{ initialized: boolean; boqs: BoqRecord[] }> {
  const current = await load(sessionId);
  if (!current.workbook) return { initialized: false, boqs: [] };
  validateSchema(current.workbook);
  return { initialized: true, boqs: boqRecords(current.workbook) };
}

export async function initializeBoqWorkbook(sessionId: string): Promise<{ created: boolean; boqCount: number }> {
  const current = await load(sessionId);
  if (!current.workbook || !current.item) {
    const workbook = new Workbook();
    ensureSchema(workbook);
    const uploaded = await uploadNewFileContentsSafely(sessionId, current.folderPath, BOQ_WORKBOOK, await serializeWorkbook(workbook));
    const saved = await downloadWorkbookByItemId(sessionId, uploaded.id);
    const check = await openWorkbook(saved.content);
    validateSchema(check);
    return { created: true, boqCount: boqRecords(check).length };
  }
  validateSchema(current.workbook);
  const checked = await downloadWorkbookByItemId(sessionId, current.item.id);
  const readback = await openWorkbook(checked.content);
  validateSchema(readback);
  return { created: false, boqCount: boqRecords(readback).length };
}

export async function createBoq(sessionId: string, raw: unknown): Promise<BoqRecord> {
  const input = validateBoqInput(raw);
  const current = await load(sessionId);
  if (!current.workbook || !current.item) throw new BoqNotInitializedError();
  validateSchema(current.workbook);
  const projectName = await requireProject(sessionId, input.projectId);
  const existing = boqRecords(current.workbook);
  const record = makeRecord(input, projectName, existing);
  addTableRecord(worksheet(current.workbook, BOQ_SHEET, BOQ_TABLE), BOQ_TABLE, headerRow(record));
  for (const item of record.items) addTableRecord(worksheet(current.workbook, BOQ_ITEMS_SHEET, BOQ_ITEMS_TABLE), BOQ_ITEMS_TABLE, itemRow(record.boqId, item));
  const saved = await persist(sessionId, current.item, current.workbook);
  const result = boqRecords(saved).find((boq) => boq.boqId === record.boqId);
  if (!result) throw new Error("Microsoft Graph accepted the save but did not return the BOQ on readback.");
  return result;
}

export async function updateBoq(sessionId: string, boqId: string, raw: unknown): Promise<BoqRecord | null> {
  const input = validateBoqInput(raw);
  const current = await load(sessionId);
  if (!current.workbook || !current.item) throw new BoqNotInitializedError();
  validateSchema(current.workbook);
  const existing = boqRecords(current.workbook);
  const previous = existing.find((record) => record.boqId === boqId);
  if (!previous) return null;
  const projectName = await requireProject(sessionId, input.projectId);
  const updated = makeRecord(input, projectName, existing, previous);
  if (!updateTableRecord(worksheet(current.workbook, BOQ_SHEET, BOQ_TABLE), BOQ_TABLE, "BoqId", boqId, headerRow(updated))) return null;
  const itemSheet = worksheet(current.workbook, BOQ_ITEMS_SHEET, BOQ_ITEMS_TABLE);
  for (const item of previous.items) deleteTableRecord(itemSheet, BOQ_ITEMS_TABLE, "BoqItemId", item.boqItemId);
  for (const item of updated.items) addTableRecord(itemSheet, BOQ_ITEMS_TABLE, itemRow(boqId, item));
  const saved = await persist(sessionId, current.item, current.workbook);
  return boqRecords(saved).find((record) => record.boqId === boqId) ?? null;
}

export async function deleteBoq(sessionId: string, boqId: string): Promise<boolean> {
  const current = await load(sessionId);
  if (!current.workbook || !current.item) throw new BoqNotInitializedError();
  validateSchema(current.workbook);
  const record = boqRecords(current.workbook).find((boq) => boq.boqId === boqId);
  if (!record) return false;
  const itemSheet = worksheet(current.workbook, BOQ_ITEMS_SHEET, BOQ_ITEMS_TABLE);
  for (const item of record.items) deleteTableRecord(itemSheet, BOQ_ITEMS_TABLE, "BoqItemId", item.boqItemId);
  deleteTableRecord(worksheet(current.workbook, BOQ_SHEET, BOQ_TABLE), BOQ_TABLE, "BoqId", boqId);
  const saved = await persist(sessionId, current.item, current.workbook);
  if (boqRecords(saved).some((entry) => entry.boqId === boqId)) throw new Error("Microsoft Graph did not confirm the BOQ deletion.");
  return true;
}

export async function duplicateBoq(sessionId: string, boqId: string): Promise<BoqRecord | null> {
  const result = await listBoqs(sessionId);
  const source = result.boqs.find((record) => record.boqId === boqId);
  if (!source) return null;
  return createBoq(sessionId, { ...source, title: `${source.title} (Copy)`, status: "Draft", items: source.items.map(({ description, unit, quantity, rate }) => ({ description, unit, quantity, rate })) });
}

export async function reopenBoq(sessionId: string, boqId: string): Promise<BoqRecord | null> {
  const result = await listBoqs(sessionId);
  const source = result.boqs.find((record) => record.boqId === boqId);
  if (!source) return null;
  return updateBoq(sessionId, boqId, { ...source, status: "Draft", items: source.items.map(({ description, unit, quantity, rate }) => ({ description, unit, quantity, rate })) });
}

export async function exportBoq(sessionId: string, boqId: string): Promise<{ fileName: string; contents: Buffer } | null> {
  const result = await listBoqs(sessionId);
  const boq = result.boqs.find((record) => record.boqId === boqId);
  if (!boq) return null;
  const workbook = new Workbook();
  const summary = workbook.addWorksheet("BOQ Summary");
  summary.addRows([
    ["BOQ Number", boq.boqNumber], ["Title", boq.title], ["Date", boq.boqDate],
    ["Project", boq.projectName], ["Project ID", boq.projectId], ["Work Order", boq.workOrderId ?? ""],
    ["Description", boq.description ?? ""], ["Status", boq.status], ["Tax %", boq.taxPercent],
    ["Subtotal", boq.subtotal], ["Tax Amount", boq.taxAmount], ["Additional Charges", boq.additionalCharges],
    ["Discount %", boq.discountPercent], ["Discount Amount", boq.discountAmount], ["Grand Total", boq.grandTotal],
  ]);
  const items = workbook.addWorksheet("Items");
  createStructuredTable(items, "BOQExportItems", ["Item No.", "Description", "Unit", "Quantity", "Rate (INR)", "Amount (INR)"], boq.items.map((item) => ({ "Item No.": item.itemNumber, Description: item.description, Unit: item.unit, Quantity: item.quantity, "Rate (INR)": item.rate, "Amount (INR)": item.amount })));
  return { fileName: `${boq.boqNumber}.xlsx`, contents: await serializeWorkbook(workbook) };
}

export function isBoqValidation(error: unknown): error is BoqValidationError { return error instanceof BoqValidationError; }
export function isBoqConflict(error: unknown): error is OneDriveConflictError { return error instanceof OneDriveConflictError; }
export function isBoqNotInitialized(error: unknown): error is BoqNotInitializedError { return error instanceof BoqNotInitializedError; }
export function isBoqSchemaError(error: unknown): error is BoqSchemaError { return error instanceof BoqSchemaError; }
export function isBoqGraphError(error: unknown): error is OneDriveGraphError { return error instanceof OneDriveGraphError; }
