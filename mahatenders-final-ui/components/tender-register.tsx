"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, ChevronLeft, ChevronRight, RefreshCw, SlidersHorizontal } from "lucide-react";
import { apiFetch, formatCurrency, formatDate, tenderLocation, tenderOrganisation, type LocationOptionsResponse, type Tender, type TendersResponse } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { LocationSearch } from "@/components/location-search";

type Filters = {
  q: string;
  district: string;
  taluka: string;
  sort: "closing" | "title";
  page: number;
};

const defaultFilters: Filters = { q: "", district: "", taluka: "", sort: "closing", page: 1 };

function readFilters(): Filters {
  if (typeof window === "undefined") return defaultFilters;
  const params = new URLSearchParams(window.location.search);
  const page = Number(params.get("page") || "1");
  return {
    q: params.get("q") || "",
    district: params.get("district") || "",
    taluka: params.get("taluka") || "",
    sort: params.get("sort") === "title" ? "title" : "closing",
    page: Number.isInteger(page) && page > 0 ? page : 1,
  };
}

function filterQuery(filters: Filters) {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.district) params.set("district", filters.district);
  if (filters.taluka) params.set("taluka", filters.taluka);
  if (filters.sort !== "closing") params.set("sort", filters.sort);
  if (filters.page > 1) params.set("page", String(filters.page));
  return params.toString();
}

function locationValue(tender: Tender, field: "district" | "taluka") {
  return field === "district"
    ? tender.district || tender.location_district || "Not available"
    : tender.taluka || tender.location_taluka || "Not available";
}

export function TenderRegister({ title = "Tender search", description = "Search tender records by location and review the information captured from the source.", showLocationSearch = true, path = "/tender-search" }: { title?: string; description?: string; showLocationSearch?: boolean; path?: string }) {
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [hydrated, setHydrated] = useState(false);
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [locations, setLocations] = useState<LocationOptionsResponse>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const pageSize = 10;

  useEffect(() => {
    const restore = () => setFilters(readFilters());
    restore();
    setHydrated(true);
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);

  useEffect(() => {
    apiFetch<LocationOptionsResponse>("/api/v1/scope")
      .then(setLocations)
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Location options could not be loaded"));
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const query = filterQuery(filters);
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
  }, [filters, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    let active = true;
    setLoading(true);
    setError(undefined);
    const params = new URLSearchParams();
    params.set("location_search", "1");
    if (filters.q) params.set("q", filters.q);
    if (filters.district) params.set("district", filters.district);
    if (filters.taluka) params.set("taluka", filters.taluka);
    const cacheKey = `arch-design-tenders:v2:${window.location.pathname}?${params.toString()}`;
    const cached = window.sessionStorage.getItem(cacheKey);
    if (cached) {
      try {
        const result = JSON.parse(cached) as TendersResponse;
        setTenders(result.tenders || []);
        setLoading(false);
        return () => { active = false; };
      } catch {
        window.sessionStorage.removeItem(cacheKey);
      }
    }
    apiFetch<TendersResponse>(`/api/v1/tenders?${params.toString()}`).then((result) => {
      if (!active) return;
      setTenders(result.tenders || []);
      window.sessionStorage.setItem(cacheKey, JSON.stringify(result));
    }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : "Tender records could not be loaded");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [filters.q, filters.district, filters.taluka, hydrated]);

  const districts = Object.keys(locations?.districts || {});
  const talukas = filters.district ? locations?.districts?.[filters.district]?.talukas || [] : [];
  const sorted = useMemo(() => [...tenders].sort((a, b) => {
    if (filters.sort === "title") return (a.title || a.tender_id).localeCompare(b.title || b.tender_id);
    return (a.closing_at || "9999").localeCompare(b.closing_at || "9999");
  }), [filters.sort, tenders]);
  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const currentPage = Math.min(filters.page, pageCount);
  const visible = sorted.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  function update(partial: Partial<Filters>) {
    setFilters((current) => ({ ...current, ...partial, page: partial.page || 1 }));
  }

  return (
    <div>
      <div className="mb-6 flex items-end justify-between gap-4">
        <div><p className="mb-2 text-xs font-medium text-copper">Tender search</p><h1 className="font-serif text-3xl tracking-tight text-ink">{title}</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-muted">{description}</p></div>
        <Button variant="secondary" onClick={() => setFilters((current) => ({ ...current }))} disabled={loading}><RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} /> Refresh</Button>
      </div>
      <Card className="mb-6">
        <CardContent className="grid gap-3 md:grid-cols-[1.4fr_1fr_1fr_auto]">
          <label className="grid gap-2 text-sm font-medium text-muted">Keyword<input className="field" value={filters.q} onChange={(event) => update({ q: event.target.value })} placeholder="Tender ID, title or location" /></label>
          <Filter label="District" value={filters.district} onChange={(value) => update({ district: value, taluka: "" })} options={districts} placeholder="Select district" />
          <Filter label="Taluka" value={filters.taluka} onChange={(value) => update({ taluka: value })} options={talukas} placeholder="Select taluka" disabled={!filters.district} />
          <label className="grid gap-2 text-sm font-medium text-muted">Sort<select className="field" value={filters.sort} onChange={(event) => update({ sort: event.target.value as Filters["sort"] })}><option value="closing">Closing date</option><option value="title">Title</option></select></label>
        </CardContent>
      </Card>
      {error && <Card className="mb-6 border-danger/30 bg-[#fff5f5] p-5 text-sm text-danger">{error}</Card>}
      <Card>
        <div className="flex items-center justify-between border-b border-line px-5 py-4"><div><p className="text-xs font-medium text-copper">Search results</p><h2 className="mt-1 font-serif text-xl">{loading ? "Loading tenders" : `${sorted.length} matching tenders`}</h2></div><SlidersHorizontal className="h-4 w-4 text-muted" /></div>
        <div className="overflow-x-auto"><table className="data-table w-full"><thead><tr><th>Tender ID</th><th>Title</th><th>Organisation</th><th>District</th><th>Taluka</th><th>Published</th><th>Closing</th><th>Estimated value</th><th /></tr></thead><tbody>{loading ? Array.from({ length: 5 }, (_, index) => <tr key={index}>{Array.from({ length: 9 }, (_, cell) => <td key={cell}><Skeleton className="h-4 w-full min-w-20" /></td>)}</tr>) : visible.map((tender) => { const returnTo = `${path}${filterQuery(filters) ? `?${filterQuery(filters)}` : ""}`; return <tr key={tender.tender_id}><td className="whitespace-nowrap font-medium">{tender.tender_id}</td><td className="min-w-[220px]">{tender.title || "Not available"}</td><td className="min-w-[180px]">{tenderOrganisation(tender)}</td><td>{locationValue(tender, "district")}</td><td>{locationValue(tender, "taluka")}</td><td className="whitespace-nowrap text-muted">{formatDate(tender.published_at)}</td><td className="whitespace-nowrap text-muted">{formatDate(tender.closing_at)}</td><td className="whitespace-nowrap text-muted">{formatCurrency(tender.estimated_value)}</td><td><Link href={`/tenders/${encodeURIComponent(tender.tender_id)}?returnTo=${encodeURIComponent(returnTo)}`} className="inline-flex items-center gap-1 whitespace-nowrap text-sm font-medium text-copper">Details <ArrowUpRight className="h-4 w-4" /></Link></td></tr>; })}</tbody></table>{!loading && !visible.length && <div className="p-10 text-center text-sm text-muted">No tenders match these location filters</div>}</div>
        {pageCount > 1 && <div className="flex items-center justify-between border-t border-line px-5 py-3 text-sm text-muted"><span>Page {currentPage} of {pageCount}</span><div className="flex gap-2"><Button variant="quiet" disabled={currentPage === 1} onClick={() => update({ page: currentPage - 1 })}><ChevronLeft className="h-4 w-4" /> Previous</Button><Button variant="quiet" disabled={currentPage === pageCount} onClick={() => update({ page: currentPage + 1 })}>Next <ChevronRight className="h-4 w-4" /></Button></div></div>}
      </Card>
      {showLocationSearch && <div className="mt-8"><LocationSearch onResults={setTenders} /></div>}
    </div>
  );
}

function Filter({ label, value, onChange, options, placeholder, disabled }: { label: string; value: string; onChange: (value: string) => void; options: string[]; placeholder: string; disabled?: boolean }) {
  return <label className="grid gap-2 text-sm font-medium text-muted">{label}<select className="field" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}><option value="">{placeholder}</option>{options.map((option) => <option key={option}>{option}</option>)}</select></label>;
}
