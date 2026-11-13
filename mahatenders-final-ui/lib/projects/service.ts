import "server-only";

import { randomUUID } from "node:crypto";
import { Workbook, type CellValue, type Worksheet } from "exceljs";
import {
  addTableRecord,
  createStructuredTable,
  createWorksheet,
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
import {
  MILESTONE_COLUMNS,
  MILESTONE_SHEET,
  MILESTONE_STATUSES,
  MILESTONE_TABLE,
  PROJECT_COLUMNS,
  PROJECT_FOLDER,
  PROJECT_SHEET,
  PROJECT_STATUSES,
  PROJECT_TABLE,
  PROJECT_WORKBOOK,
  ProjectValidationError,
  validateMilestoneInput,
  validateProjectInput,
  type MilestoneInput,
  type MilestoneRecord,
  type MilestoneStatus,
  type ProjectInput,
  type ProjectRecord,
  type ProjectStatus,
} from "./model";

export class ProjectWorkbookNotInitializedError extends Error {
  constructor() {
    super("Initialize the Project Tracking workbook in OneDrive before using project records.");
    this.name = "ProjectWorkbookNotInitializedError";
  }
}

export class ProjectWorkbookSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectWorkbookSchemaError";
  }
}

type LoadedWorkbook = {
  folderPath: string;
  item: OneDriveDriveItem | null;
  workbook: Workbook | null;
};

function trackingFolderPath(): string {
  const config = readOneDriveConfig();
  if (!config) throw new Error("Microsoft sign-in is not configured.");
  return `${config.rootFolder}/${PROJECT_FOLDER}`;
}

function normalizeCellText(value: CellValue): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).trim() || null;
}

function normalizeStatus<T extends string>(value: CellValue, allowed: readonly T[], label: string): T {
  const text = normalizeCellText(value);
  if (text && allowed.includes(text as T)) return text as T;
  throw new ProjectWorkbookSchemaError(`The stored ${label} value is not recognized.`);
}

function normalizeBoolean(value: CellValue): boolean {
  if (value === true || value === 1) return true;
  if (typeof value === "string") return ["true", "1", "yes"].includes(value.toLowerCase());
  return false;
}

function normalizeNumber(value: CellValue): number | null {
  if (value === null || value === undefined || value === "") return null;
  const result = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(result)) throw new ProjectWorkbookSchemaError("A stored contract value is not numeric.");
  return result;
}

function readProjectRows(workbook: Workbook): WorkbookRecord[] {
  const worksheet = workbook.getWorksheet(PROJECT_SHEET);
  if (!worksheet) throw new ProjectWorkbookSchemaError(`The '${PROJECT_SHEET}' worksheet is missing.`);
  return readTableRecords(worksheet, PROJECT_TABLE);
}

function readMilestoneRows(workbook: Workbook): WorkbookRecord[] {
  const worksheet = workbook.getWorksheet(MILESTONE_SHEET);
  if (!worksheet) throw new ProjectWorkbookSchemaError(`The '${MILESTONE_SHEET}' worksheet is missing.`);
  return readTableRecords(worksheet, MILESTONE_TABLE);
}

function milestoneFromRow(row: WorkbookRecord, today: string): MilestoneRecord {
  const plannedDate = normalizeCellText(row.PlannedDate as CellValue);
  if (!row.MilestoneId || !row.ProjectId || !row.Title || !plannedDate) {
    throw new ProjectWorkbookSchemaError("A stored milestone is missing its ID, project ID, title, or planned date.");
  }
  const status = normalizeStatus(row.Status as CellValue, MILESTONE_STATUSES, "milestone status");
  const actualDate = normalizeCellText(row.ActualDate as CellValue);
  const complete = status === "Completed" || Boolean(actualDate);
  const delayed = !complete && plannedDate < today;
  return {
    milestoneId: String(row.MilestoneId),
    projectId: String(row.ProjectId),
    title: String(row.Title),
    plannedDate,
    actualDate,
    status,
    displayStatus: delayed ? "Delayed" : status,
    remarks: normalizeCellText(row.Remarks as CellValue),
    createdAt: normalizeCellText(row.CreatedAt as CellValue) ?? "",
    updatedAt: normalizeCellText(row.UpdatedAt as CellValue) ?? "",
  };
}

function projectFromRows(row: WorkbookRecord, milestones: MilestoneRecord[], today: string): ProjectRecord {
  if (!row.ProjectId || !row.ProjectName) throw new ProjectWorkbookSchemaError("A stored project is missing its ID or name.");
  const status = normalizeStatus(row.Status as CellValue, PROJECT_STATUSES, "project status");
  const projectMilestones = milestones.filter((milestone) => milestone.projectId === String(row.ProjectId));
  const completed = projectMilestones.filter((milestone) => milestone.status === "Completed" || Boolean(milestone.actualDate)).length;
  const delayed = projectMilestones.filter((milestone) => milestone.displayStatus === "Delayed").length;
  const pending = projectMilestones.length - completed - delayed;
  return {
    projectId: String(row.ProjectId),
    projectName: String(row.ProjectName),
    clientDepartment: normalizeCellText(row.ClientDepartment as CellValue),
    location: normalizeCellText(row.Location as CellValue),
    description: normalizeCellText(row.Description as CellValue),
    contractValue: normalizeNumber(row.ContractValue as CellValue),
    startDate: normalizeCellText(row.StartDate as CellValue),
    plannedCompletionDate: normalizeCellText(row.PlannedCompletionDate as CellValue),
    actualCompletionDate: normalizeCellText(row.ActualCompletionDate as CellValue),
    status,
    isArchived: normalizeBoolean(row.IsArchived as CellValue),
    archivedAt: normalizeCellText(row.ArchivedAt as CellValue),
    createdAt: normalizeCellText(row.CreatedAt as CellValue) ?? "",
    updatedAt: normalizeCellText(row.UpdatedAt as CellValue) ?? "",
    milestones: projectMilestones,
    milestoneCounts: { pending, delayed, completed },
    progressPercent: projectMilestones.length ? Math.round(completed / projectMilestones.length * 100) : null,
  };
}

function projectRowsToRecords(workbook: Workbook): ProjectRecord[] {
  const today = new Date().toISOString().slice(0, 10);
  const projects = readProjectRows(workbook);
  const milestones = readMilestoneRows(workbook).map((row) => milestoneFromRow(row, today));
  const projectIds = projects.map((row) => String(row.ProjectId ?? ""));
  const milestoneIds = milestones.map((row) => row.milestoneId);
  if (new Set(projectIds).size !== projectIds.length || projectIds.some((id) => !id)) {
    throw new ProjectWorkbookSchemaError("Project IDs in the workbook must be present and unique.");
  }
  if (new Set(milestoneIds).size !== milestoneIds.length) {
    throw new ProjectWorkbookSchemaError("Milestone IDs in the workbook must be unique.");
  }
  const knownProjects = new Set(projectIds);
  if (milestones.some((milestone) => !knownProjects.has(milestone.projectId))) {
    throw new ProjectWorkbookSchemaError("The workbook contains a milestone linked to a missing project.");
  }
  return projects.map((row) => projectFromRows(row, milestones, today));
}

function tableColumnNames(worksheet: Worksheet, tableName: string): string[] | null {
  return structuredTableColumnNames(worksheet, tableName);
}

function workbookTableNames(worksheet: Worksheet): string[] {
  const internals = worksheet as unknown as { tables?: Record<string, unknown> };
  return Object.keys(internals.tables ?? {});
}

function ensureTable(workbook: Workbook, sheetName: string, tableName: string, columns: readonly string[]): boolean {
  let worksheet = workbook.getWorksheet(sheetName);
  if (!worksheet) worksheet = createWorksheet(workbook, sheetName);
  const existingColumns = tableColumnNames(worksheet, tableName);
  if (existingColumns) {
    if (existingColumns.length !== columns.length || existingColumns.some((column, index) => column !== columns[index])) {
      throw new ProjectWorkbookSchemaError(`The '${tableName}' table has columns that differ from the supported Project Tracking schema.`);
    }
    return false;
  }
  if (workbookTableNames(worksheet).length) {
    throw new ProjectWorkbookSchemaError(`The '${sheetName}' worksheet already has a different table; it was left unchanged.`);
  }
  if (worksheet.actualRowCount) {
    throw new ProjectWorkbookSchemaError(`The '${sheetName}' worksheet contains existing data but no supported table; it was left unchanged.`);
  }
  createStructuredTable(worksheet, tableName, [...columns]);
  return true;
}

function ensureSchema(workbook: Workbook): boolean {
  const projectsChanged = ensureTable(workbook, PROJECT_SHEET, PROJECT_TABLE, PROJECT_COLUMNS);
  const milestonesChanged = ensureTable(workbook, MILESTONE_SHEET, MILESTONE_TABLE, MILESTONE_COLUMNS);
  return projectsChanged || milestonesChanged;
}

function validateSchema(workbook: Workbook): void {
  const projectWorksheet = workbook.getWorksheet(PROJECT_SHEET);
  const milestoneWorksheet = workbook.getWorksheet(MILESTONE_SHEET);
  if (!projectWorksheet || !milestoneWorksheet) throw new ProjectWorkbookSchemaError("The Project Tracking workbook is missing a required worksheet.");
  const projectNames = tableColumnNames(projectWorksheet, PROJECT_TABLE);
  const milestoneNames = tableColumnNames(milestoneWorksheet, MILESTONE_TABLE);
  if (!projectNames || projectNames.join("\0") !== PROJECT_COLUMNS.join("\0")) throw new ProjectWorkbookSchemaError(`The '${PROJECT_TABLE}' table is missing or does not match the supported schema.`);
  if (!milestoneNames || milestoneNames.join("\0") !== MILESTONE_COLUMNS.join("\0")) throw new ProjectWorkbookSchemaError(`The '${MILESTONE_TABLE}' table is missing or does not match the supported schema.`);
}

async function loadWorkbook(sessionId: string): Promise<LoadedWorkbook> {
  const folderPath = trackingFolderPath();
  const folder = await findDriveItemByPath(sessionId, folderPath);
  if (!folder.folder) throw new ProjectWorkbookSchemaError(`The existing OneDrive folder '${PROJECT_FOLDER}' was not found as a folder.`);
  try {
    const item = await findWorkbookByFolderAndName(sessionId, folderPath, PROJECT_WORKBOOK);
    const downloaded = await downloadWorkbookByItemId(sessionId, item.id);
    return { folderPath, item: downloaded.item, workbook: await openWorkbook(downloaded.content) };
  } catch (error) {
    if (error instanceof OneDriveGraphError && error.status === 404) return { folderPath, item: null, workbook: null };
    throw error;
  }
}

function projectToRow(project: ProjectRecord): WorkbookRecord {
  return {
    ProjectId: project.projectId,
    ProjectName: project.projectName,
    ClientDepartment: project.clientDepartment,
    Location: project.location,
    Description: project.description,
    ContractValue: project.contractValue,
    StartDate: project.startDate,
    PlannedCompletionDate: project.plannedCompletionDate,
    ActualCompletionDate: project.actualCompletionDate,
    Status: project.status,
    IsArchived: project.isArchived,
    ArchivedAt: project.archivedAt,
    CreatedAt: project.createdAt,
    UpdatedAt: project.updatedAt,
  };
}

function milestoneToRow(milestone: MilestoneRecord): WorkbookRecord {
  return {
    MilestoneId: milestone.milestoneId,
    ProjectId: milestone.projectId,
    Title: milestone.title,
    PlannedDate: milestone.plannedDate,
    ActualDate: milestone.actualDate,
    Status: milestone.status,
    Remarks: milestone.remarks,
    CreatedAt: milestone.createdAt,
    UpdatedAt: milestone.updatedAt,
  };
}

function applyProjectInput(current: ProjectRecord | null, input: ProjectInput, now: string, projectId: string): ProjectRecord {
  const project: ProjectRecord = {
    projectId,
    projectName: input.projectName ?? current?.projectName ?? "",
    clientDepartment: input.clientDepartment === undefined ? current?.clientDepartment ?? null : input.clientDepartment,
    location: input.location === undefined ? current?.location ?? null : input.location,
    description: input.description === undefined ? current?.description ?? null : input.description,
    contractValue: input.contractValue === undefined ? current?.contractValue ?? null : input.contractValue,
    startDate: input.startDate === undefined ? current?.startDate ?? null : input.startDate,
    plannedCompletionDate: input.plannedCompletionDate === undefined ? current?.plannedCompletionDate ?? null : input.plannedCompletionDate,
    actualCompletionDate: input.actualCompletionDate === undefined ? current?.actualCompletionDate ?? null : input.actualCompletionDate,
    status: input.status ?? current?.status ?? "Planned",
    isArchived: current?.isArchived ?? false,
    archivedAt: current?.archivedAt ?? null,
    createdAt: current?.createdAt ?? now,
    updatedAt: now,
    milestones: current?.milestones ?? [],
    milestoneCounts: current?.milestoneCounts ?? { pending: 0, delayed: 0, completed: 0 },
    progressPercent: current?.progressPercent ?? null,
  };
  if (project.startDate && project.plannedCompletionDate && project.plannedCompletionDate < project.startDate) {
    throw new ProjectValidationError("Planned completion date must be on or after the start date.");
  }
  if (project.actualCompletionDate && project.startDate && project.actualCompletionDate < project.startDate) {
    throw new ProjectValidationError("Actual completion date must be on or after the start date.");
  }
  return project;
}

async function persistExisting(sessionId: string, item: OneDriveDriveItem, workbook: Workbook): Promise<Workbook> {
  await uploadWorkbookContentsSafely(sessionId, item.id, await serializeWorkbook(workbook), item.eTag);
  const stored = await downloadWorkbookByItemId(sessionId, item.id);
  const persisted = await openWorkbook(stored.content);
  validateSchema(persisted);
  return persisted;
}

export async function initializeProjectWorkbook(sessionId: string): Promise<{ created: boolean; projectCount: number; folderPath: string }> {
  const current = await loadWorkbook(sessionId);
  if (!current.workbook || !current.item) {
    const workbook = new Workbook();
    ensureSchema(workbook);
    const uploaded = await uploadNewFileContentsSafely(sessionId, current.folderPath, PROJECT_WORKBOOK, await serializeWorkbook(workbook));
    const stored = await downloadWorkbookByItemId(sessionId, uploaded.id);
    const persisted = await openWorkbook(stored.content);
    validateSchema(persisted);
    return { created: true, projectCount: projectRowsToRecords(persisted).length, folderPath: current.folderPath };
  }

  const changed = ensureSchema(current.workbook);
  if (changed) await persistExisting(sessionId, current.item, current.workbook);
  const verified = await downloadWorkbookByItemId(sessionId, current.item.id);
  const persisted = await openWorkbook(verified.content);
  validateSchema(persisted);
  return { created: false, projectCount: projectRowsToRecords(persisted).length, folderPath: current.folderPath };
}

export async function listProjects(sessionId: string): Promise<{ initialized: boolean; projects: ProjectRecord[] }> {
  const current = await loadWorkbook(sessionId);
  if (!current.workbook) return { initialized: false, projects: [] };
  validateSchema(current.workbook);
  return { initialized: true, projects: projectRowsToRecords(current.workbook) };
}

export async function getProject(sessionId: string, projectId: string): Promise<ProjectRecord | null> {
  const { projects } = await listProjects(sessionId);
  return projects.find((project) => project.projectId === projectId) ?? null;
}

export async function createProject(sessionId: string, rawInput: unknown): Promise<ProjectRecord> {
  const input = validateProjectInput(rawInput);
  const current = await loadWorkbook(sessionId);
  if (!current.workbook || !current.item) throw new ProjectWorkbookNotInitializedError();
  validateSchema(current.workbook);
  const existingIds = new Set(projectRowsToRecords(current.workbook).map((project) => project.projectId));
  let projectId = `PRJ-${randomUUID().toUpperCase()}`;
  while (existingIds.has(projectId)) projectId = `PRJ-${randomUUID().toUpperCase()}`;
  const project = applyProjectInput(null, input, new Date().toISOString(), projectId);
  const projectWorksheet = current.workbook.getWorksheet(PROJECT_SHEET)!;
  addTableRecord(projectWorksheet, PROJECT_TABLE, projectToRow(project));
  const persisted = await persistExisting(sessionId, current.item, current.workbook);
  const record = projectRowsToRecords(persisted).find((entry) => entry.projectId === projectId);
  if (!record) throw new Error("Microsoft Graph accepted the update, but the project could not be confirmed on readback.");
  return record;
}

export async function updateProject(sessionId: string, projectId: string, rawInput: unknown): Promise<ProjectRecord | null> {
  const input = validateProjectInput(rawInput, true);
  const current = await loadWorkbook(sessionId);
  if (!current.workbook || !current.item) throw new ProjectWorkbookNotInitializedError();
  validateSchema(current.workbook);
  const projects = projectRowsToRecords(current.workbook);
  const existing = projects.find((project) => project.projectId === projectId);
  if (!existing) return null;
  const updated = applyProjectInput(existing, input, new Date().toISOString(), projectId);
  const worksheet = current.workbook.getWorksheet(PROJECT_SHEET)!;
  const changed = updateTableRecord(worksheet, PROJECT_TABLE, "ProjectId", projectId, projectToRow(updated));
  if (!changed) return null;
  const persisted = await persistExisting(sessionId, current.item, current.workbook);
  return projectRowsToRecords(persisted).find((project) => project.projectId === projectId) ?? null;
}

export async function archiveProject(sessionId: string, projectId: string): Promise<ProjectRecord | null> {
  const current = await loadWorkbook(sessionId);
  if (!current.workbook || !current.item) throw new ProjectWorkbookNotInitializedError();
  validateSchema(current.workbook);
  const projects = projectRowsToRecords(current.workbook);
  const existing = projects.find((project) => project.projectId === projectId);
  if (!existing) return null;
  if (!existing.isArchived) {
    const worksheet = current.workbook.getWorksheet(PROJECT_SHEET)!;
    updateTableRecord(worksheet, PROJECT_TABLE, "ProjectId", projectId, {
      IsArchived: true,
      ArchivedAt: new Date().toISOString(),
      UpdatedAt: new Date().toISOString(),
    });
    const persisted = await persistExisting(sessionId, current.item, current.workbook);
    return projectRowsToRecords(persisted).find((project) => project.projectId === projectId) ?? null;
  }
  return existing;
}

export async function addProjectMilestone(sessionId: string, projectId: string, rawInput: unknown): Promise<MilestoneRecord> {
  const input = validateMilestoneInput(rawInput);
  const current = await loadWorkbook(sessionId);
  if (!current.workbook || !current.item) throw new ProjectWorkbookNotInitializedError();
  validateSchema(current.workbook);
  const projects = projectRowsToRecords(current.workbook);
  const project = projects.find((entry) => entry.projectId === projectId);
  if (!project) throw new ProjectValidationError("Project was not found.");
  if (project.isArchived) throw new ProjectValidationError("Milestones cannot be added to an archived project.");
  const existingMilestoneIds = new Set(projects.flatMap((entry) => entry.milestones.map((milestone) => milestone.milestoneId)));
  let milestoneId = `MS-${randomUUID().toUpperCase()}`;
  while (existingMilestoneIds.has(milestoneId)) milestoneId = `MS-${randomUUID().toUpperCase()}`;
  const now = new Date().toISOString();
  const milestone: MilestoneRecord = {
    milestoneId,
    projectId,
    title: input.title!,
    plannedDate: input.plannedDate!,
    actualDate: input.actualDate ?? null,
    status: input.status ?? "Pending",
    displayStatus: input.status === "Completed" ? "Completed" : "Pending",
    remarks: input.remarks ?? null,
    createdAt: now,
    updatedAt: now,
  };
  const worksheet = current.workbook.getWorksheet(MILESTONE_SHEET)!;
  addTableRecord(worksheet, MILESTONE_TABLE, milestoneToRow(milestone));
  const persisted = await persistExisting(sessionId, current.item, current.workbook);
  const stored = projectRowsToRecords(persisted).flatMap((entry) => entry.milestones).find((entry) => entry.milestoneId === milestone.milestoneId);
  if (!stored) throw new Error("Microsoft Graph accepted the update, but the milestone could not be confirmed on readback.");
  return stored;
}

export async function updateProjectMilestone(
  sessionId: string,
  projectId: string,
  milestoneId: string,
  rawInput: unknown,
): Promise<MilestoneRecord | null> {
  const input: MilestoneInput = validateMilestoneInput(rawInput, true);
  const current = await loadWorkbook(sessionId);
  if (!current.workbook || !current.item) throw new ProjectWorkbookNotInitializedError();
  validateSchema(current.workbook);
  const projects = projectRowsToRecords(current.workbook);
  const project = projects.find((entry) => entry.projectId === projectId);
  if (!project) return null;
  if (project.isArchived) throw new ProjectValidationError("Milestones cannot be edited on an archived project.");
  const existing = project.milestones.find((entry) => entry.milestoneId === milestoneId);
  if (!existing) return null;
  const updated: MilestoneRecord = {
    ...existing,
    title: input.title ?? existing.title,
    plannedDate: input.plannedDate ?? existing.plannedDate,
    actualDate: input.actualDate === undefined ? existing.actualDate : input.actualDate,
    status: input.status ?? existing.status,
    displayStatus: input.status === "Completed" || (input.status === undefined && existing.status === "Completed") ? "Completed" : existing.displayStatus,
    remarks: input.remarks === undefined ? existing.remarks : input.remarks,
    updatedAt: new Date().toISOString(),
  };
  const worksheet = current.workbook.getWorksheet(MILESTONE_SHEET)!;
  const changed = updateTableRecord(worksheet, MILESTONE_TABLE, "MilestoneId", milestoneId, milestoneToRow(updated));
  if (!changed) return null;
  const persisted = await persistExisting(sessionId, current.item, current.workbook);
  return projectRowsToRecords(persisted).flatMap((entry) => entry.milestones).find((entry) => entry.milestoneId === milestoneId) ?? null;
}

export function isProjectConflict(error: unknown): error is OneDriveConflictError {
  return error instanceof OneDriveConflictError;
}

export function isProjectValidationError(error: unknown): error is ProjectValidationError {
  return error instanceof ProjectValidationError;
}

export function isProjectNotInitialized(error: unknown): error is ProjectWorkbookNotInitializedError {
  return error instanceof ProjectWorkbookNotInitializedError;
}

export function isProjectSchemaError(error: unknown): error is ProjectWorkbookSchemaError {
  return error instanceof ProjectWorkbookSchemaError;
}

export function isOneDriveGraphFailure(error: unknown): error is OneDriveGraphError {
  return error instanceof OneDriveGraphError;
}
