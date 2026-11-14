export const WORK_ORDERS_FOLDER = "Project Management/Work Orders";
export const WORK_ORDERS_WORKBOOK = "WorkOrders.xlsx";
export const WORK_ORDERS_SHEET = "Work Orders";
export const WORK_ORDERS_TABLE = "WorkOrders";
export const WORK_ORDER_STATUSES = ["Draft", "Issued", "In Progress", "Completed", "On Hold", "Cancelled"] as const;
export type WorkOrderStatus = typeof WORK_ORDER_STATUSES[number];

export const WORK_ORDER_COLUMNS = [
  "WorkOrderId", "WorkOrderNumber", "ProjectId", "ProjectName", "Title", "ContractorName",
  "ContractAmount", "IssueDate", "StartDate", "ExpectedCompletionDate", "Status", "Description",
  "BoqId", "BoqNumber", "CreatedAt", "UpdatedAt",
] as const;

export type WorkOrderInput = {
  workOrderNumber?: string;
  projectId: string;
  title: string;
  contractorName: string;
  contractAmount: number;
  issueDate: string;
  startDate: string;
  expectedCompletionDate: string;
  status: WorkOrderStatus;
  description: string | null;
  boqId: string | null;
};

export type WorkOrderRecord = WorkOrderInput & {
  workOrderId: string;
  workOrderNumber: string;
  projectName: string;
  boqNumber: string | null;
  createdAt: string;
  updatedAt: string;
};

export class WorkOrderValidationError extends Error {
  constructor(message: string) { super(message); this.name = "WorkOrderValidationError"; }
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new WorkOrderValidationError("Expected a Work Order object.");
  return value as Record<string, unknown>;
}

function requiredText(value: unknown, label: string, limit: number): string {
  if (typeof value !== "string" || !value.trim()) throw new WorkOrderValidationError(`${label} is required.`);
  const text = value.trim();
  if (text.length > limit) throw new WorkOrderValidationError(`${label} is too long.`);
  return text;
}

function optionalText(value: unknown, label: string, limit: number): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new WorkOrderValidationError(`${label} must be text.`);
  const text = value.trim();
  if (text.length > limit) throw new WorkOrderValidationError(`${label} is too long.`);
  return text || null;
}

function date(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new WorkOrderValidationError(`${label} must be a valid date.`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new WorkOrderValidationError(`${label} must be a valid date.`);
  return value;
}

export function validateWorkOrderInput(value: unknown): WorkOrderInput {
  const input = object(value);
  const status = input.status ?? "Draft";
  if (typeof status !== "string" || !WORK_ORDER_STATUSES.includes(status as WorkOrderStatus)) throw new WorkOrderValidationError("Work Order status is invalid.");
  const contractAmount = typeof input.contractAmount === "number" ? input.contractAmount : typeof input.contractAmount === "string" ? Number(input.contractAmount) : Number.NaN;
  if (!Number.isFinite(contractAmount) || contractAmount < 0) throw new WorkOrderValidationError("Contract amount must be a non-negative number.");
  const issueDate = date(input.issueDate, "Issue date");
  const startDate = date(input.startDate, "Start date");
  const expectedCompletionDate = date(input.expectedCompletionDate, "Expected completion date");
  if (expectedCompletionDate < startDate) throw new WorkOrderValidationError("Expected completion date must be on or after the start date.");
  const workOrderNumber = optionalText(input.workOrderNumber, "Work Order number", 80);
  return {
    workOrderNumber: workOrderNumber ?? undefined,
    projectId: requiredText(input.projectId, "Project", 100),
    title: requiredText(input.title, "Work Order title", 200),
    contractorName: requiredText(input.contractorName, "Contractor name", 200),
    contractAmount,
    issueDate,
    startDate,
    expectedCompletionDate,
    status: status as WorkOrderStatus,
    description: optionalText(input.description, "Description", 4000),
    boqId: optionalText(input.boqId, "BOQ reference", 100),
  };
}
