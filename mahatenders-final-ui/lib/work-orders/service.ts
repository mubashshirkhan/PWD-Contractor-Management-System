import "server-only";

import { randomUUID } from "node:crypto";
import { Workbook, type CellValue, type Worksheet } from "exceljs";
import { addTableRecord, createStructuredTable, openWorkbook, readTableRecords, serializeWorkbook, structuredTableColumnNames, updateTableRecord, deleteTableRecord } from "@/lib/onedrive/workbook";
import { downloadWorkbookByItemId, findDriveItemByPath, findWorkbookByFolderAndName, OneDriveConflictError, OneDriveGraphError, uploadNewFileContentsSafely, uploadWorkbookContentsSafely, type OneDriveDriveItem } from "@/lib/onedrive/graph";
import { readOneDriveConfig } from "@/lib/onedrive/config";
import { listProjects } from "@/lib/projects/service";
import { listBoqs } from "@/lib/boq/service";
import { resolveWorkOrderReferences } from "./relationships";
import { WORK_ORDER_COLUMNS, WORK_ORDERS_SHEET, WORK_ORDER_STATUSES, WORK_ORDERS_TABLE, WORK_ORDERS_FOLDER, WORK_ORDERS_WORKBOOK, WorkOrderValidationError, validateWorkOrderInput, type WorkOrderInput, type WorkOrderRecord } from "./model";

export class WorkOrderWorkbookError extends Error { constructor(message: string) { super(message); this.name = "WorkOrderWorkbookError"; } }
export class WorkOrderNotInitializedError extends Error { constructor() { super("WorkOrders.xlsx is not initialized in the existing Work Orders folder."); this.name = "WorkOrderNotInitializedError"; } }
type Loaded = { path: string; item: OneDriveDriveItem | null; workbook: Workbook | null };

function folderPath() { const config = readOneDriveConfig(); if (!config) throw new Error("Microsoft sign-in is not configured."); return `${config.rootFolder}/${WORK_ORDERS_FOLDER}`; }
function sheet(workbook: Workbook): Worksheet { const value = workbook.getWorksheet(WORK_ORDERS_SHEET); if (!value || !value.getTable(WORK_ORDERS_TABLE)) throw new WorkOrderWorkbookError("The WorkOrders table is missing or unsupported."); return value; }
function records(workbook: Workbook): WorkOrderRecord[] {
  const result = readTableRecords(sheet(workbook), WORK_ORDERS_TABLE).map((row) => {
    const text = (value: CellValue) => value instanceof Date ? value.toISOString().slice(0, 10) : value == null ? "" : String(value).trim();
    const statusValue = text(row.Status as CellValue);
    const status = WORK_ORDER_STATUSES.find((value) => value.toLowerCase() === statusValue.toLowerCase());
    const rawAmount = row.ContractAmount as CellValue;
    const amount = rawAmount === null || rawAmount === undefined || rawAmount === "" ? Number.NaN : Number(rawAmount);
    if (!status || !Number.isFinite(amount) || !text(row.WorkOrderId as CellValue) || !text(row.WorkOrderNumber as CellValue)) throw new WorkOrderWorkbookError("A saved work order has invalid identifying, amount, or status data.");
    return { workOrderId: text(row.WorkOrderId as CellValue), workOrderNumber: text(row.WorkOrderNumber as CellValue), projectId: text(row.ProjectId as CellValue), projectName: text(row.ProjectName as CellValue), title: text(row.Title as CellValue), contractorName: text(row.ContractorName as CellValue), contractAmount: amount, issueDate: text(row.IssueDate as CellValue), startDate: text(row.StartDate as CellValue), expectedCompletionDate: text(row.ExpectedCompletionDate as CellValue), status, description: text(row.Description as CellValue) || null, boqId: text(row.BoqId as CellValue) || null, boqNumber: text(row.BoqNumber as CellValue) || null, createdAt: text(row.CreatedAt as CellValue), updatedAt: text(row.UpdatedAt as CellValue) };
  });
  if (new Set(result.map((record) => record.workOrderId)).size !== result.length || new Set(result.map((record) => record.workOrderNumber)).size !== result.length) throw new WorkOrderWorkbookError("Saved work order IDs and numbers must be unique.");
  return result;
}
function validateSchema(workbook: Workbook) { const columns = structuredTableColumnNames(sheet(workbook), WORK_ORDERS_TABLE); if (!columns || columns.join("\0") !== WORK_ORDER_COLUMNS.join("\0")) throw new WorkOrderWorkbookError("The WorkOrders table has an unsupported column layout; existing data was left unchanged."); }
async function load(sessionId: string): Promise<Loaded> {
  const path = folderPath(); const folder = await findDriveItemByPath(sessionId, path); if (!folder.folder) throw new WorkOrderWorkbookError("The existing Arch Design Studio/Project Management/Work Orders path is not a folder.");
  try { const item = await findWorkbookByFolderAndName(sessionId, path, WORK_ORDERS_WORKBOOK); const downloaded = await downloadWorkbookByItemId(sessionId, item.id); return { path, item: downloaded.item, workbook: await openWorkbook(downloaded.content) }; }
  catch (error) { if (error instanceof OneDriveGraphError && error.status === 404) return { path, item: null, workbook: null }; throw error; }
}
async function persist(sessionId: string, item: OneDriveDriveItem, workbook: Workbook) { await uploadWorkbookContentsSafely(sessionId, item.id, await serializeWorkbook(workbook), item.eTag); const downloaded = await downloadWorkbookByItemId(sessionId, item.id); const readback = await openWorkbook(downloaded.content); validateSchema(readback); return readback; }
function row(record: WorkOrderRecord) { return { WorkOrderId: record.workOrderId, WorkOrderNumber: record.workOrderNumber, ProjectId: record.projectId, ProjectName: record.projectName, Title: record.title, ContractorName: record.contractorName, ContractAmount: record.contractAmount, IssueDate: record.issueDate, StartDate: record.startDate, ExpectedCompletionDate: record.expectedCompletionDate, Status: record.status, Description: record.description, BoqId: record.boqId, BoqNumber: record.boqNumber, CreatedAt: record.createdAt, UpdatedAt: record.updatedAt }; }
function confirmReadback(expected: WorkOrderRecord, actual: WorkOrderRecord | undefined) {
  if (!actual || Object.keys(expected).some((key) => expected[key as keyof WorkOrderRecord] !== actual[key as keyof WorkOrderRecord])) throw new Error("OneDrive did not return the saved work order values on readback.");
  return actual;
}
async function references(sessionId: string, input: WorkOrderInput) {
  const projects = await listProjects(sessionId);
  let boqs: Awaited<ReturnType<typeof listBoqs>>["boqs"] = [];
  if (input.boqId) { const data = await listBoqs(sessionId); if (!data.initialized) throw new WorkOrderValidationError("BOQ workbook is not initialized, so a BOQ cannot be linked."); boqs = data.boqs; }
  return resolveWorkOrderReferences(input, projects.projects, boqs);
}
export function nextWorkOrderNumber(existing: WorkOrderRecord[], year = new Date().getFullYear()) { const prefix = `WO-${year}-`; let maximum = 0; for (const item of existing) { const match = new RegExp(`^WO-${year}-(\\d+)$`, "i").exec(item.workOrderNumber); if (match) maximum = Math.max(maximum, Number(match[1])); } return `${prefix}${String(maximum + 1).padStart(4, "0")}`; }
async function materialize(sessionId: string, input: WorkOrderInput, existing: WorkOrderRecord[], previous?: WorkOrderRecord): Promise<WorkOrderRecord> {
  const refs = await references(sessionId, input); const now = new Date().toISOString();
  return { ...input, workOrderId: previous?.workOrderId ?? `WOID-${randomUUID().toUpperCase()}`, workOrderNumber: input.workOrderNumber ?? previous?.workOrderNumber ?? nextWorkOrderNumber(existing), projectName: refs.projectName, boqNumber: refs.boqNumber, createdAt: previous?.createdAt ?? now, updatedAt: now };
}
export async function listWorkOrders(sessionId: string) { const current = await load(sessionId); if (!current.workbook) return { initialized: false, workOrders: [] as WorkOrderRecord[] }; validateSchema(current.workbook); return { initialized: true, workOrders: records(current.workbook) }; }
export async function initializeWorkOrders(sessionId: string) {
  const current = await load(sessionId);
  if (current.workbook && current.item) { validateSchema(current.workbook); const fresh = await downloadWorkbookByItemId(sessionId, current.item.id); const check = await openWorkbook(fresh.content); validateSchema(check); return { created: false, count: records(check).length }; }
  const workbook = new Workbook(); const worksheet = workbook.addWorksheet(WORK_ORDERS_SHEET); createStructuredTable(worksheet, WORK_ORDERS_TABLE, [...WORK_ORDER_COLUMNS]);
  const item = await uploadNewFileContentsSafely(sessionId, current.path, WORK_ORDERS_WORKBOOK, await serializeWorkbook(workbook));
  const readback = await openWorkbook((await downloadWorkbookByItemId(sessionId, item.id)).content); validateSchema(readback); return { created: true, count: records(readback).length };
}
export async function createWorkOrder(sessionId: string, raw: unknown) { const input = validateWorkOrderInput(raw); const current = await load(sessionId); if (!current.workbook || !current.item) throw new WorkOrderNotInitializedError(); validateSchema(current.workbook); const existing = records(current.workbook); const created = await materialize(sessionId, input, existing); if (existing.some((value) => value.workOrderNumber.toLowerCase() === created.workOrderNumber.toLowerCase())) throw new WorkOrderValidationError("That Work Order number is already in use."); addTableRecord(sheet(current.workbook), WORK_ORDERS_TABLE, row(created)); return confirmReadback(created, records(await persist(sessionId, current.item, current.workbook)).find((value) => value.workOrderId === created.workOrderId)); }
export async function updateWorkOrder(sessionId: string, id: string, raw: unknown) { const input = validateWorkOrderInput(raw); const current = await load(sessionId); if (!current.workbook || !current.item) throw new WorkOrderNotInitializedError(); validateSchema(current.workbook); const existing = records(current.workbook); const previous = existing.find((value) => value.workOrderId === id); if (!previous) return null; const updated = await materialize(sessionId, input, existing, previous); if (existing.some((value) => value.workOrderId !== id && value.workOrderNumber.toLowerCase() === updated.workOrderNumber.toLowerCase())) throw new WorkOrderValidationError("That Work Order number is already in use."); if (!updateTableRecord(sheet(current.workbook), WORK_ORDERS_TABLE, "WorkOrderId", id, row(updated))) return null; return confirmReadback(updated, records(await persist(sessionId, current.item, current.workbook)).find((value) => value.workOrderId === id)); }
export async function deleteWorkOrder(sessionId: string, id: string) { const current = await load(sessionId); if (!current.workbook || !current.item) throw new WorkOrderNotInitializedError(); validateSchema(current.workbook); if (!deleteTableRecord(sheet(current.workbook), WORK_ORDERS_TABLE, "WorkOrderId", id)) return false; if (records(await persist(sessionId, current.item, current.workbook)).some((value) => value.workOrderId === id)) throw new Error("OneDrive did not confirm the work order deletion."); return true; }
export const isWorkOrderConflict = (error: unknown) => error instanceof OneDriveConflictError;
export const isWorkOrderGraphError = (error: unknown): error is OneDriveGraphError => error instanceof OneDriveGraphError;
