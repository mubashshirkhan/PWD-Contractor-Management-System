"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { Download, FilePlus2, Pencil, RefreshCw, Save, Trash2, X } from "lucide-react";
import { SectionHeader } from "@/components/section-header";

type Type = "Money Received" | "Expense";
type Method = "Cash" | "UPI" | "Bank Transfer" | "Cheque" | "Other";
type Project = { projectId: string; projectName: string };
type Transaction = { transactionId: string; type: Type; projectId: string | null; projectName: string | null; description: string; amount: number; date: string; paymentMethod: Method | null; remarks: string | null; createdAt: string; updatedAt: string };
type Draft = { type: Type; projectId: string; description: string; amount: string; date: string; paymentMethod: string; remarks: string };
type Totals = { totalReceived: number; totalExpenses: number; totalPaid: number; remainingBalance: number };
type Data = { folderExists: boolean; initialized: boolean; transactions: Transaction[]; totals: Totals; projects: Project[]; projectsAvailable: boolean };
const types: Type[] = ["Money Received", "Expense"];
const methods: Method[] = ["Cash", "UPI", "Bank Transfer", "Cheque", "Other"];
const button = "inline-flex items-center justify-center gap-2 rounded-md bg-copper px-4 py-2.5 text-sm font-medium text-white hover:bg-copper-dark disabled:opacity-50";
const quiet = "inline-flex items-center justify-center gap-2 rounded-md border border-line bg-white px-3 py-2 text-sm font-medium text-ink hover:bg-field disabled:opacity-50";
const field = "field mt-1 w-full";
const card = "rounded-xl border border-line bg-white p-5 shadow-sm";
function today() { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function emptyDraft(): Draft { return { type: "Money Received", projectId: "", description: "", amount: "", date: today(), paymentMethod: "", remarks: "" }; }
function draftFrom(value: Transaction): Draft { return { type: value.type, projectId: value.projectId ?? "", description: value.description, amount: String(value.amount), date: value.date, paymentMethod: value.paymentMethod ?? "", remarks: value.remarks ?? "" }; }
function inr(value: number) { return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value); }
async function responseJson<T>(response: Response): Promise<T> { const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : `Request failed (${response.status}).`); return body as T; }

export function PaymentsExpenses() {
  const queryClient = useQueryClient();
  const paymentsQuery = useQuery({ queryKey: queryKeys.payments, queryFn: async () => responseJson<Data>(await fetch("/api/payments", { cache: "no-store" })) });
  const data = paymentsQuery.data ?? null;
  const loading = paymentsQuery.isPending;
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [notice, setNotice] = useState(""); const [query, setQuery] = useState(""); const [typeFilter, setTypeFilter] = useState("All types"); const [dateFrom, setDateFrom] = useState(""); const [dateTo, setDateTo] = useState(""); const [selectedId, setSelectedId] = useState<string | null>(null); const [formOpen, setFormOpen] = useState(false); const [editing, setEditing] = useState(false); const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [exporting, setExporting] = useState(false);
  useEffect(() => {
    if (data) setSelectedId((id) => id && data.transactions.some((transaction) => transaction.transactionId === id) ? id : data.transactions[0]?.transactionId ?? null);
    if (paymentsQuery.error instanceof Error) setError(paymentsQuery.error.message);
  }, [data, paymentsQuery.error]);
  const load = () => paymentsQuery.refetch();
  async function refreshPaymentRelatedData() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.payments, refetchType: "none" }),
      queryClient.invalidateQueries({ queryKey: queryKeys.reports, refetchType: "none" }),
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard, refetchType: "none" }),
    ]);
    await paymentsQuery.refetch();
  }
  const selected = data?.transactions.find((transaction) => transaction.transactionId === selectedId) ?? null;
  const filtered = useMemo(() => { const search = query.trim().toLowerCase(); return (data?.transactions ?? []).filter((transaction) => (typeFilter === "All types" || transaction.type === typeFilter) && (!dateFrom || transaction.date >= dateFrom) && (!dateTo || transaction.date <= dateTo) && (!search || transaction.description.toLowerCase().includes(search) || (transaction.projectName ?? "General transaction").toLowerCase().includes(search))); }, [data, query, typeFilter, dateFrom, dateTo]);
  function create() { setDraft(emptyDraft()); setEditing(false); setFormOpen(true); }
  function edit(transaction: Transaction) { setDraft(draftFrom(transaction)); setEditing(true); setFormOpen(true); }
  async function save(event: React.FormEvent) { event.preventDefault(); if (!data) return; setBusy(true); setError(""); setNotice(""); try { const payload = { ...draft, projectId: draft.projectId || null, amount: Number(draft.amount), paymentMethod: draft.paymentMethod || null, remarks: draft.remarks || null }; const response = await fetch(editing && selected ? `/api/payments/${encodeURIComponent(selected.transactionId)}` : "/api/payments", { method: editing ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); const saved = await responseJson<Transaction>(response); setFormOpen(false); await refreshPaymentRelatedData(); setSelectedId(saved.transactionId); setNotice("Transaction saved and confirmed in OneDrive."); } catch (cause) { setError(cause instanceof Error ? cause.message : "Transaction could not be saved."); } finally { setBusy(false); } }
  async function initialize() { setBusy(true); setError(""); setNotice(""); try { await responseJson(await fetch("/api/payments/initialize", { method: "POST" })); await refreshPaymentRelatedData(); setNotice("PaymentsExpenses.xlsx is ready in OneDrive."); } catch (cause) { setError(cause instanceof Error ? cause.message : "Workbook could not be initialized."); } finally { setBusy(false); } }
  async function remove(transaction: Transaction) { if (!window.confirm(`Delete this ${transaction.type.toLowerCase()} transaction for ${inr(transaction.amount)}?`)) return; setBusy(true); setError(""); setNotice(""); try { await responseJson(await fetch(`/api/payments/${encodeURIComponent(transaction.transactionId)}`, { method: "DELETE" })); await refreshPaymentRelatedData(); setNotice("Transaction deleted and confirmed in OneDrive."); } catch (cause) { setError(cause instanceof Error ? cause.message : "Transaction could not be deleted."); } finally { setBusy(false); } }
  async function exportExcel() {
    if (!data?.initialized || exporting) return;
    setExporting(true); setError(""); setNotice("");
    try {
      const { Workbook } = await import("exceljs");
      const workbook = new Workbook();
      const worksheet = workbook.addWorksheet("Transactions");
      worksheet.columns = [
        { header: "Date", key: "date", width: 14 },
        { header: "Description", key: "description", width: 36 },
        { header: "Project", key: "project", width: 28 },
        { header: "Type", key: "type", width: 18 },
        { header: "Amount (INR)", key: "amount", width: 18 },
        { header: "Payment Method", key: "paymentMethod", width: 20 },
        { header: "Reference / Remarks", key: "remarks", width: 36 },
        { header: "Transaction ID", key: "transactionId", width: 34 },
        { header: "Created At", key: "createdAt", width: 24 },
        { header: "Updated At", key: "updatedAt", width: 24 },
      ];
      for (const transaction of filtered) {
        worksheet.addRow({
          date: transaction.date,
          description: transaction.description,
          project: transaction.projectName ?? "General",
          type: transaction.type,
          amount: transaction.amount,
          paymentMethod: transaction.paymentMethod ?? "",
          remarks: transaction.remarks ?? "",
          transactionId: transaction.transactionId,
          createdAt: transaction.createdAt,
          updatedAt: transaction.updatedAt,
        });
      }
      worksheet.getRow(1).font = { bold: true };
      worksheet.autoFilter = { from: "A1", to: "J1" };
      worksheet.views = [{ state: "frozen", ySplit: 1 }];
      const bytes = await workbook.xlsx.writeBuffer();
      const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `payments-expenses-${today()}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice(`Downloaded ${filtered.length} filtered transaction${filtered.length === 1 ? "" : "s"} as Excel.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Excel export failed.");
    } finally {
      setExporting(false);
    }
  }
  const update = (key: keyof Draft, value: string) => setDraft((current) => ({ ...current, [key]: value }));
  const totals = data?.initialized ? data.totals : null;
  const summary = [["Total Received", totals ? inr(totals.totalReceived) : "—"], ["Total Expenses", totals ? inr(totals.totalExpenses) : "—"], ["Total Paid", totals ? inr(totals.totalPaid) : "—"], ["Remaining Balance", totals ? inr(totals.remainingBalance) : "—"]];
  return <div>
    <SectionHeader eyebrow="Project operations" title="Payments & Expenses" description="Record money received and expenses in one simple register." action={<div className="flex flex-wrap gap-2"><button className={quiet} onClick={() => void load()} disabled={loading || busy}><RefreshCw size={16}/> Refresh</button><button className={quiet} onClick={() => void exportExcel()} disabled={!data?.initialized || exporting || loading}><Download size={16}/>{exporting ? "Preparing Excel…" : "Export Excel"}</button><button className={button} onClick={create} disabled={!data?.initialized}><FilePlus2 size={16}/> Add Transaction</button></div>} />
    <p className="-mt-3 mb-5 text-xs text-muted">Overall recorded totals only; these are not audited accounts. Saved expenses count as paid outflows.</p>
    {error && <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}{notice && <p role="status" className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
    {!loading && data && !data.initialized && <section className={`${card} mb-5`}><p className="text-xs font-semibold uppercase tracking-[.18em] text-copper">OneDrive register not initialized</p><h2 className="mt-2 font-serif text-2xl">{data.folderExists ? "Set up transaction storage" : "Payments and Expenses folder not found"}</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-muted">{data.folderExists ? "Initialize PaymentsExpenses.xlsx in the existing Arch Design Studio/Financial Management/Payments and Expenses folder. No folders or transaction records will be created." : "Create the Payments and Expenses folder inside your existing Arch Design Studio/Financial Management folder, then refresh. The app will not create a duplicate folder."}</p><button className={`${data.folderExists ? button : quiet} mt-4`} onClick={() => data.folderExists ? void initialize() : void load()} disabled={busy || loading}>{data.folderExists ? "Initialize workbook" : "Refresh after creating folder"}</button></section>}
    <section className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{summary.map(([label, value]) => <article className={card} key={label}><p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p><p className="mt-2 break-words font-serif text-2xl text-ink">{value}</p></article>)}</section>
    <section className={card}>
      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><label className="text-sm text-muted sm:col-span-2">Search transactions<input className={field} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Description or project"/></label><label className="text-sm text-muted">Type<select className={field} value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}><option>All types</option>{types.map((type) => <option key={type}>{type}</option>)}</select></label><div className="grid grid-cols-2 gap-2"><label className="text-sm text-muted">From<input className={field} type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)}/></label><label className="text-sm text-muted">To<input className={field} type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)}/></label></div></div>
      {loading ? <p className="py-8 text-sm text-muted">Loading saved transactions…</p> : <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left text-sm"><thead><tr className="border-b border-line text-xs uppercase tracking-wide text-muted">{["Date", "Description", "Project", "Type", "Amount", "Actions"].map((label) => <th className="px-3 py-3 font-medium" key={label}>{label}</th>)}</tr></thead><tbody>{filtered.map((transaction) => <tr key={transaction.transactionId} className={`border-b border-line last:border-0 ${selectedId === transaction.transactionId ? "bg-field/70" : ""}`}><td className="whitespace-nowrap px-3 py-3">{transaction.date}</td><td className="px-3 py-3"><button className="text-left font-medium text-copper hover:underline" onClick={() => { setSelectedId(transaction.transactionId); setFormOpen(false); }}>{transaction.description}</button></td><td className="px-3 py-3">{transaction.projectName ?? "General"}</td><td className="px-3 py-3">{transaction.type}</td><td className={`whitespace-nowrap px-3 py-3 font-medium ${transaction.type === "Expense" ? "text-ink" : "text-emerald-800"}`}>{transaction.type === "Expense" ? "−" : "+"}{inr(transaction.amount)}</td><td className="whitespace-nowrap px-3 py-3"><button className="text-copper hover:underline" onClick={() => setSelectedId(transaction.transactionId)}>View</button></td></tr>)}</tbody></table>{!filtered.length && <p className="py-8 text-center text-sm text-muted">{data?.initialized ? "No transactions match these filters." : "Initialize the workbook to begin."}</p>}</div>}
    </section>
    {selected && !formOpen && <section className={`${card} mt-5`}><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[.18em] text-copper">Transaction details</p><h2 className="mt-1 font-serif text-2xl">{selected.description}</h2></div><div className="flex gap-2"><button className={quiet} onClick={() => edit(selected)} disabled={busy}><Pencil size={15}/> Edit</button><button className={quiet} onClick={() => void remove(selected)} disabled={busy}><Trash2 size={15}/> Delete</button></div></div><dl className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[["Type", selected.type], ["Project", selected.projectName ?? "General transaction"], ["Amount", inr(selected.amount)], ["Date", selected.date], ["Payment method", selected.paymentMethod ?? "—"], ["Reference / remarks", selected.remarks ?? "—"]].map(([label, value]) => <div key={label}><dt className="text-xs uppercase tracking-wide text-muted">{label}</dt><dd className="mt-1 text-sm font-medium text-ink">{value}</dd></div>)}</dl></section>}
    {formOpen && <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/40 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setFormOpen(false); }}><section className="my-auto max-h-[95vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-line bg-white p-5 shadow-xl sm:p-7" role="dialog" aria-modal="true" aria-labelledby="transaction-heading"><div className="mb-5 flex items-start justify-between"><div><p className="text-xs font-semibold uppercase tracking-[.18em] text-copper">Transaction</p><h2 id="transaction-heading" className="mt-1 font-serif text-2xl">{editing ? "Edit transaction" : "Add transaction"}</h2></div><button className={quiet} aria-label="Close form" onClick={() => setFormOpen(false)} disabled={busy}><X size={16}/></button></div>
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={(event) => void save(event)}>
        <label className="text-sm text-muted">Transaction type<select className={field} value={draft.type} onChange={(event) => update("type", event.target.value)}>{types.map((type) => <option key={type}>{type}</option>)}</select></label>
        <label className="text-sm text-muted">Project (optional)<select className={field} value={draft.projectId} onChange={(event) => update("projectId", event.target.value)}><option value="">General transaction</option>{data?.projects.map((project) => <option key={project.projectId} value={project.projectId}>{project.projectName}</option>)}</select>{!data?.projectsAvailable && <span className="mt-1 block text-xs">Project Tracking records are unavailable; you can still save a general transaction.</span>}</label>
        <label className="text-sm text-muted sm:col-span-2">Description<input className={field} maxLength={300} value={draft.description} onChange={(event) => update("description", event.target.value)} required placeholder="What was received or spent?"/></label>
        <label className="text-sm text-muted">Amount (INR)<input className={field} type="number" min="0.01" step="0.01" value={draft.amount} onChange={(event) => update("amount", event.target.value)} required/></label>
        <label className="text-sm text-muted">Date<input className={field} type="date" value={draft.date} onChange={(event) => update("date", event.target.value)} required/></label>
        <label className="text-sm text-muted">Payment method (optional)<select className={field} value={draft.paymentMethod} onChange={(event) => update("paymentMethod", event.target.value)}><option value="">Not specified</option>{methods.map((method) => <option key={method}>{method}</option>)}</select></label>
        <label className="text-sm text-muted">Reference / remarks (optional)<input className={field} maxLength={1000} value={draft.remarks} onChange={(event) => update("remarks", event.target.value)}/></label>
        <div className="mt-2 flex justify-end gap-2 border-t border-line pt-4 sm:col-span-2"><button type="button" className={quiet} onClick={() => setFormOpen(false)} disabled={busy}>Cancel</button><button className={button} disabled={busy}><Save size={16}/>{busy ? "Saving…" : "Save transaction"}</button></div>
      </form></section></div>}
  </div>;
}
