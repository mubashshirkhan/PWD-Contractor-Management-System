# MahaTenders Wardha/Amravati Coverage Report

## 1. Inspection scope and safety

This report is based on existing local artifacts only. No live extraction was
run, no records were deleted or overwritten, no schema was changed, and
API Anything and BuildTrack were not modified.

Inspected:

- `mahatenders_prototype/discover.py`
- `mahatenders_prototype/scope.py`
- `mahatenders_prototype/api.py`
- `mahatenders_prototype/test_*.py`
- `mahatenders_prototype/data/mahatenders.sqlite3` in SQLite read-only mode
- persisted extraction JSON files
- `mahatenders-api-testing-ui/`
- `API_DEVELOPMENT_TEST_RESULTS.md`

## 2. Executive findings

| Metric | Verified value |
|---|---:|
| Configured talukas | 22 |
| SQLite tender rows | 80 |
| Unique tender IDs | 80 |
| Organisations in SQLite | 11 |
| `IN_SCOPE` tenders | 11 |
| `OUT_OF_SCOPE` tenders | 69 |
| `UNKNOWN` tenders | 0 |
| Persisted extraction runs | 2 |
| Organisations discovered in each run | 182 |
| Organisations processed | 10 in run 1; 1 in run 2 |
| Persisted listing pages | 11 |
| Persisted page numbers above 1 | 0 |
| Persisted extraction errors | 0 |
| Automated tests | 11 passed |

The database contains verified in-scope records for only two talukas:

- Amravati: 10
- Wardha: 1

The other 20 talukas have no stored in-scope tender records. This is an
extraction-coverage gap, not evidence that MahaTenders has no tenders in those
talukas.

## 3. Coverage matrix for all 22 talukas

The extractor stores pages by organisation, not by taluka. Consequently,
taluka-level search counts and organisation/page attribution cannot be derived
from the existing run metadata without inferring location from organisation
names. Such values are explicitly reported as **NOT RECORDED**.

| District | Taluka | Searches recorded | Organisations/pages attributable without inference | Tender records classified `IN_SCOPE` | Coverage status |
|---|---|---:|---|---:|---|
| Wardha | Wardha | NOT RECORDED | NOT ATTRIBUTABLE | 1 | PARTIALLY VERIFIED |
| Wardha | Seloo (Selu) | NOT RECORDED | NOT ATTRIBUTABLE | 0 | NOT VERIFIED |
| Wardha | Deoli | NOT RECORDED | NOT ATTRIBUTABLE | 0 | NOT VERIFIED |
| Wardha | Hinganghat | NOT RECORDED | NOT ATTRIBUTABLE | 0 | NOT VERIFIED |
| Wardha | Samudrapur | NOT RECORDED | NOT ATTRIBUTABLE | 0 | NOT VERIFIED |
| Wardha | Karanja (Karanja Ghadge) | NOT RECORDED | NOT ATTRIBUTABLE | 0 | NOT VERIFIED |
| Wardha | Arvi | NOT RECORDED | NOT ATTRIBUTABLE | 0 | NOT VERIFIED |
| Wardha | Ashti | NOT RECORDED | NOT ATTRIBUTABLE | 0 | NOT VERIFIED |
| Amravati | Amravati | NOT RECORDED | NOT ATTRIBUTABLE | 10 | PARTIALLY VERIFIED |
| Amravati | Bhatkuli | NOT RECORDED | NOT ATTRIBUTABLE | 0 | NOT VERIFIED |
| Amravati | Nandgaon Khandeshwar | NOT RECORDED | NOT ATTRIBUTABLE | 0 | NOT VERIFIED |
| Amravati | Daryapur | NOT RECORDED | NOT ATTRIBUTABLE | 0 | NOT VERIFIED |
| Amravati | Anjangaon Surji | NOT RECORDED | NOT ATTRIBUTABLE | 0 | NOT VERIFIED |
| Amravati | Achalpur | NOT RECORDED | NOT ATTRIBUTABLE | 0 | NOT VERIFIED |
| Amravati | Chandurbazar | NOT RECORDED | NOT ATTRIBUTABLE | 0 | NOT VERIFIED |
| Amravati | Chikhaldara | NOT RECORDED | NOT ATTRIBUTABLE | 0 | NOT VERIFIED |
| Amravati | Dharni | NOT RECORDED | NOT ATTRIBUTABLE | 0 | NOT VERIFIED |
| Amravati | Morshi | NOT RECORDED | NOT ATTRIBUTABLE | 0 | NOT VERIFIED |
| Amravati | Warud | NOT RECORDED | NOT ATTRIBUTABLE | 0 | NOT VERIFIED |
| Amravati | Chandur Railway | NOT RECORDED | NOT ATTRIBUTABLE | 0 | NOT VERIFIED |
| Amravati | Teosa (Tiwsa) | NOT RECORDED | NOT ATTRIBUTABLE | 0 | NOT VERIFIED |
| Amravati | Dhamangaon Railway | NOT RECORDED | NOT ATTRIBUTABLE | 0 | NOT VERIFIED |

## 4. Extraction-run evidence

### Run 1

Persisted output: `mahatenders_prototype/data/discovery_results.json`.

- Organisations discovered: 182
- Organisations processed: 10
- Configured maximum pages per organisation: 3
- Listing pages processed: 10
- Tender detail requests completed: 79
- Unique tenders persisted by that run: 79
- Duplicate listing IDs prevented during that run: 0
- Errors: none persisted
- All recorded listing pages were page 1

The first 10 organisations were processed in source order. The run was not a
Wardha/Amravati taluka search and cannot establish local coverage. Its stored
location candidates include many locations outside the configured scope.

### Run 2

Persisted output: `mahatenders_prototype/data/scoped_live_results.json`.

- Organisations discovered: 182
- Organisations processed: 1
- Listing pages processed: 1
- Listing rows on the page: 4
- Tender detail requests completed: 1
- In-scope tenders added: 0
- Out-of-scope tenders excluded: 1
- Unknown-location tenders excluded: 0
- Duplicate listing IDs prevented: 0
- Errors: none

This was the previously completed bounded live run. It is included as existing
evidence only; no live request was made for this report.

## 5. Pagination verification

### What is implemented

`discover.py`:

- Reads the generated next-page link from each listing response.
- Preserves the generated URL and session cookies.
- Limits traversal by `max_pages`.
- Fingerprints listing tender IDs.
- Stops on no next link or the same final URL.
- Raises an error when a repeated page fingerprint is detected.

The parser/unit test for extracting a next-page link passes.

### What is actually verified

The database contains 11 listing-page records. Every record has
`page_number = 1`; none has page number 2 or 3. Therefore:

- Pagination parsing: **WORKING in the unit test**
- Pagination across multiple live pages: **NOT VERIFIED**
- Pagination across multiple organisations: **NOT VERIFIED**
- All available listing pages processed: **NOT VERIFIED**

The configured limit of three pages is a ceiling, not evidence that three pages
were available or processed.

## 6. Tender detail, location and alias verification

Automated tests passed for:

- Tender ID parsing.
- Multiple listing-row parsing.
- Generated next-page URL parsing.
- Explicit raw-location classification.
- `Selu` -> `Seloo`.
- `Karanja Ghadge` -> `Karanja`.
- `Tiwsa` -> `Teosa`.
- District-only classification.
- Unknown and out-of-scope classification.
- Organisation-name non-inference.

The database contains 11 in-scope records, all classified from stored location
evidence. The current grouped counts are:

| District | Taluka | Count |
|---|---|---:|
| Amravati | Amravati | 10 |
| Wardha | Wardha | 1 |

No persisted tender currently has `scope_status = UNKNOWN`. This means the
existing records either had enough raw evidence for an in/out classification or
were classified outside the configured districts; it does not prove that future
detail pages will always contain usable location data.

## 7. Duplicate prevention and data preservation

SQLite read-only inspection verified:

- 80 tender rows.
- 80 distinct tender IDs.
- 11 organisations.
- 243 source-evidence rows.
- 0 duplicate IDs in the `tenders` table.
- 0 duplicate listing IDs prevented in the persisted run metrics.
- 0 persisted extraction errors.

There are repeated source-evidence groups for the original Nashik tender, while
the tender itself remains unique. This is evidence that tender-row
deduplication and source-evidence deduplication are separate concerns.

All 80 existing tender rows and all 11 organisations remain present. No
destructive operation was performed during this inspection.

## 8. Scoped API verification

The API implementation applies `scope_status = 'IN_SCOPE'` before serializing
tenders, details, statistics, and associated organisations. The automated API
tests passed for:

- Excluding out-of-scope tender rows.
- Rejecting detail lookup for an out-of-scope tender.
- Canonical taluka filtering.

The API is therefore verified by code and tests to expose only classified
in-scope rows. The API does not provide evidence of missing talukas; it can
only return records already persisted and classified.

Important limitation: the current API statistics and organisation endpoints
return all in-scope scope-wide counts. The dashboard filters the tender list by
district/taluka, but its organisation count and district summary are loaded
without applying the selected taluka filter. Those dashboard summary values can
therefore be broader than the currently selected tender table.

## 9. Dashboard accuracy

The dashboard is database/API-backed for tender rows and details:

- It calls the scoped Python API for health, stats, organisations, scope, and
  tenders.
- It does not embed the former Nashik tender snapshot.
- It supports Wardha/Amravati and taluka controls.
- Tender detail clicks call the scoped detail endpoint.
- API Anything is used only for its separate health check.

Verified limitation: the dashboard has no persisted coverage matrix and does
not show zero-result talukas as extraction gaps. Its organisation and summary
cards are not recalculated for the selected taluka. The dashboard should not
be treated as proof of all-22-taluka coverage.

## 10. Missing coverage and limitations

1. Twenty of 22 talukas have no verified in-scope tender record.
2. No taluka-specific search count is persisted.
3. Organisation processing was source-order bounded, not local-scope
   comprehensive.
4. No live listing page beyond page 1 is persisted.
5. Multi-page pagination is not live-verified.
6. No evidence proves that all available pages were processed.
7. No evidence proves that every relevant Wardha/Amravati organisation was
   processed.
8. A zero count cannot distinguish “no currently available tender” from “not
   searched” or “location not present in the tested detail rows”.
9. The historical implementation report contains older status statements and
   should not be used as the current 22-taluka coverage measurement.

## 11. Safest bounded follow-up strategy

This report does not execute the following strategy. It requires separate
approval:

1. Preserve the current database and write a fresh backup before any new run.
2. Select a small, explicitly recorded organisation batch rather than running
   statewide source-order extraction.
3. Keep the existing caps: at most 10 organisations, 3 listing pages per
   organisation, and 10 detail requests per organisation; process
   sequentially.
4. Persist a search/batch identifier, organisation, page number, next URL,
   listing-row count, detail outcome, raw location, scope classification, and
   failure reason for every operation.
5. Continue pages until the generated next link is absent, a repeated page is
   detected, the cap is reached, or a block/CAPTCHA response occurs.
6. Count a taluka only when explicit tender location evidence matches its
   canonical name or approved alias. Never infer location from organisation
   names.
7. Stop and report if MahaTenders blocks access or requires a security bypass.
8. Write each batch to a new JSON result file and compare database counts with
   the backup. Do not overwrite historical extraction outputs.

## 12. Overall assessment

The local scope classifier, scoped API filtering, parser tests, and database
deduplication are functioning as tested. Extraction coverage is incomplete and
not taluka-comprehensive. Pagination is implemented defensively but has not
been demonstrated across multiple live pages. The evidence supports only 11
verified in-scope tenders across two talukas, not complete Wardha and Amravati
coverage.
