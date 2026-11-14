export const BOQ_FOLDER = "BOQ";
export const BOQ_WORKBOOK = "BOQ.xlsx";
export const BOQ_SHEET = "BOQs";
export const BOQ_ITEMS_SHEET = "BOQ Items";
export const BOQ_TABLE = "BOQsTable";
export const BOQ_ITEMS_TABLE = "BOQItemsTable";
export const BOQ_STATUSES = ["Draft", "Finalized"] as const;
export type BoqStatus = typeof BOQ_STATUSES[number];

export const BOQ_COLUMNS = [
  "BoqId", "BoqNumber", "Title", "BoqDate", "ProjectId", "ProjectName", "WorkOrderId", "Description", "Status",
  "TaxPercent", "AdditionalCharges", "DiscountPercent", "Subtotal", "TaxAmount", "DiscountAmount", "GrandTotal", "CreatedAt", "UpdatedAt",
] as const;

export const BOQ_ITEM_COLUMNS = ["BoqItemId", "BoqId", "ItemNumber", "Description", "Unit", "Quantity", "Rate", "Amount"] as const;

export type BoqItemInput = { description: string; unit: string; quantity: number; rate: number };
export type BoqInput = {
  title: string;
  boqDate: string;
  projectId: string;
  workOrderId: string | null;
  description: string | null;
  status: BoqStatus;
  taxPercent: number;
  additionalCharges: number;
  discountPercent: number;
  items: BoqItemInput[];
};
export type BoqItemRecord = BoqItemInput & { boqItemId: string; itemNumber: number; amount: number };
export type BoqRecord = Omit<BoqInput, "items"> & {
  boqId: string;
  boqNumber: string;
  projectName: string;
  subtotal: number;
  taxAmount: number;
  discountAmount: number;
  grandTotal: number;
  createdAt: string;
  updatedAt: string;
  items: BoqItemRecord[];
};

export class BoqValidationError extends Error {
  constructor(message: string) { super(message); this.name = "BoqValidationError"; }
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new BoqValidationError("Expected a BOQ object.");
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string, max: number, required = false): string | null {
  if (value === undefined || value === null) {
    if (required) throw new BoqValidationError(`${label} is required.`);
    return null;
  }
  if (typeof value !== "string") throw new BoqValidationError(`${label} must be text.`);
  const normalized = value.trim();
  if (normalized.length > max) throw new BoqValidationError(`${label} is too long.`);
  if (required && !normalized) throw new BoqValidationError(`${label} is required.`);
  return normalized || null;
}

function number(value: unknown, label: string, max?: number): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < 0 || (max !== undefined && parsed > max)) {
    throw new BoqValidationError(`${label} must be a valid non-negative number${max === undefined ? "" : ` no greater than ${max}`}.`);
  }
  return parsed;
}

function validDate(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BoqValidationError("BOQ date must be a valid date.");
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new BoqValidationError("BOQ date must be a valid date.");
  return value;
}

export function validateBoqInput(value: unknown): BoqInput {
  const input = asObject(value);
  const items = input.items;
  if (!Array.isArray(items) || items.length < 1 || items.length > 500) throw new BoqValidationError("A BOQ must contain between 1 and 500 items.");
  const status = input.status === undefined ? "Draft" : input.status;
  if (typeof status !== "string" || !BOQ_STATUSES.includes(status as BoqStatus)) throw new BoqValidationError("BOQ status is invalid.");
  return {
    title: text(input.title, "Title", 200, true)!,
    boqDate: validDate(input.boqDate),
    projectId: text(input.projectId, "Project", 100, true)!,
    workOrderId: text(input.workOrderId, "Work Order reference", 100),
    description: text(input.description, "Description", 4000),
    status: status as BoqStatus,
    taxPercent: number(input.taxPercent ?? 0, "Tax percentage", 100),
    additionalCharges: number(input.additionalCharges ?? 0, "Additional charges"),
    discountPercent: number(input.discountPercent ?? 0, "Discount percentage", 100),
    items: items.map((value, index) => {
      const item = asObject(value);
      return {
        description: text(item.description, `Item ${index + 1} description`, 1000, true)!,
        unit: text(item.unit, `Item ${index + 1} unit`, 40, true)!,
        quantity: number(item.quantity, `Item ${index + 1} quantity`),
        rate: number(item.rate, `Item ${index + 1} rate`),
      };
    }),
  };
}

export function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function calculateBoq(input: Pick<BoqInput, "items" | "taxPercent" | "additionalCharges" | "discountPercent">) {
  const items = input.items.map((item) => ({ ...item, amount: roundCurrency(item.quantity * item.rate) }));
  const subtotal = roundCurrency(items.reduce((sum, item) => sum + item.amount, 0));
  const taxAmount = roundCurrency(subtotal * input.taxPercent / 100);
  const discountAmount = roundCurrency(subtotal * input.discountPercent / 100);
  const grandTotal = roundCurrency(subtotal + taxAmount + input.additionalCharges - discountAmount);
  return { items, subtotal, taxAmount, discountAmount, grandTotal };
}
