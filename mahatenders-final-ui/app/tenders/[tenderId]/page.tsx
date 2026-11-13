"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { apiFetch, type Tender } from "@/lib/api";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { SectionHeader } from "@/components/section-header";
import { useParams } from "next/navigation";

type Field = [string, string];

function clean(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const text = String(value).trim();
  return !text || /^(?:n\/?a|not available|null|undefined)$/i.test(text) ? undefined : text;
}

function values(fields: Record<string, string>, definitions: Array<[string, string[]]>): Field[] {
  return definitions.flatMap(([label, aliases]) => {
    const value = aliases.map((alias) => fields[alias]).find((candidate) => clean(candidate));
    return clean(value) ? [[label, clean(value)!] as Field] : [];
  });
}

function DataSection({ title, fields, children }: { title: string; fields?: Field[]; children?: React.ReactNode }) {
  if ((!fields || fields.length === 0) && !children) return null;
  return <Card>
    <CardHeader><h2 className="font-serif text-xl">{title}</h2></CardHeader>
    {fields && fields.length > 0 && <CardContent className="grid gap-x-8 gap-y-5 sm:grid-cols-2">{fields.map(([label, value]) => <div key={label} className="min-w-0 border-b border-line pb-3"><p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">{label}</p><p className="whitespace-pre-wrap break-words text-sm leading-6 text-ink">{value}</p></div>)}</CardContent>}
    {children}
  </Card>;
}

function RowsTable({ rows }: { rows: Array<Record<string, string>> }) {
  const visibleRows = rows.filter((row) => Object.values(row).some((value) => clean(value)));
  if (!visibleRows.length) return null;
  const columns = [...new Set(visibleRows.flatMap((row) => Object.keys(row)))];
  return <div className="overflow-x-auto"><table className="data-table w-full"><thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{visibleRows.map((row, index) => <tr key={index}>{columns.map((column) => <td key={column} className="whitespace-pre-wrap">{clean(row[column]) || "—"}</td>)}</tr>)}</tbody></table></div>;
}

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

  if (error) return <Card className="border-danger/30 bg-[#fff5f5] p-6 text-sm text-danger"><strong className="block text-base">Tender details could not be loaded</strong><span className="mt-2 block">{error}</span><Link href={returnTo} className="mt-5 inline-flex items-center gap-2 font-medium text-copper"><ArrowLeft className="h-4 w-4" /> Back to search results</Link></Card>;
  if (!tender) return <div className="space-y-6"><Skeleton className="h-4 w-36" /><Skeleton className="h-10 w-2/3 max-w-xl" /><Card><CardHeader><Skeleton className="h-6 w-48" /></CardHeader><CardContent className="grid gap-5 sm:grid-cols-2">{Array.from({ length: 8 }, (_, index) => <Skeleton key={index} className="h-12 w-full" />)}</CardContent></Card></div>;

  const fields = tender.detail_sections?.core || tender.detail_fields || {};
  const overview: Field[] = [
    ["Tender ID", tender.tender_id],
    ...values(fields, [["Reference number", ["Tender Reference Number"]], ["Tender title", ["Title"]], ["Organisation", ["Organisation Chain"]], ["Tender type", ["Tender Type"]], ["Category", ["Tender Category"]], ["Product", ["Product Category"]], ["Address", ["Address", "Work Location Address", "Site Address"]], ["Pincode", ["Pincode"]]]),
    ...(clean(tender.location_raw || tender.location_city_village || tender.location_taluka || tender.location_district || fields.Location) ? [["Location", clean(tender.location_raw || tender.location_city_village || tender.location_taluka || tender.location_district || fields.Location)!] as Field] : []),
  ];
  if (!overview.some(([label]) => label === "Tender title") && clean(tender.title)) overview.push(["Tender title", clean(tender.title)!]);
  if (!overview.some(([label]) => label === "Organisation") && clean(tender.organisation || tender.organisation_chain)) overview.push(["Organisation", clean(tender.organisation || tender.organisation_chain)!]);
  if (!overview.some(([label]) => label === "Product") && clean(tender.product_category)) overview.push(["Product", clean(tender.product_category)!]);
  const financial: Field[] = [
    ...values(fields, [["EMD amount", ["EMD Amount in ₹"]], ["Tender fees", ["Tender Fee in ₹"]], ["Processing fee", ["Processing Fee in ₹"]], ["Payment information", ["Payment Mode"]]]),
    ...(clean(tender.estimated_value) ? [["Estimated tender value", clean(tender.estimated_value)!] as Field] : []),
  ];
  const dates = values(fields, [["Published date", ["Published Date"]], ["Submission deadline", ["Bid Submission End Date"]], ["Submission start", ["Bid Submission Start Date"]], ["Opening date", ["Bid Opening Date"]], ["Sale start date", ["Document Download / Sale Start Date"]], ["Sale end date", ["Document Download / Sale End Date"]], ["Clarification start date", ["Clarification Start Date"]], ["Clarification end date", ["Clarification End Date"]], ["Pre-bid meeting date", ["Pre Bid Meeting Date"]]]);
  if (!dates.some(([label]) => label === "Published date") && clean(tender.published_at)) dates.push(["Published date", clean(tender.published_at)!]);
  if (!dates.some(([label]) => label === "Submission deadline") && clean(tender.closing_at)) dates.push(["Submission deadline", clean(tender.closing_at)!]);
  const work = values(fields, [["Work description", ["Work Description", "Description"]], ["Work period", ["Period Of Work(Days)"]], ["Form of contract", ["Form Of Contract"]]]);
  const excludedLabels = new Set(["Tender ID", "Tender Reference Number", "Title", "Organisation Chain", "Tender Type", "Tender Category", "Product Category", "Location", "Address", "Work Location Address", "Site Address", "Pincode", "Tender Value in ₹", "EMD Amount in ₹", "Tender Fee in ₹", "Processing Fee in ₹", "Payment Mode", "Published Date", "Bid Submission End Date", "Bid Submission Start Date", "Bid Opening Date", "Document Download / Sale Start Date", "Document Download / Sale End Date", "Clarification Start Date", "Clarification End Date", "Pre Bid Meeting Date", "Work Description", "Description", "Period Of Work(Days)", "Form Of Contract"]);
  const additional = Object.entries(fields).flatMap(([label, value]) => !excludedLabels.has(label) && clean(value) ? [[label, clean(value)!] as Field] : []);
  const payments = tender.detail_sections?.payments || [];
  const corrigenda = tender.detail_sections?.corrigenda || [];
  const covers = tender.detail_sections?.covers || [];
  const documents = tender.detail_sections?.documents || [];

  return <div>
    <Link href={returnTo} className="mb-6 inline-flex items-center gap-2 text-sm font-medium text-copper"><ArrowLeft className="h-4 w-4" /> Back to search results</Link>
    <SectionHeader eyebrow="Tender details" title={tender.title || "Tender details"} description={tender.tender_id} />
    <div className="space-y-5">
      <DataSection title="Tender Overview" fields={overview} />
      <DataSection title="Financial Details" fields={financial} />
      <DataSection title="Important Dates" fields={dates} />
      <DataSection title="Work Details" fields={work} />
      {(covers.length > 0 || documents.length > 0) && <Card><CardHeader><h2 className="font-serif text-xl">Covers and Documents</h2></CardHeader>
        {covers.length > 0 && <div className="space-y-2 px-5 pb-5"><h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Cover details</h3><RowsTable rows={covers} /></div>}
        {documents.length > 0 && <div className="space-y-2 border-t border-line px-5 py-5"><h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Available documents</h3><RowsTable rows={documents} /></div>}
      </Card>}
      {(payments.length > 0 || corrigenda.length > 0 || additional.length > 0 || Boolean(clean(tender.source_listing_url))) && <Card><CardHeader><h2 className="font-serif text-xl">Additional Information</h2></CardHeader>
        {payments.length > 0 && <div className="space-y-2 px-5 pb-5"><h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Payment details</h3><RowsTable rows={payments} /></div>}
        {corrigenda.length > 0 && <div className="space-y-2 border-t border-line px-5 py-5"><h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Corrigenda</h3><RowsTable rows={corrigenda} /></div>}
        {additional.length > 0 && <CardContent className="grid gap-x-8 gap-y-5 border-t border-line sm:grid-cols-2">{additional.map(([label, value]) => <div key={label} className="border-b border-line pb-3"><p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">{label}</p><p className="whitespace-pre-wrap break-words text-sm leading-6">{value}</p></div>)}</CardContent>}
        {clean(tender.source_listing_url) && <div className="border-t border-line px-5 py-4"><a className="inline-flex items-center gap-2 text-sm font-medium text-copper" href={tender.source_listing_url!} target="_blank" rel="noreferrer">Official tender source <ExternalLink className="h-4 w-4" /></a></div>}
      </Card>}
    </div>
  </div>;
}
