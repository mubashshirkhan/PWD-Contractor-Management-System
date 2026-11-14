"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Printer, RefreshCw } from "lucide-react";
import { SectionHeader } from "@/components/section-header";

type Project = { projectId: string; projectName: string; clientDepartment: string | null; contractValue: number | null; startDate: string | null; plannedCompletionDate: string | null; status: string; progressPercent: number | null };
type WorkOrder = { workOrderId: string; workOrderNumber: string; projectId: string; projectName: string; contractorName: string; issueDate: string; contractAmount: number; status: string };
type Boq = { boqId: string; boqNumber: string; projectId: string; projectName: string; boqDate: string; subtotal: number; taxAmount: number; discountAmount: number; grandTotal: number; status: string };
type Source<T> = { available: boolean; reason: string | null; records: T[] };
type Data = { projects: Source<Project>; workOrders: Source<WorkOrder>; boqs: Source<Boq>; financialSummary: { available: boolean; reason: string } };
type Kind = "projects" | "work-orders" | "boqs";
type Filters = { from: string; to: string; projectId: string; status: string };
const card = "rounded-xl border border-line bg-white p-5 shadow-sm";
const button = "inline-flex items-center justify-center gap-2 rounded-md border border-line bg-white px-3 py-2 text-sm font-medium text-ink hover:bg-field disabled:opacity-50";
const field = "field mt-1 w-full";
function money(value: number) { return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(value); }
async function read<T>(response: Response): Promise<T> { const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : `Request failed (${response.status}).`); return body as T; }

export function Reports() {
  const [data, setData] = useState<Data | null>(null); const [loading, setLoading] = useState(true); const [error, setError] = useState(""); const [kind, setKind] = useState<Kind>("projects"); const [filters, setFilters] = useState<Filters>({ from: "", to: "", projectId: "", status: "" });
  const load = useCallback(async () => { setLoading(true); setError(""); try { setData(await read<Data>(await fetch("/api/reports", { cache: "no-store" }))); } catch (e) { setError(e instanceof Error ? e.message : "Reports could not read OneDrive workbooks."); } finally { setLoading(false); } }, []);
  useEffect(() => { void load(); }, [load]);
  const source = kind === "projects" ? data?.projects : kind === "work-orders" ? data?.workOrders : data?.boqs;
  const projectList = useMemo(() => { const items = [...(data?.projects.records ?? []).map((p) => ({ projectId: p.projectId, projectName: p.projectName })), ...(data?.workOrders.records ?? []).map((w) => ({ projectId: w.projectId, projectName: w.projectName }))]; return [...new Map(items.map((p) => [p.projectId, p])).values()]; }, [data]);
  const statuses = useMemo(() => [...new Set((source?.records ?? []).map((value) => (value as { status: string }).status))], [source]);
  const rows = useMemo(() => {
    if (!source?.available) return [] as Record<string, string | number>[];
    if (kind === "projects") return (data?.projects.records ?? []).filter((p) => (!filters.projectId || p.projectId === filters.projectId) && (!filters.status || p.status === filters.status) && (!filters.from || String(p.startDate ?? "") >= filters.from) && (!filters.to || String(p.startDate ?? "") <= filters.to)).map((p) => ({ "Project name": p.projectName, Client: p.clientDepartment ?? "—", "Contract value": p.contractValue === null ? "—" : money(p.contractValue), "Start date": p.startDate ?? "—", "Expected completion": p.plannedCompletionDate ?? "—", Status: p.status, Progress: p.progressPercent === null ? "Not tracked" : `${p.progressPercent}%` }));
    if (kind === "work-orders") return (data?.workOrders.records ?? []).filter((w) => (!filters.projectId || w.projectId === filters.projectId) && (!filters.status || w.status === filters.status) && (!filters.from || w.issueDate >= filters.from) && (!filters.to || w.issueDate <= filters.to)).map((w) => ({ "Work order number": w.workOrderNumber, Project: w.projectName, Contractor: w.contractorName, "Issue date": w.issueDate, "Contract amount": money(w.contractAmount), Status: w.status }));
    return (data?.boqs.records ?? []).filter((b) => (!filters.projectId || b.projectId === filters.projectId) && (!filters.status || b.status === filters.status) && (!filters.from || b.boqDate >= filters.from) && (!filters.to || b.boqDate <= filters.to)).map((b) => ({ "BOQ number": b.boqNumber, Project: b.projectName, Date: b.boqDate, Subtotal: money(b.subtotal), Tax: money(b.taxAmount), Discount: money(b.discountAmount), "Grand total": money(b.grandTotal) }));
  }, [data, filters, kind, source]);
  async function exportExcel() { const params = new URLSearchParams({ type: kind }); for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value); try { const response = await fetch(`/api/reports/export?${params}`); if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? "Export failed."); const blob = await response.blob(); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${kind}-report.xlsx`; anchor.click(); URL.revokeObjectURL(url); } catch (e) { setError(e instanceof Error ? e.message : "Report export failed."); } }
  const workOrders = data?.workOrders.records ?? [];
  const activeCount = workOrders.filter((w) => ["Issued", "In Progress"].includes(w.status)).length;
  const completedCount = workOrders.filter((w) => w.status === "Completed").length;
  const summary = [
    ["Total Projects", data?.projects.available ? String(data.projects.records.length) : "Unavailable", data?.projects.reason],
    ["Total Work Orders", data?.workOrders.available ? String(workOrders.length) : "Unavailable", data?.workOrders.reason],
    ["Active Work Orders", data?.workOrders.available ? String(activeCount) : "Unavailable", data?.workOrders.reason],
    ["Completed Work Orders", data?.workOrders.available ? String(completedCount) : "Unavailable", data?.workOrders.reason],
    ["Total Work Order Value", data?.workOrders.available ? money(workOrders.reduce((sum, w) => sum + w.contractAmount, 0)) : "Unavailable", data?.workOrders.reason],
  ] as const;
  return <div>
    <SectionHeader eyebrow="Project operations" title="Reports" description="Review and export summaries from saved OneDrive workbooks." action={<button className={button} onClick={() => void load()} disabled={loading}><RefreshCw size={16}/> Refresh</button>} />
    {error && <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {loading && !data ? <p className="py-8 text-sm text-muted">Reading saved OneDrive records…</p> : <>
      <section className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{summary.map(([label, value, unavailable]) => <article className={card} key={label}><p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p><p className="mt-2 font-serif text-2xl text-ink">{value}</p>{value === "Unavailable" && unavailable && <p className="mt-2 text-xs leading-5 text-muted">{unavailable}</p>}</article>)}</section>
      <section className={`${card} mb-5`}><div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[.18em] text-copper">Saved records</p><h2 className="mt-1 font-serif text-2xl">Report</h2></div><div className="flex gap-2 print:hidden"><button className={button} onClick={() => void exportExcel()} disabled={!source?.available}><Download size={16}/> Export Excel</button><button className={button} onClick={() => window.print()}><Printer size={16}/> Print</button></div></div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5 print:hidden"><label className="text-sm text-muted">Report<select className={field} value={kind} onChange={(e) => { setKind(e.target.value as Kind); setFilters((f) => ({ ...f, status: "" })); }}><option value="projects">Project Report</option><option value="work-orders">Work Order Report</option><option value="boqs">BOQ Report</option></select></label><label className="text-sm text-muted">From<input className={field} type="date" value={filters.from} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))}/></label><label className="text-sm text-muted">To<input className={field} type="date" value={filters.to} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))}/></label><label className="text-sm text-muted">Project<select className={field} value={filters.projectId} onChange={(e) => setFilters((f) => ({ ...f, projectId: e.target.value }))}><option value="">All projects</option>{projectList.map((p) => <option key={p.projectId} value={p.projectId}>{p.projectName}</option>)}</select></label><label className="text-sm text-muted">Status<select className={field} value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}><option value="">All statuses</option>{statuses.map((s) => <option key={s}>{s}</option>)}</select></label></div>
        <div className="mt-5 overflow-x-auto">{source && !source.available ? <p className="rounded-lg bg-field p-4 text-sm text-muted">{source.reason}</p> : <><table className="w-full min-w-[720px] text-left text-sm"><thead><tr className="border-b border-line text-xs uppercase tracking-wide text-muted">{rows[0] ? Object.keys(rows[0]).map((key) => <th key={key} className="px-3 py-3 font-medium">{key}</th>) : <th className="px-3 py-3 font-medium">Report data</th>}</tr></thead><tbody>{rows.map((row, i) => <tr className="border-b border-line last:border-0" key={i}>{Object.values(row).map((value, j) => <td className="px-3 py-3" key={j}>{value}</td>)}</tr>)}</tbody></table>{!rows.length && <p className="py-6 text-center text-sm text-muted">No saved records match these filters.</p>}</>}</div>
      </section>
      <section className={card}><h2 className="font-serif text-xl">Financial Summary</h2><p className="mt-2 text-sm text-muted">{data?.financialSummary.reason ?? "Payments & Expenses records are unavailable."}</p></section>
    </>}
  </div>;
}
