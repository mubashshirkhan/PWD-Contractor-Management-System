"use client";
/* CAPTCHA responses may be data URLs and are intentionally not optimized by next/image. */
/* eslint-disable @next/next/no-img-element */

import { useState } from "react";
import Link from "next/link";
import { useEffect } from "react";
import { ArrowUpRight, LoaderCircle, MapPinned, ShieldCheck, X } from "lucide-react";
import { apiFetch, formatCurrency, formatDate, tenderOrganisation, type LocationJob, type Tender } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

const talukas: Record<string, string[]> = {
  Wardha: ["Wardha", "Seloo", "Deoli", "Hinganghat", "Samudrapur", "Karanja", "Arvi", "Ashti"],
  Amravati: ["Amravati", "Bhatkuli", "Nandgaon Khandeshwar", "Daryapur", "Anjangaon Surji", "Achalpur", "Chandurbazar", "Chikhaldara", "Dharni", "Morshi", "Warud", "Chandur Railway", "Teosa", "Dhamangaon Railway"],
};

function locationCacheKey(district: string, taluka: string) {
  return `arch-design-location-results:v2:${district}:${taluka}`;
}

export function LocationSearch({ onResults }: { onResults?: (tenders: Tender[]) => void } = {}) {
  const [district, setDistrict] = useState("");
  const [taluka, setTaluka] = useState("");
  const [job, setJob] = useState<LocationJob>();
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [resultCount, setResultCount] = useState<number>();
  const [captchaAnswer, setCaptchaAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const nextDistrict = params.get("district") || "";
    const nextTaluka = params.get("taluka") || "";
    setDistrict(nextDistrict);
    setTaluka(nextTaluka);
    if (nextDistrict && nextTaluka) {
      const cached = window.sessionStorage.getItem(locationCacheKey(nextDistrict, nextTaluka));
      if (cached) {
        try {
          const restored = JSON.parse(cached) as Tender[];
          setTenders(restored);
          setResultCount(restored.length);
        } catch {
          window.sessionStorage.removeItem(locationCacheKey(nextDistrict, nextTaluka));
        }
      }
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const params = new URLSearchParams();
    if (district) params.set("district", district);
    if (taluka) params.set("taluka", taluka);
    const query = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
  }, [district, taluka, hydrated]);

  async function start() {
    if (!district || !taluka || busy) return;
    setBusy(true);
    setTenders([]);
    setResultCount(undefined);
    try {
      const next = await apiFetch<LocationJob>("/api/v1/location-search/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ district, taluka, human_captcha: true, max_details: 5 }) });
      setJob(next);
      if (next.status === "CAPTCHA_REQUIRED") {
        setBusy(false);
      } else if (next.reference) {
        void poll(next.reference);
      }
    } catch (reason) {
      setJob({ status: "FAILED", error: reason instanceof Error ? reason.message : "Location search failed" });
      setBusy(false);
    }
  }

  async function poll(reference: string) {
    try {
      const next = await apiFetch<LocationJob>(`/api/v1/location-search/${encodeURIComponent(reference)}`);
      setJob(next);
      if (["STARTING", "RUNNING"].includes(next.status)) {
        window.setTimeout(() => void poll(reference), 1000);
      } else {
        setBusy(false);
        const runId = next.summary?.run_id;
        if (next.status === "COMPLETED" && runId) {
          const result = await apiFetch<{ tenders: Tender[] }>(`/api/v1/location-search/runs/${encodeURIComponent(runId)}/tenders`);
          const tenders = result.tenders || [];
          setTenders(tenders);
          setResultCount(tenders.length);
          window.sessionStorage.setItem(locationCacheKey(district, taluka), JSON.stringify(tenders));
          onResults?.(tenders);
        }
      }
    } catch (reason) {
      setJob({ status: "FAILED", error: reason instanceof Error ? reason.message : "Location search status failed" });
      setBusy(false);
    }
  }

  async function submitCaptcha() {
    if (!job?.reference || !captchaAnswer || busy) return;
    setBusy(true);
    try {
      const next = await apiFetch<LocationJob>(`/api/v1/location-search/${encodeURIComponent(job.reference)}/captcha`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answer: captchaAnswer }) });
      setJob(next);
      setCaptchaAnswer("");
      const reference = next.reference || job.reference;
      if (next.status !== "CAPTCHA_REQUIRED" && reference) void poll(reference);
      else setBusy(false);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "CAPTCHA submission failed";
      if (message.toLowerCase().includes("not waiting for captcha")) {
        setCaptchaAnswer("");
        setJob({
          status: "BLOCKED",
          error: "This CAPTCHA session is no longer valid. Start a new search to receive a fresh CAPTCHA.",
        });
      } else {
        setJob({ ...job, error: message });
      }
      setBusy(false);
    }
  }

  async function cancel() {
    if (!job?.reference) return;
    try {
      await apiFetch(`/api/v1/location-search/${encodeURIComponent(job.reference)}/cancel`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    } finally {
      setBusy(false);
      setJob({ status: "CANCELLED" });
    }
  }

  const returnTo = `/tender-search?district=${encodeURIComponent(district)}&taluka=${encodeURIComponent(taluka)}`;

  return (
    <Card>
      <CardHeader><div className="flex items-start gap-2"><MapPinned className="mt-1 h-5 w-5 shrink-0 text-blue-700" /><h2 className="font-serif text-xl leading-7">Search MahaTenders by location</h2></div></CardHeader>
      <CardContent>
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
          <label className="grid gap-2 text-sm font-medium text-muted">District<select className="field" value={district} onChange={(event) => { setDistrict(event.target.value); setTaluka(""); setJob(undefined); }}><option value="">Select district</option><option>Wardha</option><option>Amravati</option></select></label>
          <label className="grid gap-2 text-sm font-medium text-muted">Taluka<select className="field" value={taluka} disabled={!district} onChange={(event) => setTaluka(event.target.value)}><option value="">Select taluka</option>{(talukas[district] || []).map((item) => <option key={item}>{item}</option>)}</select></label>
          <Button className="self-end" onClick={() => void start()} disabled={!district || !taluka || busy}>{busy && <LoaderCircle className="h-4 w-4 animate-spin" />} Start search</Button>
        </div>
        {job && <div className="mt-5 rounded-lg border border-line bg-field p-4 text-sm"><div className="flex items-center justify-between"><strong>{job.status}</strong>{job.reference && <Button variant="quiet" className="h-8 px-2" onClick={() => void cancel()}><X className="h-4 w-4" /> Cancel</Button>}</div>{job.error && <p className="mt-2 text-danger">{job.error}</p>}{job.captcha?.image && <div className="mt-4 flex flex-wrap items-end gap-3"><div>        <p className="mb-2 flex items-center gap-2 text-xs font-medium text-muted"><ShieldCheck className="h-4 w-4" /> Enter the displayed CAPTCHA</p><img src={job.captcha.image} alt="MahaTenders CAPTCHA" className="max-w-[320px] rounded border border-line bg-white" /></div><div className="flex gap-2"><input className="field" value={captchaAnswer} onChange={(event) => setCaptchaAnswer(event.target.value)} placeholder="CAPTCHA answer" autoComplete="off" /><Button variant="secondary" onClick={() => void submitCaptcha()} disabled={!captchaAnswer || busy}>Submit</Button></div></div>}{job.summary && <p className="mt-3 text-muted">Pages: {job.summary.listing_pages_processed || 0} · Tender IDs: {job.summary.tender_ids_discovered || 0} · Details: {job.summary.tender_details_retrieved || 0}</p>}{resultCount !== undefined && <p className="mt-3 font-medium text-ink">Search completed: {resultCount} tender records retrieved.</p>}</div>}
        {tenders.length > 0 && <div className="mt-6 overflow-x-auto rounded-lg border border-line"><table className="data-table w-full"><thead><tr><th>Tender ID</th><th>Title</th><th>Organisation</th><th>District</th><th>Taluka</th><th>Published</th><th>Closing</th><th>Estimated value</th><th /></tr></thead><tbody>{tenders.map((tender) => <tr key={tender.tender_id}><td className="whitespace-nowrap font-medium">{tender.tender_id}</td><td className="min-w-[220px]">{tender.title || "Not available"}</td><td className="min-w-[180px]">{tenderOrganisation(tender)}</td><td>{tender.district || tender.location_district || "Not available"}</td><td>{tender.taluka || tender.location_taluka || "Not available"}</td><td className="whitespace-nowrap text-muted">{formatDate(tender.published_at)}</td><td className="whitespace-nowrap text-muted">{formatDate(tender.closing_at)}</td><td className="whitespace-nowrap text-muted">{formatCurrency(tender.estimated_value)}</td><td><Link href={`/tenders/${encodeURIComponent(tender.tender_id)}?returnTo=${encodeURIComponent(returnTo)}`} className="inline-flex items-center gap-1 whitespace-nowrap text-sm font-medium text-copper">Details <ArrowUpRight className="h-4 w-4" /></Link></td></tr>)}</tbody></table></div>}
      </CardContent>
    </Card>
  );
}
