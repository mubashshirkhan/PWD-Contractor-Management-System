export const PROJECT_STATUSES = ["Planned", "In Progress", "On Hold", "Completed"] as const;
export const MILESTONE_STATUSES = ["Pending", "In Progress", "Completed"] as const;

export const PROJECT_TABLE = "ProjectsTable";
export const MILESTONE_TABLE = "MilestonesTable";
export const PROJECT_SHEET = "Projects";
export const MILESTONE_SHEET = "Milestones";
export const PROJECT_WORKBOOK = "ProjectTracking.xlsx";
export const PROJECT_FOLDER = "Project Management/Project Tracking";

export const PROJECT_COLUMNS = [
  "ProjectId", "ProjectName", "ClientDepartment", "Location", "Description", "ContractValue",
  "StartDate", "PlannedCompletionDate", "ActualCompletionDate", "Status", "IsArchived",
  "ArchivedAt", "CreatedAt", "UpdatedAt",
] as const;

export const MILESTONE_COLUMNS = [
  "MilestoneId", "ProjectId", "Title", "PlannedDate", "ActualDate", "Status", "Remarks", "CreatedAt", "UpdatedAt",
] as const;

export type ProjectStatus = typeof PROJECT_STATUSES[number];
export type MilestoneStatus = typeof MILESTONE_STATUSES[number];

export type ProjectInput = {
  projectName?: string;
  clientDepartment?: string | null;
  location?: string | null;
  description?: string | null;
  contractValue?: number | null;
  startDate?: string | null;
  plannedCompletionDate?: string | null;
  actualCompletionDate?: string | null;
  status?: ProjectStatus;
};

export type MilestoneInput = {
  title?: string;
  plannedDate?: string;
  actualDate?: string | null;
  status?: MilestoneStatus;
  remarks?: string | null;
};

export type MilestoneRecord = {
  milestoneId: string;
  projectId: string;
  title: string;
  plannedDate: string;
  actualDate: string | null;
  status: MilestoneStatus;
  displayStatus: MilestoneStatus | "Delayed";
  remarks: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ProjectRecord = {
  projectId: string;
  projectName: string;
  clientDepartment: string | null;
  location: string | null;
  description: string | null;
  contractValue: number | null;
  startDate: string | null;
  plannedCompletionDate: string | null;
  actualCompletionDate: string | null;
  status: ProjectStatus;
  isArchived: boolean;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  milestones: MilestoneRecord[];
  milestoneCounts: { pending: number; delayed: number; completed: number };
  progressPercent: number | null;
};

export class ProjectValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectValidationError";
  }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ProjectValidationError("Expected a JSON object.");
  return value as Record<string, unknown>;
}

function optionalText(value: unknown, label: string, maxLength: number): string | null {
  if (value === undefined) return null;
  if (value === null) return null;
  if (typeof value !== "string") throw new ProjectValidationError(`${label} must be text.`);
  const normalized = value.trim();
  if (normalized.length > maxLength) throw new ProjectValidationError(`${label} is too long (maximum ${maxLength} characters).`);
  return normalized || null;
}

function requiredText(value: unknown, label: string, maxLength: number): string {
  const normalized = optionalText(value, label, maxLength);
  if (!normalized) throw new ProjectValidationError(`${label} is required.`);
  return normalized;
}

function optionalDate(value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new ProjectValidationError(`${label} must be a valid date.`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new ProjectValidationError(`${label} must be a valid date.`);
  return value;
}

function optionalValue(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const amount = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(amount) || amount < 0) throw new ProjectValidationError("Contract value must be a non-negative number.");
  return amount;
}

function statusValue<T extends string>(value: unknown, allowed: readonly T[], label: string, fallback?: T): T {
  if (value === undefined && fallback) return fallback;
  if (typeof value === "string" && allowed.includes(value as T)) return value as T;
  throw new ProjectValidationError(`${label} is invalid.`);
}

export function validateProjectInput(value: unknown, partial = false): ProjectInput {
  const input = record(value);
  const output: ProjectInput = {};
  const fields: Array<[keyof ProjectInput, (value: unknown) => unknown]> = [
    ["projectName", (value) => requiredText(value, "Project name", 160)],
    ["clientDepartment", (value) => optionalText(value, "Client/department", 160)],
    ["location", (value) => optionalText(value, "Location", 200)],
    ["description", (value) => optionalText(value, "Description", 4000)],
    ["contractValue", optionalValue],
    ["startDate", (value) => optionalDate(value, "Start date")],
    ["plannedCompletionDate", (value) => optionalDate(value, "Planned completion date")],
    ["actualCompletionDate", (value) => optionalDate(value, "Actual completion date")],
    ["status", (value) => statusValue(value, PROJECT_STATUSES, "Project status", "Planned")],
  ];
  for (const [key, parser] of fields) {
    if (Object.hasOwn(input, key) || (!partial && key === "status")) {
      (output as Record<string, unknown>)[key] = parser(input[key]);
    } else if (!partial && key !== "projectName") {
      (output as Record<string, unknown>)[key] = parser(undefined);
    }
  }
  if (!partial && !output.projectName) throw new ProjectValidationError("Project name is required.");
  return output;
}

export function validateMilestoneInput(value: unknown, partial = false): MilestoneInput {
  const input = record(value);
  const output: MilestoneInput = {};
  const fields: Array<[keyof MilestoneInput, (value: unknown) => unknown]> = [
    ["title", (value) => requiredText(value, "Milestone title", 160)],
    ["plannedDate", (value) => {
      const date = optionalDate(value, "Planned date");
      if (!date) throw new ProjectValidationError("Planned date is required.");
      return date;
    }],
    ["actualDate", (value) => optionalDate(value, "Actual date")],
    ["status", (value) => statusValue(value, MILESTONE_STATUSES, "Milestone status", "Pending")],
    ["remarks", (value) => optionalText(value, "Remarks", 2000)],
  ];
  for (const [key, parser] of fields) {
    if (Object.hasOwn(input, key) || (!partial && key === "status")) {
      (output as Record<string, unknown>)[key] = parser(input[key]);
    } else if (!partial && key === "remarks") {
      (output as Record<string, unknown>)[key] = null;
    }
  }
  if (!partial && (!output.title || !output.plannedDate)) throw new ProjectValidationError("Milestone title and planned date are required.");
  return output;
}
