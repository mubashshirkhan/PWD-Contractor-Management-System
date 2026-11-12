# MahaTenders Custom API Development Test Results

## Phase 1 Scope

This report covers only the custom MahaTenders extraction API prototypes. No
BuildTrack website, frontend, or integration work was performed.

The requested directory name `api-anything-test/` does not exist in the
workspace. The available API Anything checkout is:

- [`api-anything-testing/`](./api-anything-testing/)

The existing Python prototype is:

- [`mahatenders_prototype/`](./mahatenders_prototype/)

No paid tender API was used. No CAPTCHA, authentication, or anti-bot restriction
was bypassed. The tests below use the previously captured bounded live results
and local artifacts; this phase review did not make a large request batch.

## Wardha/Amravati Scoped API Verification

**Status: WORKING for local database/API filtering; live scoped extraction NOT
TESTED**

The Python prototype now includes a separate read-only HTTP service at
[`mahatenders_prototype/api.py`](./mahatenders_prototype/api.py). API Anything
remains separate and is not used as a tender-data proxy.

Verified endpoints:

- `GET /health`
- `GET /api/v1/scope`
- `GET /api/v1/stats`
- `GET /api/v1/tenders`
- `GET /api/v1/tenders/{tender_id}`
- `GET /api/v1/organisations`

Server-side response filtering requires `scope_status = IN_SCOPE`, with district
classification restricted to Wardha or Amravati. `UNKNOWN` and `OUT_OF_SCOPE`
rows remain in SQLite for review but are excluded from normal API responses.
Filtering uses raw tender-location evidence; organisation names are not used to
infer location. The API accepts district/taluka/search query filters and
canonicalizes `Selu`/`Seloo`, `Karanja Ghadge`/`Karanja`, and `Tiwsa`/`Teosa`.

The configured scope contains 8 Wardha talukas and 14 Amravati talukas. Local
verification against the preserved database returned:

- 80 total unique tender rows preserved
- 11 `IN_SCOPE` rows exposed by `/api/v1/tenders`
- 10 Amravati rows and 1 Wardha row
- 69 `OUT_OF_SCOPE` rows retained but hidden from normal API responses
- `/api/v1/organisations`: 2 organisations associated with in-scope rows
- `OPTIONS /api/v1/tenders`: HTTP 204 with the explicit
  `http://127.0.0.1:5501` origin

The 11 in-scope rows are historical statewide-run records, not a new
Wardha/Amravati live extraction. Coverage of every taluka and statewide
availability is therefore **not claimed**. No records were deleted.

### Bounded live extraction verification

**Status: PARTIALLY WORKING**

The approved safety limits were reduced for this verification to one
organisation, one listing page, and one detail request. MahaTenders returned
182 organisations; the first selected organisation was
`Agriculture Marketing Board,Pune(Maharashtra)`. One listing page contained
four rows, and one real detail request succeeded. Its location was outside the
configured districts, so it was excluded:

- organisations processed: 1
- listing pages processed: 1
- detail requests completed: 1
- in-scope tenders added: 0
- out-of-scope tenders excluded: 1
- unknown-location tenders excluded: 0
- database after run: 80 total / 80 unique tenders

The result was written separately to
[`scoped_live_results.json`](./mahatenders_prototype/data/scoped_live_results.json);
the historical `discovery_results.json` was not overwritten. This verifies
server-side extraction exclusion for an out-of-scope live result, but does not
verify that every Wardha or Amravati taluka currently has available tenders.

## Status Summary

| Test area | Status | Verified result |
|---|---|---|
| 1. API Anything local functionality | **WORKING** | API Anything `0.4.0` installed, type-check passed, server health passed, bundled Hacker News call passed |
| 2. MahaTenders homepage access | **WORKING** | API Anything browser capture received the homepage with HTTP 200 |
| 3. Session and cookie management | **PARTIALLY WORKING** | Python has a cookie jar; API Anything capture can hold browser session state, but multi-page replay was not proven |
| 4. Organisation-tree discovery | **PARTIALLY WORKING** | Python can parse a table and find one exact name; it does not enumerate all organisations; API Anything navigation failed |
| 5. Multiple organisation listings | **FAILED** | No implementation or verified test across multiple organisations |
| 6. Individual tender details | **PARTIALLY WORKING** | Python retrieved one detail; API Anything retrieved none |
| 7. Tapestry pagination | **NOT TESTED** | No pagination implementation or verified page traversal |
| 8. Location extraction | **PARTIALLY WORKING** | One explicit `Nashik` location stored as a district candidate; no taluka/city resolution |
| 9. Maharashtra-wide organisation coverage | **FAILED** | Only one organisation persisted; statewide coverage is not evidenced |
| 10. SQLite persistence and duplicate prevention | **PARTIALLY WORKING** | SQLite persistence works; tender uniqueness exists, but source evidence duplicates on reruns |

## 1. API Anything Local Functionality

**Status: WORKING**

Verified in the isolated checkout:

- Node.js: `v22.16.0`
- npm: `11.4.1`
- API Anything: `0.4.0`
- `npm ci`: succeeded
- `npm run check`: succeeded
- CLI help: succeeded
- Local server on loopback: started successfully
- `GET /v1/health`: returned `{"ok":true,"version":"0.4.0"}`
- Bundled Hacker News operation: returned `ok: true`, `class: "ok"`,
  `tier: 1`, and real result records

The API Anything server was stopped after testing. No VS Code MCP configuration
was changed.

## 2. MahaTenders Homepage Access

**Status: WORKING**

API Anything captured:

`https://mahatenders.gov.in/nicgep/app`

Verified response facts:

- Main document HTTP status: `200`
- Response type: HTML
- Page title: `eProcurement System Government of Maharashtra`
- Capture observed 43 browser/network requests
- Homepage HTML contained the public **Tenders by Organisation** link

This proves homepage access only. It does not prove that all linked pages can be
retrieved.

The Python prototype also successfully loaded the homepage/organisation flow in
the previous bounded run.

## 3. Session and Cookie Management

**Status: PARTIALLY WORKING**

### Python prototype

[`discover.py`](./mahatenders_prototype/discover.py) creates a `CookieJar` and
uses `HTTPCookieProcessor`, so cookies can be carried across sequential HTTP
requests. It also reads generated organisation and tender URLs from HTML rather
than hardcoding their `session`/`sp` parameters.

The code does not persist cookies to disk and does not assert in a test that a
specific cookie was received and replayed.

### API Anything

API Anything's browser capture successfully loaded the homepage and retains
session state internally for a capture. However, the subsequent organisation
navigation failed with `page.goto: net::ERR_FAILED`, so successful cookie/session
continuity across the required Tapestry pages was not proven.

No cookie or token values are included in this report.

## 4. Organisation-Tree Discovery

**Status: PARTIALLY WORKING**

### Python result

The Python client:

- Requests the organisation table.
- Scans table rows.
- Requires an exact target name.
- Returns immediately on the first exact match.

It successfully found:

| Organisation | Tender count |
|---|---:|
| `Public Works Department Mantralaya` | `32` |

It does **not** return all organisation rows, persist the complete organisation
tree, or map the requested Arvi/Wardha departments.

### API Anything result

API Anything captured the homepage link but failed while navigating to:

`FrontEndTendersByOrganisation`

with browser error:

`page.goto: net::ERR_FAILED`

Therefore API Anything extracted no organisation names or counts.

### Coverage count

The actual persisted discovery count is:

- Organisations discovered and saved: **1**
- Complete organisation-tree total: **unknown**

The `32` value is the portal-reported count for one organisation, not a count of
organisations or retrieved tender records.

## 5. Multiple Organisation Listings

**Status: FAILED**

The current Python entry point accepts one target organisation and stops after
that organisation. It has no loop over all organisation rows and no batch
organisation input.

No second organisation was tested. No Zilla Parishad Wardha, Panchayat Samiti
Arvi, Municipal Council Arvi, Rural Development, Water Resources, or Water
Supply and Sanitation organisation was retrieved.

The current saved database contains only:

```text
Public Works Department Mantralaya
```

## 6. Individual Tender Details

**Status: PARTIALLY WORKING**

### Python prototype

The Python client successfully retrieved one listing and one detail page:

| Field | Verified value |
|---|---|
| Tender ID | `2026_PWDM_1353319_1` |
| Reference | `Notice No. 21/2026-27` |
| Title | `Est.No.2209/2026-27` |
| Location | `Nashik` |
| Estimated value | `28,82,333` |
| Product category | `Electrical Works` |
| Closing/submission end | `16-Nov-2026 03:00 PM` |

The parser checks that the detail-page tender ID matches the listing tender ID.

### API Anything

API Anything retrieved no organisation listing and therefore no tender detail.
The Python result must not be attributed to API Anything.

EMD and tender fee extraction are not implemented in the Python schema/result.

## 7. Tapestry Pagination

**Status: NOT TESTED**

No pagination method, next-page callback traversal, page cursor extraction, or
Tapestry DirectLink pagination result exists in the Python prototype.

API Anything did not reach a listing page, so it did not observe pagination.

The organisation-reported count of `32` must not be interpreted as 32 retrieved
tenders.

## 8. Location Extraction

**Status: PARTIALLY WORKING**

The Python detail parser reads the explicit `Location` label and stores:

- `location_raw`
- `location_district` as a district candidate
- `location_state`
- provenance
- confidence

Verified live result:

| Location field | Value |
|---|---|
| Raw location | `Nashik` |
| District candidate | `Nashik` |
| Taluka | `NULL` |
| City/village | `NULL` |
| State | `Maharashtra` |
| Provenance | `detail.location_explicit;district_candidate;state.portal_scope` |

There is no actual district/taluka/city filter or administrative-name lookup.
The implementation does not prove that `Nashik` is a city, taluka, or district
in every possible tender context; it stores it conservatively as a district
candidate.

If a successfully parsed detail has no `Location` label, the helper returns
missing provenance and null location fields, and the save path does not discard
the tender. That retention behavior is present in code but was not tested with a
live missing-location tender.

## 9. Maharashtra-Wide Organisation Coverage

**Status: FAILED**

Actual persisted coverage:

| Metric | Count |
|---|---:|
| Organisations | 1 |
| Tenders | 1 |
| Distinct district candidates | 1 (`Nashik`) |
| Distinct talukas | 0 |
| Arvi records | 0 verified |
| Wardha records | 0 verified |

The implementation cannot currently discover all Maharashtra organisations,
departments, districts, or talukas. It does not provide statewide ranking,
filtering, or batch ingestion.

No statewide coverage claim is made.

## 10. SQLite Persistence and Duplicate Prevention

**Status: PARTIALLY WORKING**

Read-only inspection of
[`mahatenders.sqlite3`](./mahatenders_prototype/data/mahatenders.sqlite3) found:

| Table | Rows |
|---|---:|
| `organisations` | 1 |
| `tenders` | 1 |
| `source_evidence` | 6 |

The schema has:

- `organisations.name UNIQUE`
- `tenders.tender_id UNIQUE`
- `INSERT OR REPLACE` for organisation and tender rows

Therefore, repeated saves for the same organisation/tender replace those core
rows. However, `source_evidence` has no uniqueness constraint and repeated runs
can append duplicate evidence rows. Full duplicate prevention is not working.

The JSON result at
[`verified_results.json`](./mahatenders_prototype/data/verified_results.json)
contains the same one-organisation/one-tender snapshot.

## Comparison: API Anything vs Python Prototype

| Capability | API Anything | Python prototype |
|---|---|---|
| Local installation/basic operation | **WORKING** | **WORKING** |
| MahaTenders homepage | **WORKING** | **WORKING in prior run** |
| Session/cookie continuity | **PARTIALLY WORKING** | **PARTIALLY WORKING** |
| Organisation discovery | **FAILED at navigation** | **PARTIALLY WORKING for one exact name** |
| Multiple organisations | **NOT TESTED after navigation failure** | **FAILED/not implemented** |
| Tender listing | **FAILED/not reached** | **PARTIALLY WORKING for first row** |
| Tender detail | **NOT TESTED/not reached** | **PARTIALLY WORKING for one tender** |
| Pagination | **NOT TESTED** | **NOT TESTED** |
| Location extraction | **NOT TESTED** | **PARTIALLY WORKING** |
| Maharashtra-wide coverage | **FAILED/unproven** | **FAILED** |
| SQLite persistence | **NOT TESTED for MahaTenders** | **PARTIALLY WORKING** |

## Errors and API Limitations

1. API Anything's browser navigation from the homepage to the organisation page
   failed with `net::ERR_FAILED`.
2. The API Anything catalog had no MahaTenders operation.
3. The Python client is hardcoded to one default target organisation unless its
   command-line argument is changed one run at a time.
4. The Python client returns only the first matching organisation and first
   parseable tender.
5. Pagination is absent.
6. Statewide organisation and district/taluka coverage is absent.
7. Location extraction is not a true filter or resolver.
8. Missing-location retention exists in code but lacks a live test record.
9. EMD and tender fee fields are absent.
10. Source evidence rows can duplicate on reruns.
11. No large request batch was made; broad coverage therefore remains untested.
12. CAPTCHA and anti-bot behavior was not bypassed; blocked pages must remain
    explicit failures.

## Overall Phase-1 Conclusion

The custom API is a **bounded proof of concept**, not a statewide Maharashtra
tender discovery API.

The only reliable end-to-end MahaTenders result currently comes from the Python
prototype for one organisation and one tender. API Anything is locally healthy
but has not completed the MahaTenders organisation/listing/detail workflow.

Statewide discovery is **not verified** and must not be claimed.

## Next Phase Requirements

Before any BuildTrack integration:

1. Implement all-organisation enumeration from the live organisation table.
2. Add bounded iteration across multiple organisations.
3. Implement Tapestry pagination and verify page-by-page results.
4. Add explicit district, taluka, city/village, department, closing-date, and
   value filters.
5. Preserve tenders with missing location and mark their provenance.
6. Add unique constraints or upsert keys for source evidence.
7. Verify Arvi, Wardha, nearby districts, and the remaining Maharashtra coverage
   with actual retrieved records.
8. Re-test API Anything only after its organisation navigation issue is resolved.

## Phase 2 Expansion and Bounded Live Test

This section records the implementation and the single approved live run
performed on 12-Nov-2026. API Anything and the Python prototype remained
separate. No BuildTrack or UI files were changed.

### API Anything result

**Status: PARTIALLY WORKING**

The earlier homepage-to-organisation browser navigation failure remains a
navigation-flow issue (`net::ERR_FAILED`). A supported direct API Anything
capture of the organisation URL was then tested:

```text
https://mahatenders.gov.in/nicgep/app?page=FrontEndTendersByOrganisation&service=page
HTTP 200
HTML response size: 252,504 bytes
Observed requests: 34
Capture ID: cmwd0ikry
```

This proves that API Anything can open the organisation page directly with its
browser/session capture functionality. It does not prove a reusable
MahaTenders API Anything operation, and no such operation was created or
claimed. No cookies, tokens, CAPTCHA, authentication, or anti-bot restriction
was exposed or bypassed.

### Python implementation result

**Status: WORKING within the approved bounded run**

The Python prototype now:

- Enumerates and deduplicates all parseable organisation rows.
- Preserves generated organisation count links and Tapestry parameters.
- Processes organisations sequentially.
- Parses all tender rows on each visited listing page.
- Follows dynamically generated detail links.
- Deduplicates tender IDs before detail requests.
- Detects repeated listing pages.
- Supports dynamic `Next` pagination links with a hard page cap.
- Records run, organisation, page, error, timing, and source URLs in SQLite.
- Retains missing locations with `missing` provenance.
- Keeps API Anything and Python execution independent.

The CLI hard-limits the first-run controls to:

```text
max organisations: 10
max pages per organisation: 3
max details per organisation: 10
```

### Database backup and preservation

Before schema migration, the database was backed up to:

[`mahatenders.sqlite3.pre-expansion-20261112.bak`](./mahatenders_prototype/data/mahatenders.sqlite3.pre-expansion-20261112.bak)

The backup was logically verified with:

```text
organisations: 1
tenders: 1
source_evidence: 6
preserved tender ID: 2026_PWDM_1353319_1
```

After migration and the live run, the original Nashik tender remains present.
Existing duplicate evidence groups were not deleted. New evidence inserts use a
non-destructive `NOT EXISTS` check rather than a unique-index migration.

### Automated test results

**Status: WORKING**

The final automated suite passed:

```text
6 tests passed
```

Covered behaviors include tender-ID parsing, labeled detail parsing, location
provenance, organisation-row enumeration and deduplication, listing-row and
next-page parsing, and new source-evidence deduplication.

### Live extraction result

**Status: WORKING for the bounded sample; statewide coverage not verified**

The single live command used the approved limits without increasing them:

```powershell
python .\mahatenders_prototype\discover.py `
  --max-organisations 10 --max-pages 3 --max-details 10 `
  --json .\mahatenders_prototype\data\discovery_results.json
```

Actual result:

| Metric | Actual result |
|---|---:|
| Organisation rows discovered | 182 |
| Organisations processed | 10 |
| Listing pages visited | 10 |
| Unique tender details retrieved | 79 |
| Detail requests completed successfully | 79 |
| Duplicate tender IDs prevented in this run | 0 |
| CAPTCHA/auth/anti-bot blocks | 0 |
| Request errors | 0 |
| Processing time | 49.324 seconds |
| Distinct location/district candidates | 36 |
| Arvi tenders verified | 0 |
| Wardha tenders verified | 1 |

The 10 processed organisations were:

1. Agriculture Marketing Board,Pune(Maharashtra)
2. Ahmednagar Municipal Corporation
3. Akola Municipal Corporation
4. Amravati Municipal Corporation
5. Aurangabad Smart City Development Corporation Limited Aurangabad
6. Bhiwandi Nizampur City Municipal Corporation
7. Brihanmumbai Electric Supply and Transport Undertaking
8. CE and CA CADA Aurangabad
9. CE (Electrical) Hydro Electric Projects Mumbai
10. CE (Mechanical) Water Resource Department Nashik

Every processed organisation exposed one listing page during this run; no
verified `Next` page was returned within the 3-page cap. Pagination code is
implemented and parser-tested, but multi-page live traversal is not yet
verified.

The one verified Wardha record was:

```text
Tender ID: 2026_WRDMN_1351001_1
Raw location: wardha
District candidate: wardha
Organisation chain: CE (Mechanical) Water Resource Department Nashik
Location provenance: detail.location_explicit;district_candidate;state.portal_scope
```

No Arvi record appeared in the first 10 organisations in source order. This is
not evidence that Arvi has no tenders; it only reflects the approved first-run
selection.

### Persisted totals after the live run

| Table | Rows |
|---|---:|
| `organisations` | 11 |
| `tenders` | 80 |
| `source_evidence` | 243 |
| `extraction_runs` | 1 |
| `run_organisations` | 10 |
| `listing_pages` | 10 |
| `extraction_errors` | 0 |

The 80 persisted tenders consist of the 79 newly retrieved detail records plus
the preserved original Nashik tender. The database enforces tender-ID
uniqueness through the existing `tenders.tender_id` constraint. Three duplicate
evidence groups predated this expansion and were intentionally preserved;
new rerun evidence is prevented by the application-level existence check.

### Current limitations

- The first live run processed only the first 10 organisations in portal order,
  not all 182 discovered rows.
- No Arvi tender was verified in this bounded selection.
- Only one listing page per processed organisation was returned in the live
  responses; multi-page live pagination remains unverified.
- Location values are explicit raw portal values stored conservatively as
  district candidates. Taluka and city/village resolution is not implemented.
- No statewide coverage claim is made.
- API Anything direct capture works for the organisation URL, but no reusable
  MahaTenders API Anything organisation/listing/detail operation is installed.
- Existing duplicate source-evidence rows remain because preserving all prior
  database data was required.
