"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, ExternalLink, MapPin } from "lucide-react";
import { apiFetch, formatCurrency, formatDate, tenderLocation, tenderOrganisation, type Tender } from "@/lib/api";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { SectionHeader } from "@/components/section-header";
import { useParams } from "next/navigation";

export default function TenderDetailsPage() {
  const params = useParams<{ tenderId: string }>();
  const [tender, setTender] = useState<Tender>();
  const [returnTo, setReturnTo] = useState("/tender-search");
  const [error, setError] = useState<string>();

  useEffect(() => {
    const queryReturnTo = new URLSearchParams(window.location.search).get("returnTo");
    if (queryReturnTo?.startsWith("/")) setReturnTo(queryReturnTo);
    const tenderId = decodeURIComponent(params.tenderId);
    apiFetch<Tender>(`/api/v1/tenders/${encodeURIComponent(tenderId)}?location_search=1`)
      .then(setTender)
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Tender details could not be loaded"));
  }, [params.tenderId]);

  if (error) return <Card className="border-danger/30 bg-[#fff5f5] p-6 text-sm text-danger"><strong className="block text-base">Tender not found</strong><span className="mt-2 block">{error}</span><Link href={returnTo} className="mt-5 inline-flex items-center gap-2 font-medium text-copper"><ArrowLeft className="h-4 w-4" /> Back to search results</Link></Card>;
  if (!tender) return <div className="space-y-6"><Skeleton className="h-4 w-36" /><Skeleton className="h-10 w-2/3 max-w-xl" /><Card><CardHeader><Skeleton className="h-6 w-48" /></CardHeader><CardContent className="grid gap-5 sm:grid-cols-2">{Array.from({ length: 10 }, (_, index) => <div key={index} className="space-y-2"><Skeleton className="h-3 w-24" /><Skeleton className="h-5 w-full" /></div>)}</CardContent></Card></div>;
  const sections = tender.detail_sections || {};
  const fields = Object.entries(sections.core || tender.detail_fields || {});
  const financialFields = fields.filter(([label]) => isFinancialField(label));
  const otherFields = fields.filter(([label]) => !isFinancialField(label));
  return <div><Link href={returnTo} className="mb-6 inline-flex items-center gap-2 text-sm text-copper"><ArrowLeft className="h-4 w-4" /> Back to search results</Link><SectionHeader eyebrow="Tender details" title={tender.title || "Tender details"} description={tender.tender_id} /><div><Card><CardHeader><h2 className="font-serif text-xl">Tender information</h2></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2"><Detail label="Tender ID" value={tender.tender_id} /><Detail label="Title" value={tender.title} /><Detail label="Organisation" value={tenderOrganisation(tender)} /><Detail label="Department" value={tender.product_category} /><Detail label="Location" value={tenderLocation(tender)} icon={<MapPin className="h-4 w-4 text-copper" />} /><Detail label="District" value={tender.district || tender.location_district} /><Detail label="Taluka" value={tender.taluka || tender.location_taluka} /><Detail label="Description" value={fields.find(([label]) => label === "Description")?.[1] || fields.find(([label]) => label === "Work Description")?.[1]} /><Detail label="Estimated value" value={formatCurrency(tender.estimated_value)} /><Detail label="Publication date" value={formatDate(tender.published_at)} /><Detail label="Closing date" value={formatDate(tender.closing_at)} /><div className="border-t border-line pt-4 sm:col-span-2"><p className="mb-1 text-xs text-muted">Official source</p>{tender.source_listing_url ? <SourceLink label="See tender on MahaTenders" url={tender.source_listing_url} /> : <p className="text-sm text-muted">Not available</p>}</div></CardContent></Card></div><StructuredSections sections={sections} />{(financialFields.length > 0 || otherFields.length > 0) && <><FieldCard title="Tender fees and deposits" fields={financialFields} currency /><FieldCard title="Captured tender fields" fields={otherFields} /></>}</div>;
}

function StructuredSections({ sections }: { sections: NonNullable<Tender["detail_sections"]> }) {
  return <div className="mt-6 grid gap-6 md:grid-cols-2">
    {sections.payments && sections.payments.length > 0 && <RowsCard label="Payment instruments" rows={sections.payments} columns={["S.No", "Bank Name"]} />}
    {sections.covers && sections.covers.length > 0 && <RowsCard label="Covers information" rows={sections.covers} columns={["Cover No", "Cover Type", "Description", "Document Type"]} />}
    {sections.documents && sections.documents.length > 0 && <RowsCard label="Tender documents" rows={sections.documents} columns={["S.No", "Description", "Document Name", "Document Size (in KB)", "Document Type"]} wide />}
    {sections.corrigenda && sections.corrigenda.length > 0 && <RowsCard label="Corrigenda" rows={sections.corrigenda} columns={Object.keys(sections.corrigenda[0])} />}
  </div>;
}

function RowsCard({ label, rows, columns, wide = false }: { label: string; rows: Array<Record<string, string>>; columns: string[]; wide?: boolean }) {
  return <Card className={wide ? "md:col-span-2" : undefined}><CardHeader><h2 className="font-serif text-xl">{label}</h2></CardHeader><div className="overflow-x-auto"><table className="data-table w-full"><thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{columns.map((column) => <td key={column}>{column === "Document Size (in KB)" ? formatDocumentSize(row[column]) : row[column] || "Not available"}</td>)}</tr>)}</tbody></table></div></Card>;
}

function formatDocumentSize(value?: string | null) {
  if (!value) return "Not available";
  const numeric = Number(value.replace(/,/g, "").trim());
  return Number.isFinite(numeric) ? `${numeric.toFixed(2)} KB` : value;
}

function isFinancialField(label: string) {
  const normalized = label.toLowerCase();
  return normalized.includes("fee") || normalized.includes("emd") || normalized.includes("tender value") || normalized.includes("processing");
}

function FieldCard({ title, fields, currency = false }: { title: string; fields: Array<[string, string]>; currency?: boolean }) {
  if (fields.length === 0) return null;
  return <Card className="mt-6"><CardHeader><h2 className="font-serif text-xl">{title}</h2></CardHeader><div className="overflow-x-auto"><table className="data-table w-full"><thead><tr><th>Field</th><th>Value</th></tr></thead><tbody>{fields.map(([label, value]) => <tr key={label}><td className="font-medium">{label}</td><td className="text-muted">{currency && (label.includes("₹") || label.includes("Amount")) ? formatCurrency(value) : value || "Not available"}</td></tr>)}</tbody></table></div></Card>;
}

function Detail({ label, value, icon }: { label: string; value?: string | number | null; icon?: React.ReactNode }) {
  return <div><p className="mb-1 flex items-center gap-2 text-xs text-muted">{icon}{label}</p><p className="text-sm leading-6">{value || "Not available"}</p></div>;
}

function SourceLink({ label, url }: { label: string; url: string }) {
  return <a className="inline-flex items-center gap-2 font-medium text-copper" href={url} target="_blank" rel="noreferrer">{label}<ExternalLink className="h-4 w-4" /></a>;
}
