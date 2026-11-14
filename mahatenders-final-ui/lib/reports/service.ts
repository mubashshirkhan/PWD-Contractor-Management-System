import "server-only";
import { Workbook } from "exceljs";
import { listProjects } from "@/lib/projects/service";
import { listWorkOrders } from "@/lib/work-orders/service";
import { listBoqs } from "@/lib/boq/service";
import { createStructuredTable, serializeWorkbook } from "@/lib/onedrive/workbook";

export type ReportData = {
  projects: { available: boolean; reason: string | null; records: Awaited<ReturnType<typeof listProjects>>["projects"] };
  workOrders: { available: boolean; reason: string | null; records: Awaited<ReturnType<typeof listWorkOrders>>["workOrders"] };
  boqs: { available: boolean; reason: string | null; records: Awaited<ReturnType<typeof listBoqs>>["boqs"] };
  financialSummary: { available: false; reason: string };
};
export async function getReportData(sessionId: string): Promise<ReportData> {
  const [projectResult, workOrderResult, boqResult] = await Promise.allSettled([listProjects(sessionId), listWorkOrders(sessionId), listBoqs(sessionId)]);
  const projects = projectResult.status === "fulfilled" && projectResult.value.initialized
    ? { available: true, reason: null, records: projectResult.value.projects.filter((project) => !project.isArchived) }
    : { available: false, reason: projectResult.status === "rejected" ? "Project Tracking workbook is unavailable." : "Project Tracking workbook is not initialized.", records: [] as Awaited<ReturnType<typeof listProjects>>["projects"] };
  const workOrders = workOrderResult.status === "fulfilled" && workOrderResult.value.initialized
    ? { available: true, reason: null, records: workOrderResult.value.workOrders }
    : { available: false, reason: workOrderResult.status === "rejected" ? "Work Orders workbook is unavailable." : "Work Orders workbook is not initialized.", records: [] as Awaited<ReturnType<typeof listWorkOrders>>["workOrders"] };
  const boqs = boqResult.status === "fulfilled" && boqResult.value.initialized
    ? { available: true, reason: null, records: boqResult.value.boqs }
    : { available: false, reason: boqResult.status === "rejected" ? "BOQ workbook is unavailable." : "BOQ workbook is not initialized.", records: [] as Awaited<ReturnType<typeof listBoqs>>["boqs"] };
  return { projects, workOrders, boqs, financialSummary: { available: false, reason: "Payments & Expenses records are not available in a saved workbook." } };
}
export type ReportKind = "projects" | "work-orders" | "boqs";
export function filterReportRows(data: ReportData, kind: ReportKind, filters: { from?: string; to?: string; projectId?: string; status?: string }) {
  const rows: Record<string, string | number>[] = kind === "projects" ? data.projects.records.map((p) => ({ "Project Name": p.projectName, Client: p.clientDepartment ?? "", "Contract Value (INR)": p.contractValue ?? "", "Start Date": p.startDate ?? "", "Expected Completion": p.plannedCompletionDate ?? "", Status: p.status, Progress: p.progressPercent === null ? "Not tracked" : `${p.progressPercent}%`, ProjectId: p.projectId }))
    : kind === "work-orders" ? data.workOrders.records.map((w) => ({ "Work Order Number": w.workOrderNumber, Project: w.projectName, Contractor: w.contractorName, "Issue Date": w.issueDate, "Contract Amount (INR)": w.contractAmount, Status: w.status, ProjectId: w.projectId }))
    : data.boqs.records.map((b) => ({ "BOQ Number": b.boqNumber, Project: b.projectName, "BOQ Date": b.boqDate, Subtotal: b.subtotal, Tax: b.taxAmount, Discount: b.discountAmount, "Grand Total": b.grandTotal, Status: b.status, ProjectId: b.projectId }));
  const dateKey = kind === "projects" ? "Start Date" : kind === "work-orders" ? "Issue Date" : "BOQ Date";
  return rows.filter((row) => (!filters.projectId || row.ProjectId === filters.projectId) && (!filters.status || row.Status === filters.status) && (!filters.from || String(row[dateKey] ?? "") >= filters.from) && (!filters.to || String(row[dateKey] ?? "") <= filters.to)).map(({ ProjectId: _projectId, ...row }) => row);
}
export async function exportReport(data: ReportData, kind: ReportKind, filters: { from?: string; to?: string; projectId?: string; status?: string }) {
  const rows = filterReportRows(data, kind, filters); const workbook = new Workbook(); const worksheet = workbook.addWorksheet(kind === "work-orders" ? "Work Orders" : kind === "boqs" ? "BOQs" : "Projects");
  const headers = rows.length ? Object.keys(rows[0]) : kind === "projects" ? ["Project Name", "Client", "Contract Value (INR)", "Start Date", "Expected Completion", "Status", "Progress"] : kind === "work-orders" ? ["Work Order Number", "Project", "Contractor", "Issue Date", "Contract Amount (INR)", "Status"] : ["BOQ Number", "Project", "BOQ Date", "Subtotal", "Tax", "Discount", "Grand Total", "Status"];
  createStructuredTable(worksheet, "ReportData", headers, rows); return { fileName: `${kind}-report.xlsx`, contents: await serializeWorkbook(workbook) };
}
