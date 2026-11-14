export const queryKeys = {
  projects: ["projects"] as const,
  boqs: ["boqs"] as const,
  workOrders: ["work-orders"] as const,
  payments: ["payments-expenses"] as const,
  reports: ["reports"] as const,
  dashboard: ["dashboard"] as const,
  tenderSearch: (parameters: { path: string; locationSearch: boolean; q: string; district: string; taluka: string }) => ["tenders", "search", parameters] as const,
  tenderScope: ["tenders", "scope-options"] as const,
  tenderDetail: (tenderId: string, locationSearch = true) => ["tenders", "detail", tenderId, { locationSearch }] as const,
  locationSearchResults: (district: string, taluka: string) => ["tenders", "location-results", district, taluka] as const,
  oneDriveStatus: ["onedrive-status"] as const,
};
