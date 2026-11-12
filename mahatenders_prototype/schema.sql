CREATE TABLE IF NOT EXISTS organisations (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    tender_count INTEGER NOT NULL,
    source_url TEXT NOT NULL,
    count_url TEXT NOT NULL,
    observed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tenders (
    id INTEGER PRIMARY KEY,
    tender_id TEXT NOT NULL UNIQUE,
    reference_number TEXT,
    title TEXT,
    organisation_chain TEXT NOT NULL,
    published_at TEXT,
    closing_at TEXT,
    opening_at TEXT,
    estimated_value TEXT,
    product_category TEXT,
    location_raw TEXT,
    location_city_village TEXT,
    location_taluka TEXT,
    location_district TEXT,
    location_state TEXT,
    location_provenance TEXT NOT NULL,
    location_confidence REAL NOT NULL,
    scope_status TEXT NOT NULL DEFAULT 'UNKNOWN',
    scope_district TEXT,
    scope_taluka TEXT,
    scope_provenance TEXT NOT NULL DEFAULT 'scope.unclassified',
    source_listing_url TEXT NOT NULL,
    source_detail_url TEXT NOT NULL,
    observed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS source_evidence (
    id INTEGER PRIMARY KEY,
    tender_id TEXT NOT NULL,
    field_name TEXT NOT NULL,
    raw_value TEXT,
    source_page TEXT NOT NULL,
    extraction_method TEXT NOT NULL,
    observed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS extraction_runs (
    id INTEGER PRIMARY KEY,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    max_organisations INTEGER NOT NULL,
    max_pages_per_organisation INTEGER NOT NULL,
    max_details_per_organisation INTEGER NOT NULL,
    status TEXT NOT NULL,
    summary_json TEXT
);

CREATE TABLE IF NOT EXISTS run_organisations (
    run_id INTEGER NOT NULL REFERENCES extraction_runs(id),
    organisation_name TEXT NOT NULL,
    status TEXT NOT NULL,
    PRIMARY KEY (run_id, organisation_name)
);

CREATE TABLE IF NOT EXISTS listing_pages (
    id INTEGER PRIMARY KEY,
    run_id INTEGER NOT NULL REFERENCES extraction_runs(id),
    organisation_name TEXT NOT NULL,
    page_number INTEGER NOT NULL,
    source_url TEXT NOT NULL,
    tender_count INTEGER NOT NULL,
    page_fingerprint TEXT NOT NULL,
    next_url TEXT,
    observed_at TEXT NOT NULL,
    UNIQUE (run_id, organisation_name, page_number)
);

CREATE TABLE IF NOT EXISTS extraction_errors (
    id INTEGER PRIMARY KEY,
    run_id INTEGER NOT NULL REFERENCES extraction_runs(id),
    organisation_name TEXT,
    stage TEXT NOT NULL,
    message TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tender_occurrences (
    id INTEGER PRIMARY KEY,
    tender_id TEXT NOT NULL REFERENCES tenders(tender_id),
    search_taluka TEXT NOT NULL,
    source_listing_url TEXT NOT NULL,
    page_number INTEGER NOT NULL,
    observed_at TEXT NOT NULL,
    UNIQUE (tender_id, search_taluka, source_listing_url)
);
