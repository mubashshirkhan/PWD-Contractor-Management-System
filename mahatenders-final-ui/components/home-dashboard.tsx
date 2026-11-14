"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, Calculator, CalendarDays, ChartNoAxesColumn, FileText, FolderKanban, ReceiptIndianRupee, TrendingUp, UserRound } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type Project = { projectId: string; projectName: string; status: string; isArchived?: boolean; updatedAt?: string; createdAt?: string };
type WorkOrder = { workOrderId: string; projectId: string; projectName: string; workOrderNumber: string; expectedCompletionDate: string; status: string; contractAmount: number };
type Boq = { boqId: string; projectId: string; projectName: string; grandTotal: number };
type Transaction = { transactionId: string; projectId: string | null; projectName: string | null; type: "Money Received" | "Expense"; amount: number; date: string };
type Source<T> = { initialized: boolean; records: T[]; error?: string };
type DashboardData = { projects: Source<Project>; workOrders: Source<WorkOrder>; boqs: Source<Boq>; transactions: Source<Transaction> };
type ApiEnvelope<T> = { initialized?: boolean; projects?: T[]; workOrders?: T[]; boqs?: T[]; transactions?: T[]; error?: string };

const panel = "rounded-xl border border-[#e5eaf1] bg-white p-4 shadow-[0_2px_8px_rgba(24,50,87,0.04)] sm:p-5";
const palette = { blue: "#eaf3ff", orange: "#fff2e8", purple: "#f1efff", green: "#eaf8f1", red: "#fff0f0" };
const chartColors = ["#4caa7a", "#4e9de8", "#f2b233", "#dfe5ef"];
const currency = (value: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value);
const compactCurrency = (value: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", notation: "compact", maximumFractionDigits: 1 }).format(value);
const indiaDate = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "2-digit", month: "short", year: "numeric" }).format(new Date());
const emptyMessage = (source: Source<unknown> | undefined, message: string) => source?.error ?? (source?.initialized ? message : "Workbook not initialized.");

async function source<T>(url: string, key: "projects" | "workOrders" | "boqs" | "transactions"): Promise<Source<T>> {
  try {
    const response = await fetch(url, { cache: "no-store" });
    const data = await response.json() as ApiEnvelope<T>;
    if (!response.ok) return { initialized: false, records: [], error: data.error ?? `Could not load ${key}.` };
    const initialized = data.initialized ?? true;
    return { initialized, records: (data[key] ?? []) as T[] };
  } catch { return { initialized: false, records: [], error: `Could not load ${key}.` }; }
}

export function HomeDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    void Promise.all([
      source<Project>("/api/projects", "projects"),
      source<WorkOrder>("/api/work-orders", "workOrders"),
      source<Boq>("/api/boq", "boqs"),
      source<Transaction>("/api/payments", "transactions"),
    ]).then(([projects, workOrders, boqs, transactions]) => {
      if (active) setData({ projects: { ...projects, records: projects.records.filter((project) => !project.isArchived) }, workOrders, boqs, transactions });
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const projectProgress = useMemo(() => {
    const all = data?.projects.records ?? [];
    const count = (status: string) => all.filter((project) => project.status === status).length;
    return [
      { name: "Completed", value: count("Completed") },
      { name: "In Progress", value: count("In Progress") },
      { name: "On Hold", value: count("On Hold") },
      { name: "Not Started", value: count("Planned") },
    ];
  }, [data]);
  const monthlyFinance = useMemo(() => {
    const now = new Date();
    const months = Array.from({ length: 6 }, (_, index) => new Date(now.getFullYear(), now.getMonth() - 5 + index, 1));
    return months.map((month) => {
      const key = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}`;
      const records = (data?.transactions.records ?? []).filter((transaction) => transaction.date.startsWith(key));
      return { month: new Intl.DateTimeFormat("en-IN", { month: "short" }).format(month), received: records.filter((transaction) => transaction.type === "Money Received").reduce((sum, record) => sum + record.amount, 0), expenses: records.filter((transaction) => transaction.type === "Expense").reduce((sum, record) => sum + record.amount, 0) };
    });
  }, [data]);
  const received = data?.transactions.records.filter((record) => record.type === "Money Received").reduce((sum, record) => sum + record.amount, 0) ?? 0;
  const expenses = data?.transactions.records.filter((record) => record.type === "Expense").reduce((sum, record) => sum + record.amount, 0) ?? 0;
  const projectLatest = useMemo(() => [...(data?.projects.records ?? [])].sort((a, b) => (b.updatedAt ?? b.createdAt ?? "").localeCompare(a.updatedAt ?? a.createdAt ?? "")).slice(0, 3), [data]);
  const upcoming = useMemo(() => {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
    const dateParts = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
    const today = `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
    return [...(data?.workOrders.records ?? [])].filter((order) => order.expectedCompletionDate >= today && !["Completed", "Cancelled"].includes(order.status)).sort((a, b) => a.expectedCompletionDate.localeCompare(b.expectedCompletionDate)).slice(0, 3);
  }, [data]);
  const countForProject = (projectId: string, records: Array<{ projectId: string | null }>) => records.filter((record) => record.projectId === projectId).length;
  const cards = [
    { label: "Total Projects", value: data?.projects.initialized ? String(data.projects.records.length) : "—", detail: emptyMessage(data?.projects, "No saved projects yet."), icon: FolderKanban, background: palette.blue, color: "text-blue-700" },
    { label: "Total Work Orders", value: data?.workOrders.initialized ? String(data.workOrders.records.length) : "—", detail: emptyMessage(data?.workOrders, "No saved work orders yet."), icon: FileText, background: palette.orange, color: "text-amber-800" },
    { label: "Total BOQs", value: data?.boqs.initialized ? String(data.boqs.records.length) : "—", detail: data?.boqs.initialized && data.boqs.records.length ? currency(data.boqs.records.reduce((sum, boq) => sum + boq.grandTotal, 0)) : emptyMessage(data?.boqs, "No saved BOQs yet."), icon: Calculator, background: palette.purple, color: "text-violet-700" },
    { label: "Total Received", value: data?.transactions.initialized ? currency(received) : "—", detail: emptyMessage(data?.transactions, "No saved transactions yet."), icon: ReceiptIndianRupee, background: palette.green, color: "text-emerald-700" },
    { label: "Total Expenses", value: data?.transactions.initialized ? currency(expenses) : "—", detail: emptyMessage(data?.transactions, "No saved transactions yet."), icon: TrendingUp, background: palette.red, color: "text-rose-700" },
  ];
  const quickActions = [
    { label: "+ New Project", href: "/projects", icon: FolderKanban, background: palette.blue, color: "text-blue-700" },
    { label: "+ New BOQ", href: "/boq-calculator", icon: Calculator, background: palette.purple, color: "text-violet-700" },
    { label: "+ New Work Order", href: "/work-orders", icon: FileText, background: palette.green, color: "text-emerald-700" },
    { label: "+ Add Transaction", href: "/payments", icon: ReceiptIndianRupee, background: palette.orange, color: "text-amber-800" },
    { label: "View Reports", href: "/reports", icon: ChartNoAxesColumn, background: palette.blue, color: "text-blue-700" },
  ];
  const financialReady = data?.transactions.initialized;

  return <div className="-mx-5 -mt-8 min-h-[calc(100vh-4rem)] bg-[#f5f8fc] px-5 pb-8 pt-6 lg:-mx-10 lg:-mt-10 lg:px-10 lg:pb-10 lg:pt-7">
    <div className="mx-auto max-w-[1500px] space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-4 px-1">
        <div><h1 className="font-serif text-3xl font-semibold tracking-tight text-[#112543]">Welcome, Arch Design Studio</h1><p className="mt-1 text-sm text-[#52647e]">Manage projects, tenders, work orders, BOQs and finances in one place.</p></div>
        <div className="flex items-center gap-4 text-sm text-[#1b3153]"><span className="flex items-center gap-2"><CalendarDays className="h-4 w-4 text-[#50698e]"/>{indiaDate}</span><span className="grid h-10 w-10 place-items-center rounded-full bg-[#e9eef6] text-[#52698e]" aria-label="User profile"><UserRound className="h-5 w-5"/></span></div>
      </header>

      <section aria-label="Summary" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {cards.map(({ label, value, detail, icon: Icon, background, color }) => <article key={label} className="flex min-h-[96px] items-center gap-3 rounded-xl border border-[#e6ebf2] p-4 shadow-[0_2px_8px_rgba(24,50,87,0.04)]" style={{ backgroundColor: background }}><span className={`grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-white/75 ${color}`}><Icon className="h-5 w-5"/></span><div className="min-w-0"><h2 className="text-sm font-medium text-[#243956]">{label}</h2><p className="mt-1 truncate font-serif text-xl font-semibold text-[#112543]">{loading ? "…" : value}</p>{!loading && detail && <p className="mt-0.5 text-[11px] text-muted">{detail}</p>}</div></article>)}
      </section>

      <section aria-label="Dashboard charts" className="grid gap-4 xl:grid-cols-[.85fr_1.25fr]">
        <article className={panel}><div className="mb-3 flex items-start justify-between"><div><h2 className="font-serif text-lg font-semibold text-[#132844]">Project Progress</h2><p className="text-xs text-muted">Status of saved projects</p></div></div>
          {data?.projects.initialized && data.projects.records.length > 0 ? <div className="grid items-center gap-2 sm:grid-cols-[1fr_1fr]"><div className="relative h-48"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={projectProgress} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="82%" paddingAngle={2} stroke="none">{projectProgress.map((entry, index) => <Cell key={entry.name} fill={chartColors[index]}/>)}</Pie><Tooltip formatter={(value) => [`${value} projects`, ""]}/></PieChart></ResponsiveContainer><div className="pointer-events-none absolute inset-0 grid place-content-center text-center"><span className="font-serif text-2xl font-semibold text-[#112543]">{data.projects.records.length}</span><span className="text-xs text-muted">Projects</span></div></div><ul className="space-y-3">{projectProgress.map((entry, index) => <li key={entry.name} className="flex items-center justify-between gap-2 text-sm"><span className="flex items-center gap-2 text-[#263955]"><i className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: chartColors[index] }}/>{entry.name}</span><span className="font-semibold text-[#132844]">{entry.value} <span className="font-normal text-muted">({Math.round(entry.value / data.projects.records.length * 100)}%)</span></span></li>)}</ul></div> : <EmptyState loading={loading} message={emptyMessage(data?.projects, "No saved projects yet.")}/>}
        </article>
        <article className={panel}><div className="mb-2 flex flex-wrap items-start justify-between gap-2"><div><h2 className="font-serif text-lg font-semibold text-[#132844]">Monthly Financial Overview</h2><p className="text-xs text-muted">Money received and expenses · last six months</p></div><div className="flex gap-4 text-xs"><span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-[#55b889]"/>Received</span><span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-[#ff9859]"/>Expenses</span></div></div>
          {financialReady && data.transactions.records.length > 0 ? <div className="h-48 w-full"><ResponsiveContainer width="100%" height="100%"><BarChart data={monthlyFinance} margin={{ top: 8, right: 4, left: 2, bottom: 0 }}><CartesianGrid vertical={false} stroke="#e8edf4"/><XAxis dataKey="month" tickLine={false} axisLine={{ stroke: "#d9e2ee" }} tick={{ fill: "#435775", fontSize: 12 }}/><YAxis width={72} tickFormatter={compactCurrency} tickLine={false} axisLine={false} tick={{ fill: "#52647e", fontSize: 11 }}/><Tooltip formatter={(value) => currency(Number(value))} contentStyle={{ borderRadius: 10, borderColor: "#e3e9f0", fontSize: 12 }}/><Bar dataKey="received" name="Received" fill="#55b889" radius={[3, 3, 0, 0]}/><Bar dataKey="expenses" name="Expenses" fill="#ff9859" radius={[3, 3, 0, 0]}/></BarChart></ResponsiveContainer></div> : <EmptyState loading={loading} message={emptyMessage(data?.transactions, "No saved financial transactions yet.")}/>}
        </article>
      </section>

      <section aria-labelledby="quick-actions-heading" className={panel}>
        <h2 id="quick-actions-heading" className="mb-3 font-serif text-lg font-semibold text-[#132844]">Quick Actions</h2>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {quickActions.map(({ label, href, icon: Icon, background, color }) => <Link key={label} href={href} className="flex min-h-11 min-w-0 items-center justify-between gap-2 rounded-lg border border-black/[0.04] px-3 py-2 text-sm font-medium text-[#18304f] transition hover:brightness-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 xl:flex-1" style={{ backgroundColor: background }}><span className="flex min-w-0 items-center gap-2"><Icon className={`h-4 w-4 shrink-0 ${color}`}/><span className="truncate">{label}</span></span><ArrowRight className={`h-4 w-4 shrink-0 ${color}`}/></Link>)}
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
        <article className={panel}><div className="mb-3 flex items-center justify-between"><div><h2 className="font-serif text-lg font-semibold text-[#132844]">Recent Records</h2><p className="text-xs text-muted">Projects and linked activity</p></div><Link href="/projects" className="text-xs font-medium text-blue-700 hover:underline">View projects</Link></div>
          {data?.projects.initialized && projectLatest.length ? <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-left text-sm"><thead><tr className="border-b border-[#e8edf4] text-xs text-[#52647e]"><th className="px-2 py-2 font-medium">Project Name</th><th className="px-2 py-2 font-medium">Work Orders</th><th className="px-2 py-2 font-medium">BOQs</th><th className="px-2 py-2 font-medium">Transactions</th></tr></thead><tbody>{projectLatest.map((project) => <tr key={project.projectId} className="border-b border-[#edf1f6] last:border-0"><td className="px-2 py-3"><Link href="/projects" className="font-medium text-[#162d4b] hover:text-blue-700">{project.projectName}</Link></td><td className="px-2 py-3">{data.workOrders.initialized ? countForProject(project.projectId, data.workOrders.records) : "—"}</td><td className="px-2 py-3">{data.boqs.initialized ? countForProject(project.projectId, data.boqs.records) : "—"}</td><td className="px-2 py-3">{data.transactions.initialized ? countForProject(project.projectId, data.transactions.records) : "—"}</td></tr>)}</tbody></table></div> : <EmptyState loading={loading} message={emptyMessage(data?.projects, "No saved projects yet.")}/>}
        </article>
        <article className={panel}><div className="mb-3 flex items-center justify-between"><div><h2 className="font-serif text-lg font-semibold text-[#132844]">Upcoming Work Orders</h2><p className="text-xs text-muted">Nearest expected completion dates</p></div><Link href="/work-orders" className="text-xs font-medium text-blue-700 hover:underline">View all</Link></div>
          {data?.workOrders.initialized && upcoming.length ? <ul className="divide-y divide-[#edf1f6]">{upcoming.map((order) => <li key={order.workOrderId} className="flex items-center gap-3 py-3 first:pt-1 last:pb-0"><CalendarDays className="h-5 w-5 shrink-0 text-[#516a8d]"/><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-[#182e4a]">{order.projectName}</p><p className="text-xs text-[#52647e]">Expected completion: {new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${order.expectedCompletionDate}T00:00:00`))}</p></div><span className="shrink-0 rounded-full bg-[#eaf3ff] px-3 py-1 text-xs font-medium text-blue-700">{order.status}</span></li>)}</ul> : <EmptyState loading={loading} message={emptyMessage(data?.workOrders, "No upcoming work orders.")}/>}
        </article>
      </section>
      {data && [data.projects, data.workOrders, data.boqs, data.transactions].some((item) => item.error || !item.initialized) && <p className="text-xs text-muted">Some records are unavailable. Connect OneDrive or initialize the relevant workbook to load those figures.</p>}
    </div>
  </div>;
}

function EmptyState({ loading, message }: { loading: boolean; message: string }) {
  return <div className="grid h-48 place-items-center rounded-lg border border-dashed border-[#dfe6ef] bg-[#f8fafd] px-4 text-center text-sm text-[#657791]">{loading ? "Loading saved records…" : message}</div>;
}
