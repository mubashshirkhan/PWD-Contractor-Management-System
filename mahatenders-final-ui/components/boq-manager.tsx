"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Copy, Download, FilePlus2, Pencil, Printer, RefreshCw, Save, Trash2 } from "lucide-react";

type BoqStatus = "Draft" | "Finalized";
type ProjectOption = { projectId: string; projectName: string };
type BoqItem = { boqItemId?: string; itemNumber?: number; description: string; unit: string; quantity: number; rate: number; amount?: number };
type BoqRecord = {
  boqId: string; boqNumber: string; title: string; boqDate: string; projectId: string; projectName: string;
  workOrderId: string | null; description: string | null; status: BoqStatus; taxPercent: number;
  additionalCharges: number; discountPercent: number; subtotal: number; taxAmount: number; discountAmount: number;
  grandTotal: number; createdAt: string; updatedAt: string; items: BoqItem[];
};
type DraftItem = { key: string; description: string; unit: string; quantity: string; rate: string };
type Draft = { title: string; boqDate: string; projectId: string; workOrderId: string; description: string; status: BoqStatus; taxPercent: string; additionalCharges: string; discountPercent: string; items: DraftItem[] };
type ListResponse = { initialized: boolean; boqs: BoqRecord[]; projects: ProjectOption[] };

const units = ["Nos", "Sqm", "Cum", "Rmt", "Kg", "Tonne", "Litre", "Hours", "Days", "Set", "Job"];
const inputClass = "field mt-1 w-full";
const buttonClass = "inline-flex items-center justify-center gap-2 rounded-md bg-copper px-4 py-2.5 text-sm font-medium text-white transition hover:bg-copper-dark disabled:cursor-not-allowed disabled:opacity-50";
const secondaryClass = "inline-flex items-center justify-center gap-2 rounded-md border border-line bg-white px-3 py-2 text-sm font-medium text-ink transition hover:bg-field disabled:cursor-not-allowed disabled:opacity-50";

function todayLocal() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
function freshKey() { return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`; }
function emptyDraft(projectId = ""): Draft {
  return { title: "", boqDate: todayLocal(), projectId, workOrderId: "", description: "", status: "Draft", taxPercent: "0", additionalCharges: "0", discountPercent: "0", items: [{ key: freshKey(), description: "", unit: "Nos", quantity: "", rate: "" }] };
}
function draftFrom(record: BoqRecord): Draft {
  return { title: record.title, boqDate: record.boqDate, projectId: record.projectId, workOrderId: record.workOrderId ?? "", description: record.description ?? "", status: record.status, taxPercent: String(record.taxPercent), additionalCharges: String(record.additionalCharges), discountPercent: String(record.discountPercent), items: record.items.map((item) => ({ key: item.boqItemId || freshKey(), description: item.description, unit: item.unit, quantity: String(item.quantity), rate: String(item.rate) })) };
}
function currency(value: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}
function roundMoney(value: number) { return Math.round((value + Number.EPSILON) * 100) / 100; }

async function responseJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : `Request failed (${response.status}).`);
  return body as T;
}

export function BoqManager() {
  const [boqs, setBoqs] = useState<BoqRecord[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [initialized, setInitialized] = useState(false);
  const [connected, setConnected] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All statuses");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await responseJson<ListResponse>(await fetch("/api/boq", { cache: "no-store" }));
      setConnected(true);
      setBoqs(result.boqs);
      setProjects(result.projects);
      setInitialized(result.initialized);
      setSelectedId((current) => current && result.boqs.some((boq) => boq.boqId === current) ? current : result.boqs[0]?.boqId ?? null);
      if (!result.initialized) setDraft((current) => ({ ...current, projectId: current.projectId || result.projects[0]?.projectId || "" }));
    } catch (cause) {
      if (cause instanceof Error && cause.message.toLowerCase().includes("connect onedrive")) setConnected(false);
      setError(cause instanceof Error ? cause.message : "Could not load BOQs from OneDrive.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const search = query.trim().toLowerCase();
    return boqs.filter((boq) => (statusFilter === "All statuses" || boq.status === statusFilter) && (!search || [boq.boqNumber, boq.title, boq.projectName, boq.projectId, boq.workOrderId ?? ""].some((value) => value.toLowerCase().includes(search))));
  }, [boqs, query, statusFilter]);

  const selected = boqs.find((boq) => boq.boqId === selectedId) ?? null;
  const calculations = useMemo(() => {
    const lineAmounts = draft.items.map((item) => roundMoney((Number(item.quantity) || 0) * (Number(item.rate) || 0)));
    const subtotal = roundMoney(lineAmounts.reduce((sum, amount) => sum + amount, 0));
    const taxAmount = roundMoney(subtotal * (Number(draft.taxPercent) || 0) / 100);
    const discountAmount = roundMoney(subtotal * (Number(draft.discountPercent) || 0) / 100);
    const additionalCharges = Number(draft.additionalCharges) || 0;
    return { lineAmounts, subtotal, taxAmount, discountAmount, additionalCharges, grandTotal: roundMoney(subtotal + taxAmount + additionalCharges - discountAmount) };
  }, [draft]);

  function openRecord(record: BoqRecord) {
    setSelectedId(record.boqId);
    setDraft(draftFrom(record));
    setCreating(false);
    setEditing(false);
    setError(""); setNotice("");
  }
  function beginNew() {
    setSelectedId(null);
    setDraft(emptyDraft(projects[0]?.projectId ?? ""));
    setCreating(true); setEditing(true); setError(""); setNotice("");
  }
  function beginEdit() {
    if (!selected) return;
    setDraft(draftFrom(selected)); setCreating(false); setEditing(true); setError(""); setNotice("");
  }
  function updateDraft<K extends keyof Omit<Draft, "items">>(field: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [field]: value }));
  }
  function updateItem(key: string, field: keyof Omit<DraftItem, "key">, value: string) {
    setDraft((current) => ({ ...current, items: current.items.map((item) => item.key === key ? { ...item, [field]: value } : item) }));
  }
  function addItem() {
    setDraft((current) => ({ ...current, items: [...current.items, { key: freshKey(), description: "", unit: "Nos", quantity: "", rate: "" }] }));
  }
  function removeItem(key: string) {
    setDraft((current) => ({ ...current, items: current.items.length > 1 ? current.items.filter((item) => item.key !== key) : current.items }));
  }

  async function initialize() {
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await responseJson<{ created: boolean }>(await fetch("/api/boq/initialize", { method: "POST" }));
      setNotice(result.created ? "BOQ.xlsx was created in the existing OneDrive BOQ folder and verified by readback." : "BOQ.xlsx was found and verified in OneDrive.");
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not initialize BOQ.xlsx."); }
    finally { setBusy(false); }
  }

  async function save(status: BoqStatus) {
    if (!draft.projectId) { setError("Choose an existing project before saving."); return; }
    setBusy(true); setError(""); setNotice("");
    const payload = {
      title: draft.title, boqDate: draft.boqDate, projectId: draft.projectId,
      workOrderId: draft.workOrderId || null, description: draft.description || null, status,
      taxPercent: Number(draft.taxPercent), additionalCharges: Number(draft.additionalCharges), discountPercent: Number(draft.discountPercent),
      items: draft.items.map(({ description, unit, quantity, rate }) => ({ description, unit, quantity: quantity === "" ? Number.NaN : Number(quantity), rate: rate === "" ? Number.NaN : Number(rate) })),
    };
    try {
      const endpoint = creating ? "/api/boq" : `/api/boq/${encodeURIComponent(selectedId!)}`;
      const record = await responseJson<BoqRecord>(await fetch(endpoint, { method: creating ? "POST" : "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }));
      setBoqs((current) => creating ? [record, ...current] : current.map((boq) => boq.boqId === record.boqId ? record : boq));
      setSelectedId(record.boqId); setDraft(draftFrom(record)); setCreating(false); setEditing(false);
      setNotice(`Saved ${record.boqNumber} to OneDrive and confirmed it by readback.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "BOQ save failed; OneDrive did not confirm the save."); }
    finally { setBusy(false); }
  }

  async function remove() {
    if (!selected || !window.confirm(`Delete ${selected.boqNumber} and its BOQ items from OneDrive?`)) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await responseJson<{ deleted: boolean }>(await fetch(`/api/boq/${encodeURIComponent(selected.boqId)}`, { method: "DELETE" }));
      setBoqs((current) => current.filter((boq) => boq.boqId !== selected.boqId));
      setSelectedId(null); setCreating(false); setEditing(false); setNotice(`${selected.boqNumber} was deleted and verified in OneDrive.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "BOQ deletion could not be confirmed."); }
    finally { setBusy(false); }
  }

  async function act(path: "duplicate" | "reopen") {
    if (!selected) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const record = await responseJson<BoqRecord>(await fetch(`/api/boq/${encodeURIComponent(selected.boqId)}/${path}`, { method: "POST" }));
      setBoqs((current) => path === "duplicate" ? [record, ...current] : current.map((boq) => boq.boqId === record.boqId ? record : boq));
      openRecord(record);
      if (path === "reopen") { setDraft(draftFrom(record)); setEditing(true); setNotice(`${record.boqNumber} was reopened and verified in OneDrive.`); }
      else { setDraft(draftFrom(record)); setCreating(false); setEditing(true); setNotice(`Created ${record.boqNumber} as a copy and verified it in OneDrive.`); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : `Could not ${path} the BOQ.`); }
    finally { setBusy(false); }
  }

  async function exportExcel() {
    if (!selected) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/boq/${encodeURIComponent(selected.boqId)}/export`, { cache: "no-store" });
      if (!response.ok) throw new Error(await response.text().catch(() => "Excel export failed."));
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a"); link.href = url; link.download = `${selected.boqNumber}.xlsx`; link.click(); URL.revokeObjectURL(url);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Excel export failed."); }
    finally { setBusy(false); }
  }

  const previewTitle = draft.title || selected?.title || "Untitled BOQ";
  const previewProject = projects.find((project) => project.projectId === draft.projectId)?.projectName ?? selected?.projectName ?? "";
  const previewRows = draft.items.map((item, index) => ({ itemNumber: index + 1, ...item, amount: calculations.lineAmounts[index] }));

  return (
    <div className="space-y-5">
      {error && <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}
      {notice && <div role="status" className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{notice}</div>}
      {!connected ? <section className="rounded-xl border border-line bg-white p-6"><h2 className="font-serif text-2xl text-ink">Connect OneDrive to manage BOQs</h2><p className="mt-2 text-sm text-muted">BOQs are stored in your Arch Design Studio OneDrive account.</p><a className={`${buttonClass} mt-4`} href="/api/onedrive/auth/start">Connect OneDrive</a></section> : loading ? <p className="rounded-xl border border-line bg-white p-6 text-sm text-muted" role="status">Loading BOQs from OneDrive…</p> : error ? <section className="rounded-xl border border-line bg-white p-6"><h2 className="font-serif text-xl">Could not load BOQ storage</h2><button className={`${secondaryClass} mt-4`} type="button" onClick={() => void load()}><RefreshCw className="h-4 w-4" /> Retry</button></section> : !initialized ? <section className="rounded-xl border border-line bg-white p-6"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-copper">OneDrive workbook not initialized</p><h2 className="mt-2 font-serif text-2xl text-ink">Set up BOQ storage</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-muted">This creates an empty <strong>BOQ.xlsx</strong> with structured BOQ and item tables in the existing OneDrive BOQ folder. No records or folders are created.</p><button className={`${buttonClass} mt-4`} type="button" disabled={busy} onClick={initialize}>{busy ? "Checking OneDrive…" : "Initialize BOQ workbook"}</button></section> : (
        <>
          <div className="grid gap-5 xl:grid-cols-[minmax(280px,0.75fr)_minmax(0,1.65fr)]">
            <section className="overflow-hidden rounded-xl border border-line bg-white shadow-sm">
              <div className="border-b border-line p-4">
                <div className="flex items-center justify-between gap-2"><h2 className="font-serif text-xl text-ink">Saved BOQs</h2><button className={buttonClass} type="button" onClick={beginNew}><FilePlus2 className="h-4 w-4" /> New BOQ</button></div>
                <label className="sr-only" htmlFor="boq-search">Search BOQs</label><input id="boq-search" className={`${inputClass} mt-4`} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search number, title, project…" />
                <label className="sr-only" htmlFor="boq-status">Filter BOQs by status</label><select id="boq-status" className={inputClass} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option>All statuses</option><option>Draft</option><option>Finalized</option></select>
              </div>
              <ul className="max-h-[680px] divide-y divide-line overflow-y-auto">
                {filtered.map((boq) => <li key={boq.boqId}><button type="button" onClick={() => openRecord(boq)} className={`w-full px-4 py-4 text-left hover:bg-[#faf8f4] ${selectedId === boq.boqId && !creating ? "bg-[#f8f5ef]" : ""}`} aria-current={selectedId === boq.boqId && !creating ? "true" : undefined}><span className="flex items-start justify-between gap-2"><strong className="text-sm text-ink">{boq.boqNumber}</strong><span className="rounded-full bg-[#f2eee7] px-2 py-0.5 text-xs text-muted">{boq.status}</span></span><span className="mt-1 block truncate text-sm">{boq.title}</span><span className="mt-1 block truncate text-xs text-muted">{boq.projectName} · {currency(boq.grandTotal)}</span></button></li>)}
                {!filtered.length && <li className="p-5 text-sm text-muted">{boqs.length ? "No BOQs match these filters." : "No saved BOQs yet."}</li>}
              </ul>
            </section>

            <div className="space-y-5">
              {editing ? <section className="rounded-xl border border-line bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-copper">{creating ? "New BOQ" : "Edit BOQ"}</p><h2 className="mt-1 font-serif text-2xl text-ink">{creating ? "Prepare an estimate" : selected?.boqNumber}</h2></div><button className={secondaryClass} type="button" onClick={() => { if (selected) openRecord(selected); else { setEditing(false); setCreating(false); } }}>Cancel</button></div>
                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  <label className="text-sm text-muted">Title<input className={inputClass} maxLength={200} value={draft.title} onChange={(event) => updateDraft("title", event.target.value)} /></label>
                  <label className="text-sm text-muted">BOQ date<input className={inputClass} type="date" value={draft.boqDate} onChange={(event) => updateDraft("boqDate", event.target.value)} /></label>
                  <label className="text-sm text-muted sm:col-span-2">Project<select className={inputClass} value={draft.projectId} onChange={(event) => updateDraft("projectId", event.target.value)}><option value="">Select a Project Tracking project</option>{projects.map((project) => <option key={project.projectId} value={project.projectId}>{project.projectName} · {project.projectId}</option>)}</select></label>
                </div>

                <details className="mt-4 rounded-lg border border-line px-4 py-3">
                  <summary className="cursor-pointer text-sm font-medium text-ink">Optional details and price adjustments</summary>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <label className="text-sm text-muted">Work Order reference<input className={inputClass} maxLength={100} value={draft.workOrderId} onChange={(event) => updateDraft("workOrderId", event.target.value)} placeholder="Work Order ID (optional)" /><span className="mt-1 block text-xs">Work Order references can’t be checked against a register yet.</span></label>
                    <label className="text-sm text-muted">Description<textarea className={inputClass} rows={2} maxLength={4000} value={draft.description} onChange={(event) => updateDraft("description", event.target.value)} /></label>
                    <label className="text-sm text-muted">Tax (%)<input className={inputClass} type="number" min="0" max="100" step="0.01" value={draft.taxPercent} onChange={(event) => updateDraft("taxPercent", event.target.value)} /></label>
                    <label className="text-sm text-muted">Additional charges (INR)<input className={inputClass} type="number" min="0" step="0.01" value={draft.additionalCharges} onChange={(event) => updateDraft("additionalCharges", event.target.value)} /></label>
                    <label className="text-sm text-muted">Discount (%)<input className={inputClass} type="number" min="0" max="100" step="0.01" value={draft.discountPercent} onChange={(event) => updateDraft("discountPercent", event.target.value)} /></label>
                  </div>
                </details>

                <div className="mt-6 flex items-center justify-between gap-3"><h3 className="font-serif text-xl text-ink">Items</h3><button className={secondaryClass} type="button" onClick={addItem}><FilePlus2 className="h-4 w-4" /> Add item</button></div>
                <div className="mt-3 overflow-x-auto"><table className="data-table w-full min-w-[790px]"><thead><tr><th>No.</th><th>Description</th><th>Unit</th><th>Quantity</th><th>Rate (INR)</th><th>Amount (INR)</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{draft.items.map((item, index) => <tr key={item.key}><td>{index + 1}</td><td><input className="field min-w-48" aria-label={`Item ${index + 1} description`} value={item.description} onChange={(event) => updateItem(item.key, "description", event.target.value)} /></td><td><input className="field w-24" aria-label={`Item ${index + 1} unit`} list="boq-units" value={item.unit} onChange={(event) => updateItem(item.key, "unit", event.target.value)} /><datalist id="boq-units">{units.map((unit) => <option key={unit} value={unit} />)}</datalist></td><td><input className="field w-28" aria-label={`Item ${index + 1} quantity`} type="number" min="0" step="0.001" value={item.quantity} onChange={(event) => updateItem(item.key, "quantity", event.target.value)} /></td><td><input className="field w-32" aria-label={`Item ${index + 1} rate`} type="number" min="0" step="0.01" value={item.rate} onChange={(event) => updateItem(item.key, "rate", event.target.value)} /></td><td className="whitespace-nowrap">{currency(calculations.lineAmounts[index])}</td><td><button className="rounded p-2 text-muted hover:bg-field hover:text-danger disabled:opacity-40" type="button" aria-label={`Remove item ${index + 1}`} disabled={draft.items.length <= 1} onClick={() => removeItem(item.key)}><Trash2 className="h-4 w-4" /></button></td></tr>)}</tbody></table></div>

                <Totals subtotal={calculations.subtotal} tax={calculations.taxAmount} charges={calculations.additionalCharges} discount={calculations.discountAmount} total={calculations.grandTotal} />
                <div className="mt-5 flex flex-wrap justify-end gap-2"><button className={secondaryClass} type="button" disabled={busy} onClick={() => void save("Draft")}><Save className="h-4 w-4" /> Save draft</button><button className={buttonClass} type="button" disabled={busy} onClick={() => void save("Finalized")}>{busy ? "Saving…" : "Save and finalize"}</button></div>
              </section> : selected ? <section className="rounded-xl border border-line bg-white p-5 shadow-sm"><div className="no-print flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-copper">{selected.boqNumber} · {selected.status}</p><h2 className="mt-1 font-serif text-2xl text-ink">{selected.title}</h2><p className="mt-1 text-sm text-muted">{selected.projectName} · {selected.boqDate}</p></div><div className="flex flex-wrap gap-2"><button className={secondaryClass} type="button" disabled={busy} onClick={() => void exportExcel()}><Download className="h-4 w-4" /> Excel</button><button className={secondaryClass} type="button" onClick={() => window.print()}><Printer className="h-4 w-4" /> Print</button><button className={secondaryClass} type="button" disabled={busy} onClick={() => void act("duplicate")}><Copy className="h-4 w-4" /> Duplicate</button>{selected.status === "Finalized" ? <button className={secondaryClass} type="button" disabled={busy} onClick={() => void act("reopen")}><RefreshCw className="h-4 w-4" /> Reopen</button> : <button className={secondaryClass} type="button" disabled={busy} onClick={beginEdit}><Pencil className="h-4 w-4" /> Edit</button>}<button className={`${secondaryClass} text-danger`} type="button" disabled={busy} onClick={() => void remove()}><Trash2 className="h-4 w-4" /> Delete</button></div></div><BoqPrintView boq={selected} /></section> : <section className="rounded-xl border border-dashed border-line bg-white p-10 text-center"><h2 className="font-serif text-2xl text-ink">Select a saved BOQ or start a new one</h2><p className="mt-2 text-sm text-muted">Saved BOQs are loaded from the OneDrive workbook.</p><button className={`${buttonClass} mt-5`} type="button" onClick={beginNew}><FilePlus2 className="h-4 w-4" /> New BOQ</button></section>}
              <p className="no-print px-1 text-xs text-muted">Records are saved to OneDrive. Save confirmations are shown only after Graph readback succeeds.</p>
            </div>
          </div>
          <style jsx global>{`@media print { body * { visibility: hidden !important; } #boq-print-area, #boq-print-area * { visibility: visible !important; } #boq-print-area { position: absolute; inset: 0; width: 100%; padding: 0; box-shadow: none; border: 0; } .no-print { display: none !important; } @page { margin: 12mm; } }`}</style>
        </>
      )}
    </div>
  );
}

function Totals({ subtotal, tax, charges, discount, total }: { subtotal: number; tax: number; charges: number; discount: number; total: number }) {
  return <dl className="ml-auto mt-5 max-w-sm space-y-2 border-t border-line pt-4 text-sm"><TotalLine label="Subtotal" value={subtotal} />{tax > 0 && <TotalLine label="Taxes" value={tax} />}{charges > 0 && <TotalLine label="Additional charges" value={charges} />}{discount > 0 && <TotalLine label="Discount" value={-discount} />}<div className="flex justify-between border-t border-line pt-3 text-base font-semibold text-ink"><dt>Grand total</dt><dd>{currency(total)}</dd></div></dl>;
}
function TotalLine({ label, value }: { label: string; value: number }) { return <div className="flex justify-between text-muted"><dt>{label}</dt><dd>{currency(value)}</dd></div>; }
function BoqPrintView({ boq }: { boq: BoqRecord }) {
  return <div id="boq-print-area" className="mt-5 rounded-lg border border-line p-4"><div className="mb-5 border-b border-line pb-4"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-copper">Arch Design Studio · Bill of Quantities</p><h2 className="mt-2 font-serif text-2xl text-ink">{boq.title}</h2><div className="mt-3 grid gap-2 text-sm sm:grid-cols-2"><p><strong>BOQ Number:</strong> {boq.boqNumber}</p><p><strong>Date:</strong> {boq.boqDate}</p><p><strong>Project:</strong> {boq.projectName} ({boq.projectId})</p><p><strong>Work Order:</strong> {boq.workOrderId || "—"}</p><p><strong>Status:</strong> {boq.status}</p>{boq.description && <p className="sm:col-span-2"><strong>Description:</strong> {boq.description}</p>}</div></div><div className="overflow-x-auto"><table className="data-table w-full min-w-[620px]"><thead><tr><th>No.</th><th>Description</th><th>Unit</th><th>Quantity</th><th>Rate</th><th>Amount</th></tr></thead><tbody>{boq.items.map((item) => <tr key={item.boqItemId}><td>{item.itemNumber}</td><td>{item.description}</td><td>{item.unit}</td><td>{item.quantity}</td><td>{currency(item.rate)}</td><td>{currency(item.amount ?? item.quantity * item.rate)}</td></tr>)}</tbody></table></div><Totals subtotal={boq.subtotal} tax={boq.taxAmount} charges={boq.additionalCharges} discount={boq.discountAmount} total={boq.grandTotal} /></div>;
}
