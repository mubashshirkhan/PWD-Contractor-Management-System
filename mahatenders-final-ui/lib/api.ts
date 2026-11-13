export type Tender = {
  tender_id: string;
  title?: string | null;
  organisation?: string | null;
  organisation_chain?: string | null;
  location_raw?: string | null;
  location_city_village?: string | null;
  location_taluka?: string | null;
  location_district?: string | null;
  district?: string | null;
  taluka?: string | null;
  published_at?: string | null;
  closing_at?: string | null;
  estimated_value?: string | number | null;
  product_category?: string | null;
  source_listing_url?: string | null;
  source_detail_url?: string | null;
  detail_fields?: Record<string, string>;
  detail_sections?: {
    core?: Record<string, string>;
    payments?: Array<Record<string, string>>;
    covers?: Array<Record<string, string>>;
    documents?: Array<Record<string, string>>;
    corrigenda?: Array<Record<string, string>>;
  };
  source?: { url?: string; extracted_at?: string; evidence_type?: string };
};

export type LocationOptionsResponse = {
  districts?: Record<string, { talukas: string[] }>;
};

export type StatsResponse = {
  districts?: Array<{ district: string; tender_count: number }>;
  talukas?: Array<{ district: string; taluka: string; tender_count: number }>;
  classification_counts?: Record<string, number>;
};

export type TendersResponse = {
  count: number;
  tenders: Tender[];
  classification_counts?: Record<string, number>;
};

export type OrganisationsResponse = {
  count: number;
  organisations: Array<{ name: string; tender_count: number }>;
};

export type LocationJob = {
  reference?: string;
  status: string;
  error?: string;
  captcha?: { image?: string };
  summary?: {
    run_id?: string;
    listing_pages_processed?: number;
    tender_ids_discovered?: number;
    tender_details_retrieved?: number;
    errors?: string[];
    message?: string;
  };
};

export const DEFAULT_API_BASE_URL = "https://mahatenders-backend.onrender.com";

export function getApiBaseUrl() {
  const configured = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (typeof window !== "undefined" && (!configured || /^https?:\/\//i.test(configured))) {
    return "/api/proxy";
  }
  return (configured || DEFAULT_API_BASE_URL).replace(/\/+$/, "");
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.headers || {}),
    },
    cache: "no-store",
  });
  const text = await response.text();
  let body: T & { error?: string };
  try {
    body = (text ? JSON.parse(text) : {}) as T & { error?: string };
  } catch {
    throw new Error(`API returned invalid JSON (${response.status})`);
  }
  if (!response.ok) {
    throw new Error(body.error || `API request failed (${response.status})`);
  }
  return body;
}

export function tenderLocation(tender: Tender) {
  return tender.location_raw || tender.location_city_village || tender.location_taluka || tender.location_district || "Location not captured";
}

export function tenderOrganisation(tender: Tender) {
  return tender.organisation || tender.organisation_chain || "Organisation not captured";
}

export function formatDate(value?: string | null) {
  if (!value) return "Not available";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function formatCurrency(value?: string | number | null) {
  if (value === null || value === undefined || value === "") return "Not available";
  const numeric = typeof value === "number"
    ? value
    : Number(String(value).replace(/,/g, "").trim());
  if (!Number.isFinite(numeric)) return `₹${value}`;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(numeric);
}
