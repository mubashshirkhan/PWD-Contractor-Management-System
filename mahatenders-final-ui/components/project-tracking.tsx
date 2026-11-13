"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

type ProjectStatus = "Planned" | "In Progress" | "On Hold" | "Completed";
type MilestoneStatus = "Pending" | "In Progress" | "Completed";

type Milestone = {
  milestoneId: string;
  title: string;
  plannedDate: string;
  actualDate: string | null;
  status: MilestoneStatus;
  displayStatus: MilestoneStatus | "Delayed";
  remarks: string | null;
};

type Project = {
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
  milestones: Milestone[];
  milestoneCounts: { pending: number; delayed: number; completed: number };
  progressPercent: number | null;
};

type ProjectDraft = {
  projectName: string;
  clientDepartment: string;
  location: string;
  description: string;
  contractValue: string;
  startDate: string;
  plannedCompletionDate: string;
  actualCompletionDate: string;
  status: ProjectStatus;
};

type MilestoneDraft = {
  title: string;
  plannedDate: string;
  actualDate: string;
  status: MilestoneStatus;
  remarks: string;
};

const emptyProject: ProjectDraft = {
  projectName: "", clientDepartment: "", location: "", description: "", contractValue: "",
  startDate: "", plannedCompletionDate: "", actualCompletionDate: "", status: "Planned",
};

const emptyMilestone: MilestoneDraft = { title: "", plannedDate: "", actualDate: "", status: "Pending", remarks: "" };
const projectStatuses: ProjectStatus[] = ["Planned", "In Progress", "On Hold", "Completed"];
const milestoneStatuses: MilestoneStatus[] = ["Pending", "In Progress", "Completed"];

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status}).`);
  return body;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

function formatCurrency(value: number | null): string {
  if (value === null) return "Not provided";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value);
}

function projectDraft(project: Project): ProjectDraft {
  return {
    projectName: project.projectName,
    clientDepartment: project.clientDepartment ?? "",
    location: project.location ?? "",
    description: project.description ?? "",
    contractValue: project.contractValue === null ? "" : String(project.contractValue),
    startDate: project.startDate ?? "",
    plannedCompletionDate: project.plannedCompletionDate ?? "",
    actualCompletionDate: project.actualCompletionDate ?? "",
    status: project.status,
  };
}

function milestoneDraft(milestone: Milestone): MilestoneDraft {
  return {
    title: milestone.title,
    plannedDate: milestone.plannedDate,
    actualDate: milestone.actualDate ?? "",
    status: milestone.status,
    remarks: milestone.remarks ?? "",
  };
}

const fieldClass = "mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-copper focus:ring-2 focus:ring-copper/20";
const labelClass = "block text-xs font-medium text-muted";
const primaryButton = "inline-flex items-center justify-center rounded-md bg-copper px-4 py-2 text-sm font-medium text-white transition hover:bg-[#8d4e2e] disabled:cursor-not-allowed disabled:opacity-60";
const secondaryButton = "inline-flex items-center justify-center rounded-md border border-line bg-white px-3 py-2 text-sm font-medium text-ink transition hover:bg-[#f8f6f2] disabled:cursor-not-allowed disabled:opacity-60";

export function ProjectTracking() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [initialized, setInitialized] = useState(false);
  const [connected, setConnected] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All statuses");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [projectEditor, setProjectEditor] = useState<{ mode: "create" | "edit"; project?: Project } | null>(null);
  const [projectForm, setProjectForm] = useState<ProjectDraft>(emptyProject);
  const [milestoneEditor, setMilestoneEditor] = useState<{ projectId: string; milestone?: Milestone } | null>(null);
  const [milestoneForm, setMilestoneForm] = useState<MilestoneDraft>(emptyMilestone);

  const loadProjects = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await requestJson<{ initialized: boolean; projects: Project[] }>("/api/projects");
      setConnected(true);
      setInitialized(result.initialized);
      setProjects(result.projects);
      setSelectedId((current) => current && result.projects.some((project) => project.projectId === current) ? current : result.projects[0]?.projectId ?? null);
    } catch (cause) {
      if (cause instanceof Error && cause.message.includes("Connect OneDrive")) setConnected(false);
      setError(cause instanceof Error ? cause.message : "Could not load Project Tracking.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadProjects(); }, [loadProjects]);

  const visibleProjects = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return projects.filter((project) => {
      if (!includeArchived && project.isArchived) return false;
      if (statusFilter !== "All statuses" && project.status !== statusFilter) return false;
      if (!normalizedQuery) return true;
      return [project.projectId, project.projectName, project.clientDepartment, project.location]
        .some((value) => value?.toLocaleLowerCase().includes(normalizedQuery));
    });
  }, [projects, query, statusFilter, includeArchived]);

  const selectedProject = projects.find((project) => project.projectId === selectedId) ?? null;

  async function initializeWorkbook() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await requestJson<{ created: boolean; projectCount: number }>("/api/projects/initialize", { method: "POST" });
      setNotice(result.created ? "ProjectTracking.xlsx was created in OneDrive and read back successfully. No project records were added." : "The existing ProjectTracking.xlsx schema was checked and read back successfully.");
      await loadProjects();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not initialize the OneDrive workbook.");
    } finally {
      setBusy(false);
    }
  }

  function openNewProject() {
    setProjectForm(emptyProject);
    setProjectEditor({ mode: "create" });
  }

  function openProjectEdit(project: Project) {
    setProjectForm(projectDraft(project));
    setProjectEditor({ mode: "edit", project });
  }

  async function saveProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!projectEditor) return;
    setBusy(true);
    setError("");
    const payload = {
      ...projectForm,
      contractValue: projectForm.contractValue === "" ? null : Number(projectForm.contractValue),
    };
    try {
      const isCreate = projectEditor.mode === "create";
      const saved = await requestJson<Project>(isCreate ? "/api/projects" : `/api/projects/${encodeURIComponent(projectEditor.project!.projectId)}`, {
        method: isCreate ? "POST" : "PATCH",
        body: JSON.stringify(payload),
      });
      setProjectEditor(null);
      await loadProjects();
      setSelectedId(saved.projectId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the project.");
    } finally {
      setBusy(false);
    }
  }

  async function archiveSelected() {
    if (!selectedProject || !window.confirm(`Archive “${selectedProject.projectName}”?`)) return;
    setBusy(true);
    setError("");
    try {
      await requestJson<Project>(`/api/projects/${encodeURIComponent(selectedProject.projectId)}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "archive" }),
      });
      await loadProjects();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not archive the project.");
    } finally {
      setBusy(false);
    }
  }

  function openNewMilestone(projectId: string) {
    setMilestoneForm(emptyMilestone);
    setMilestoneEditor({ projectId });
  }

  function openMilestoneEdit(projectId: string, milestone: Milestone) {
    setMilestoneForm(milestoneDraft(milestone));
    setMilestoneEditor({ projectId, milestone });
  }

  async function saveMilestone(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!milestoneEditor) return;
    setBusy(true);
    setError("");
    try {
      const isCreate = !milestoneEditor.milestone;
      const url = isCreate
        ? `/api/projects/${encodeURIComponent(milestoneEditor.projectId)}/milestones`
        : `/api/projects/${encodeURIComponent(milestoneEditor.projectId)}/milestones/${encodeURIComponent(milestoneEditor.milestone!.milestoneId)}`;
      await requestJson<Milestone>(url, {
        method: isCreate ? "POST" : "PATCH",
        body: JSON.stringify({ ...milestoneForm, actualDate: milestoneForm.actualDate || null, remarks: milestoneForm.remarks || null }),
      });
      setMilestoneEditor(null);
      await loadProjects();
      setSelectedId(milestoneEditor.projectId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the milestone.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {error && <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}
      {notice && <div role="status" className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{notice}</div>}

      {!connected ? (
        <section className="rounded-xl border border-line bg-white p-6 shadow-sm">
          <h2 className="font-serif text-2xl text-ink">Connect OneDrive to continue</h2>
          <p className="mt-2 text-sm leading-6 text-muted">Project records are stored in the Arch Design Studio OneDrive workbook. No records are kept in browser storage.</p>
          <a className={`${primaryButton} mt-4`} href="/api/onedrive/auth/start">Connect OneDrive</a>
        </section>
      ) : loading ? (
        <p className="rounded-xl border border-line bg-white p-6 text-sm text-muted" role="status">Loading Project Tracking from OneDrive…</p>
      ) : !initialized ? (
        <section className="rounded-xl border border-line bg-white p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-copper">OneDrive workbook not initialized</p>
          <h2 className="mt-2 font-serif text-2xl text-ink">Set up Project Tracking storage</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">This creates <strong>ProjectTracking.xlsx</strong> with empty Projects and Milestones tables in the existing Project Management/Project Tracking folder. It checks OneDrive first and creates no project records or folders.</p>
          <button className={`${primaryButton} mt-5`} type="button" onClick={initializeWorkbook} disabled={busy}>{busy ? "Creating workbook…" : "Initialize workbook"}</button>
        </section>
      ) : (
        <>
          <section className="flex flex-col gap-4 rounded-xl border border-line bg-white p-4 shadow-sm md:flex-row md:items-center md:justify-between">
            <div className="flex flex-1 flex-col gap-3 md:flex-row">
              <label className="sr-only" htmlFor="project-search">Search projects</label>
              <input id="project-search" className={`${fieldClass} mt-0 md:max-w-sm`} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, project ID, client or location" />
              <label className="sr-only" htmlFor="project-status-filter">Filter by status</label>
              <select id="project-status-filter" className={`${fieldClass} mt-0 md:max-w-48`} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                <option>All statuses</option>{projectStatuses.map((status) => <option key={status}>{status}</option>)}
              </select>
              <label className="inline-flex items-center gap-2 text-sm text-muted">
                <input type="checkbox" checked={includeArchived} onChange={(event) => setIncludeArchived(event.target.checked)} /> Show archived
              </label>
            </div>
            <button className={primaryButton} type="button" onClick={openNewProject}>New project</button>
          </section>

          <div className="grid gap-6 xl:grid-cols-[minmax(320px,0.85fr)_minmax(0,1.5fr)]">
            <section className="overflow-hidden rounded-xl border border-line bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-line px-5 py-4">
                <div><h2 className="font-serif text-xl">Projects</h2><p className="mt-1 text-xs text-muted">{visibleProjects.length} shown · {projects.length} stored</p></div>
                <span className="rounded-full bg-[#f2eee7] px-3 py-1 text-xs text-muted">OneDrive</span>
              </div>
              {visibleProjects.length ? <ul className="divide-y divide-line">
                {visibleProjects.map((project) => (
                  <li key={project.projectId}>
                    <button type="button" onClick={() => setSelectedId(project.projectId)} className={`w-full px-5 py-4 text-left transition hover:bg-[#faf8f4] ${selectedId === project.projectId ? "bg-[#f8f5ef]" : ""}`} aria-current={selectedId === project.projectId ? "true" : undefined}>
                      <span className="flex items-start justify-between gap-3">
                        <span className="min-w-0"><strong className="block truncate text-sm font-semibold text-ink">{project.projectName}</strong><span className="mt-1 block truncate text-xs text-muted">{project.clientDepartment || project.location || "Client and location not provided"}</span></span>
                        <StatusBadge label={project.isArchived ? "Archived" : project.status} />
                      </span>
                      <span className="mt-3 flex items-center justify-between text-xs text-muted"><span>{project.projectId}</span><span>{project.progressPercent === null ? "No milestones" : `${project.progressPercent}% complete`}</span></span>
                    </button>
                  </li>
                ))}
              </ul> : <div className="p-6 text-sm text-muted">{projects.length ? "No projects match these filters." : "No project records yet."}</div>}
            </section>

            <section className="min-w-0 rounded-xl border border-line bg-white p-5 shadow-sm md:p-6">
              {selectedProject ? (
                <ProjectDetails
                  project={selectedProject}
                  busy={busy}
                  onEdit={() => openProjectEdit(selectedProject)}
                  onArchive={archiveSelected}
                  onAddMilestone={() => openNewMilestone(selectedProject.projectId)}
                  onEditMilestone={(milestone) => openMilestoneEdit(selectedProject.projectId, milestone)}
                />
              ) : <div className="py-12 text-center text-sm text-muted">Select a project to view its details, or create the first project.</div>}
            </section>
          </div>
        </>
      )}

      {projectEditor && <ProjectEditor
        mode={projectEditor.mode}
        project={projectEditor.project}
        draft={projectForm}
        busy={busy}
        onChange={setProjectForm}
        onClose={() => setProjectEditor(null)}
        onSubmit={saveProject}
      />}
      {milestoneEditor && <MilestoneEditor
        milestone={milestoneEditor.milestone}
        draft={milestoneForm}
        busy={busy}
        onChange={setMilestoneForm}
        onClose={() => setMilestoneEditor(null)}
        onSubmit={saveMilestone}
      />}
    </div>
  );
}

function StatusBadge({ label }: { label: string }) {
  const style = label === "Completed" ? "bg-emerald-50 text-emerald-800" : label === "Delayed" || label === "On Hold" ? "bg-amber-50 text-amber-800" : label === "Archived" ? "bg-slate-100 text-slate-600" : "bg-blue-50 text-blue-800";
  return <span className={`inline-flex shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium ${style}`}>{label}</span>;
}

function ProjectDetails({
  project,
  busy,
  onEdit,
  onArchive,
  onAddMilestone,
  onEditMilestone,
}: {
  project: Project;
  busy: boolean;
  onEdit: () => void;
  onArchive: () => void;
  onAddMilestone: () => void;
  onEditMilestone: (milestone: Milestone) => void;
}) {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-copper">Project overview</p>{project.isArchived && <StatusBadge label="Archived" />}</div><h2 className="mt-2 break-words font-serif text-2xl text-ink">{project.projectName}</h2><p className="mt-1 text-xs text-muted">{project.projectId}</p></div>
        <div className="flex shrink-0 gap-2"><button className={secondaryButton} type="button" onClick={onEdit} disabled={busy}>Edit</button>{!project.isArchived && <button className={secondaryButton} type="button" onClick={onArchive} disabled={busy}>Archive</button>}</div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Detail label="Client / department" value={project.clientDepartment} />
        <Detail label="Location" value={project.location} />
        <Detail label="Contract value" value={formatCurrency(project.contractValue)} />
        <Detail label="Start date" value={formatDate(project.startDate)} />
        <Detail label="Planned completion" value={formatDate(project.plannedCompletionDate)} />
        <Detail label="Actual completion" value={formatDate(project.actualCompletionDate)} />
        <Detail label="Status" value={project.status} />
      </div>
      {project.description && <div><h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Description</h3><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-ink">{project.description}</p></div>}

      <div className="rounded-lg bg-[#f8f6f2] p-4">
        <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold">Milestone progress</h3><span className="text-sm font-semibold text-ink">{project.progressPercent === null ? "—" : `${project.progressPercent}%`}</span></div>
        {project.progressPercent !== null && <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#e6e0d7]" role="progressbar" aria-label="Project milestone progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={project.progressPercent}><div className="h-full rounded-full bg-copper transition-all" style={{ width: `${project.progressPercent}%` }} /></div>}
        <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs"><Count label="Pending" value={project.milestoneCounts.pending} /><Count label="Delayed" value={project.milestoneCounts.delayed} /><Count label="Completed" value={project.milestoneCounts.completed} /></div>
        {project.progressPercent === null && <p className="mt-2 text-xs text-muted">Add milestones to calculate progress.</p>}
      </div>

      <div>
        <div className="flex items-center justify-between gap-3"><div><h3 className="font-serif text-xl">Milestones</h3><p className="mt-1 text-xs text-muted">Dates and status are stored with the project workbook.</p></div><button className={secondaryButton} type="button" onClick={onAddMilestone} disabled={busy || project.isArchived}>Add milestone</button></div>
        {project.milestones.length ? <div className="mt-3 overflow-x-auto rounded-lg border border-line"><table className="w-full min-w-[660px] text-left text-xs"><thead className="bg-[#f8f6f2] text-muted"><tr><th className="px-3 py-3 font-medium">Milestone</th><th className="px-3 py-3 font-medium">Planned</th><th className="px-3 py-3 font-medium">Actual</th><th className="px-3 py-3 font-medium">Status</th><th className="px-3 py-3 font-medium">Remarks</th><th className="px-3 py-3" /></tr></thead><tbody className="divide-y divide-line">{project.milestones.map((milestone) => <tr key={milestone.milestoneId}><td className="px-3 py-3 font-medium text-ink">{milestone.title}</td><td className="px-3 py-3 text-muted">{formatDate(milestone.plannedDate)}</td><td className="px-3 py-3 text-muted">{formatDate(milestone.actualDate)}</td><td className="px-3 py-3"><StatusBadge label={milestone.displayStatus} /></td><td className="max-w-[180px] truncate px-3 py-3 text-muted" title={milestone.remarks ?? ""}>{milestone.remarks || "—"}</td><td className="px-3 py-3 text-right"><button className="text-copper underline underline-offset-2 disabled:opacity-50" type="button" onClick={() => onEditMilestone(milestone)} disabled={busy || project.isArchived}>Edit</button></td></tr>)}</tbody></table></div> : <p className="mt-3 rounded-lg border border-dashed border-line px-4 py-6 text-center text-sm text-muted">No milestones have been added.</p>}
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string | null }) {
  return <div className="rounded-lg border border-line px-3 py-3"><p className="text-[11px] uppercase tracking-wide text-muted">{label}</p><p className="mt-1 text-sm font-medium text-ink">{value || "Not provided"}</p></div>;
}

function Count({ label, value }: { label: string; value: number }) {
  return <div className="rounded-md bg-white px-2 py-2"><strong className="block text-base text-ink">{value}</strong><span className="mt-0.5 block text-[11px] text-muted">{label}</span></div>;
}

function ProjectEditor({ mode, project, draft, busy, onChange, onClose, onSubmit }: {
  mode: "create" | "edit";
  project?: Project;
  draft: ProjectDraft;
  busy: boolean;
  onChange: (draft: ProjectDraft) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const field = (key: keyof ProjectDraft, label: string, type = "text", required = false) => (
    <label className={labelClass}>{label}<input className={fieldClass} type={type} value={draft[key]} required={required} min={type === "number" ? "0" : undefined} step={type === "number" ? "0.01" : undefined} onChange={(event) => onChange({ ...draft, [key]: event.target.value })} /></label>
  );
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white p-5 shadow-xl md:p-7" role="dialog" aria-modal="true" aria-labelledby="project-editor-title"><div className="flex items-start justify-between gap-3"><div><p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-copper">Project record</p><h2 id="project-editor-title" className="mt-1 font-serif text-2xl">{mode === "create" ? "Create project" : "Edit project"}</h2>{project && <p className="mt-1 text-xs text-muted">{project.projectId}</p>}</div><button className={secondaryButton} type="button" onClick={onClose} aria-label="Close project form">Close</button></div>
    <form className="mt-5 space-y-4" onSubmit={onSubmit}><div className="grid gap-4 sm:grid-cols-2">{field("projectName", "Project name", "text", true)}{field("clientDepartment", "Client / department")}{field("location", "Location")}{field("contractValue", "Contract value (INR)", "number")}{field("startDate", "Start date", "date")}{field("plannedCompletionDate", "Planned completion date", "date")}{field("actualCompletionDate", "Actual completion date", "date")}<label className={labelClass}>Project status<select className={fieldClass} value={draft.status} onChange={(event) => onChange({ ...draft, status: event.target.value as ProjectStatus })}>{projectStatuses.map((status) => <option key={status}>{status}</option>)}</select></label></div>
      <label className={labelClass}>Description<textarea className={`${fieldClass} min-h-24`} value={draft.description} onChange={(event) => onChange({ ...draft, description: event.target.value })} maxLength={4000} /></label>
      <div className="flex justify-end gap-2 border-t border-line pt-4"><button className={secondaryButton} type="button" onClick={onClose} disabled={busy}>Cancel</button><button className={primaryButton} type="submit" disabled={busy}>{busy ? "Saving to OneDrive…" : mode === "create" ? "Create project" : "Save changes"}</button></div>
    </form></section></div>;
}

function MilestoneEditor({ milestone, draft, busy, onChange, onClose, onSubmit }: {
  milestone?: Milestone;
  draft: MilestoneDraft;
  busy: boolean;
  onChange: (draft: MilestoneDraft) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="w-full max-w-xl rounded-xl bg-white p-5 shadow-xl md:p-7" role="dialog" aria-modal="true" aria-labelledby="milestone-editor-title"><div className="flex items-start justify-between gap-3"><div><p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-copper">Project milestone</p><h2 id="milestone-editor-title" className="mt-1 font-serif text-2xl">{milestone ? "Edit milestone" : "Add milestone"}</h2></div><button className={secondaryButton} type="button" onClick={onClose} aria-label="Close milestone form">Close</button></div>
    <form className="mt-5 space-y-4" onSubmit={onSubmit}><label className={labelClass}>Milestone title<input className={fieldClass} required maxLength={160} value={draft.title} onChange={(event) => onChange({ ...draft, title: event.target.value })} /></label><div className="grid gap-4 sm:grid-cols-2"><label className={labelClass}>Planned date<input className={fieldClass} required type="date" value={draft.plannedDate} onChange={(event) => onChange({ ...draft, plannedDate: event.target.value })} /></label><label className={labelClass}>Actual date<input className={fieldClass} type="date" value={draft.actualDate} onChange={(event) => onChange({ ...draft, actualDate: event.target.value })} /></label><label className={labelClass}>Status<select className={fieldClass} value={draft.status} onChange={(event) => onChange({ ...draft, status: event.target.value as MilestoneStatus })}>{milestoneStatuses.map((status) => <option key={status}>{status}</option>)}</select></label></div><label className={labelClass}>Remarks<textarea className={`${fieldClass} min-h-20`} maxLength={2000} value={draft.remarks} onChange={(event) => onChange({ ...draft, remarks: event.target.value })} /></label><div className="flex justify-end gap-2 border-t border-line pt-4"><button className={secondaryButton} type="button" onClick={onClose} disabled={busy}>Cancel</button><button className={primaryButton} type="submit" disabled={busy}>{busy ? "Saving to OneDrive…" : milestone ? "Save milestone" : "Add milestone"}</button></div></form></section></div>;
}
