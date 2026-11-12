# MahaTenders API Testing Report

## 1. Executive Summary

**Review scope:** Previous MahaTenders Discovery Prototype task, reviewed from the
existing workspace files, generated SQLite/JSON artifacts, and the available prior
session transcript. No implementation was continued, no packages were installed,
and no new network request was made for this review.

The previous task successfully connected to MahaTenders and extracted one real
organisation and one real tender using a custom Python standard-library client.
The result is persisted in SQLite and JSON. The available evidence does **not**
show that the open-source API Anything project was installed, configured, or used.

Overall status:

| Area | Status | Evidence |
|---|---|---|
| Direct connection to MahaTenders | **Completed** | Prior run output and source URLs in JSON/database |
| Organisation name and count | **Completed for one organisation** | `Public Works Department Mantralaya`, count `32` |
| Tender listing | **Completed for one listing** | Tender ID `2026_PWDM_1353319_1` |
| Tender detail | **Completed for one tender** | Detail fields persisted in JSON/SQLite |
| SQLite persistence | **Completed** | One organisation, one tender, six evidence rows |
| API Anything installation/configuration | **Completed separately; MahaTenders flow unproven** | See [`API_ANYTHING_FEASIBILITY_REPORT.md`](./API_ANYTHING_FEASIBILITY_REPORT.md) |
| Session cookie handling | **Implemented in direct client; runtime cookie contents not evidenced** | `CookieJar` and `HTTPCookieProcessor` in `discover.py` |
| Dynamic Tapestry parameters | **Used for the tested flow** | Generated `session`/`sp` links persisted, redacted in this report |
| Pagination | **Not tested** | No pagination code or pagination result |
| Arvi/Wardha prioritisation | **Not implemented** | Only PWD Mantralaya was tested; returned tender location was Nashik |

### Current statewide-coverage verification

The current implementation and persisted results were rechecked without changing
the crawler or making a new live request:

| Requirement | Verified result |
|---|---|
| Organisations discovered | **1 persisted organisation**, not all available organisations |
| Tender listings retrieved | **1 persisted tender**, not all tenders for the organisation |
| Maharashtra districts verified | **1 district candidate: Nashik** |
| Maharashtra talukas verified | **0**; the stored taluka is `NULL` |
| Arvi verified | **No** |
| Wardha district verified | **No** |
| Missing-location retention | **Implemented in code but not exercised by a live missing-location record** |
| Statewide coverage | **Not verified and must not be claimed** |

The saved count of `32` is the count displayed for the tested organisation by
MahaTenders. It is not the number of tender records retrieved by this
implementation. The code returns immediately after the first exact organisation
match and after the first parseable tender row.

## 2. Installation Results

### API Anything

**Status: Installed and tested separately; not used by this Python client.**

API Anything is installed under the separate
[`api-anything-testing/`](./api-anything-testing/) directory. Its local health
check and bundled-operation test passed, but its MahaTenders organisation-page
navigation failed. Full results are in
[`API_ANYTHING_FEASIBILITY_REPORT.md`](./API_ANYTHING_FEASIBILITY_REPORT.md).

The implementation imports only Python standard-library modules such as
`sqlite3`, `urllib`, `html.parser`, `json`, and `dataclasses`. It does not import
or invoke API Anything.

### Python prototype

**Status: Completed.**

The direct prototype is documented as dependency-free in
[`mahatenders_prototype/README.md`](./mahatenders_prototype/README.md). The prior
task ran Python compilation, a live discovery command, and three focused unit
tests. No additional package installation was needed.

## 3. Files Created

Existing workspace files reviewed:

- [`mahatenders_prototype/discover.py`](./mahatenders_prototype/discover.py)
- [`mahatenders_prototype/schema.sql`](./mahatenders_prototype/schema.sql)
- [`mahatenders_prototype/README.md`](./mahatenders_prototype/README.md)
- [`mahatenders_prototype/test_discover.py`](./mahatenders_prototype/test_discover.py)
- [`mahatenders_prototype/data/mahatenders.sqlite3`](./mahatenders_prototype/data/mahatenders.sqlite3)
- [`mahatenders_prototype/data/verified_results.json`](./mahatenders_prototype/data/verified_results.json)

No API Anything-specific configuration files were found. No terminal log files,
HTML fixtures, captured browser snapshots, or raw HTTP response files were found
in the project workspace. The prior session transcript was available, but not a
standalone terminal log.

This report is the only file added by this review.

## 4. Implementation Completed

The direct client implements this bounded flow:

1. Request the public **Tenders by Organisation** page.
2. Locate the exact organisation name
   `Public Works Department Mantralaya`.
3. Read its numeric tender count and generated count link.
4. Follow the generated organisation link.
5. Parse the first tender row from the HTML table.
6. Follow the generated tender-detail link.
7. Parse labelled detail fields.
8. Normalize the location conservatively.
9. Persist the organisation, tender, and source evidence to SQLite and JSON.

Relevant implementation areas are in
[`discover.py`](./mahatenders_prototype/discover.py), including:

- `TableParser` for HTML table rows and links.
- `MahaTendersClient.discover_organisation`.
- `MahaTendersClient.first_tender`.
- `MahaTendersClient.tender_detail`.
- `save_results`.

The focused tests in
[`test_discover.py`](./mahatenders_prototype/test_discover.py) passed in the prior
task: **3 tests passed**.

## 5. MahaTenders Connection Test

**Status: Completed for the tested flow.**

The previous live run reached:

`https://mahatenders.gov.in/nicgep/app`

and then loaded the public organisation page at the
`FrontEndTendersByOrganisation` route. The generated JSON records the source page
and subsequent session-bound links. Dynamic `session`/`sp` values are intentionally
not reproduced here because they are session parameters.

The prior run returned successfully and printed a JSON object containing an
organisation and tender. This is corroborated by the persisted JSON and SQLite
records.

## 6. Organisation Discovery Results

**Status: Completed for one organisation; organisation-tree coverage incomplete.**

Actual extracted organisation:

| Field | Value |
|---|---|
| Organisation | `Public Works Department Mantralaya` |
| Tender count | `32` |
| Source | MahaTenders public organisation table |

The implementation scans the current table and requires an exact organisation
name match. It does not enumerate, classify, or persist the complete organisation
tree. In `discover_organisation`, the first exact match returns immediately;
there is no method that returns all organisation rows. It does not test the
requested organisations such as Zilla Parishad Wardha, Panchayat Samiti Arvi, or
Municipal Council Arvi.

The actual saved organisation count is therefore:

- Discovered/persisted by the script: **1**
- Available organisation rows proven from the saved result: **1**
- Complete organisation-tree total: **Unknown**

## 7. Tender Listing Results

**Status: Completed for one organisation and first listing.**

The first parsed listing contained:

| Field | Value |
|---|---|
| Tender ID | `2026_PWDM_1353319_1` |
| Published | `09-Nov-2026 03:00 PM` |
| Closing/listing closing | `16-Nov-2026 03:00 PM` |
| Opening | `17-Nov-2026 03:00 PM` |
| Title/reference text | `Est.No.2209/2026-27`, with `Notice No. 21/2026-27` and the tender ID |
| Organisation chain | Public Works Department Mantralaya → CE-Electrical PWD Mumbai → SE-Electrical Circle PWD Mumbai → EE-Electrical Division PWD Nashik |

Only the first parseable row is selected. There is no broad listing ingestion,
loop over all discovered organisations, deduplication workflow, or pagination
traversal. The actual saved tender count is **1**. The organisation-reported
count of `32` does not mean that 32 listings were retrieved.

## 8. Individual Tender Details Results

**Status: Completed for one tender.**

Actual extracted detail fields:

| Field | Value |
|---|---|
| Tender ID | `2026_PWDM_1353319_1` |
| Tender reference number | `Notice No. 21/2026-27` |
| Title | `Est.No.2209/2026-27` |
| Tender value | `28,82,333` |
| Product category | `Electrical Works` |
| Location raw | `Nashik` |
| State | `Maharashtra` |
| Location district field | `Nashik` as a district candidate |
| City/village | Not assigned |
| Taluka | Not assigned |
| Bid submission end | `16-Nov-2026 03:00 PM` |
| Bid opening date | `17-Nov-2026 03:00 PM` |

The detail parser verifies that the tender ID from the detail page matches the
listing tender ID before saving the record.

EMD amount and tender fee were not extracted into the schema or JSON result.

## 9. Session and Cookie Handling

### Cookies

**Status: Implemented, runtime persistence only indirectly evidenced.**

`discover.py` creates a `CookieJar` and installs it through
`HTTPCookieProcessor` in the opener. This is the correct standard-library pattern
for carrying cookies across the three sequential requests.

The project does not persist cookies to disk, expose cookie values, or assert in a
test that a specific cookie was received and replayed. Therefore, the code
supports cookie maintenance, but the available artifacts do not prove the exact
cookie exchange independently.

### Tapestry parameters

**Status: Used for the tested sequence.**

The organisation count link and tender detail link are read from the live HTML and
resolved with `urljoin`; they are not hardcoded in the source. This preserves the
server-generated `session` and `sp` query parameters for the immediate flow.

The persisted JSON/database contain these generated URLs. This report does not
repeat the parameter values.

### Security restrictions

No CAPTCHA was solved or bypassed. The implementation does not automate login,
bid submission, payment, DSC operations, or document submission.

## 10. Pagination Test

**Status: Not tested and not implemented.**

The previous run stopped after one tender as explicitly requested. There is no
pagination method, next-page traversal, page-count extraction, or test fixture for
Tapestry DirectLink pagination in the current prototype.

Consequently, the organisation count of `32` is an organisation-reported count,
not proof that all 32 tender records were retrieved.

## 11. SQLite Database Verification

**Status: Completed.**

The existing database was inspected read-only. It contains:

| Table | Rows |
|---|---:|
| `organisations` | 1 |
| `tenders` | 1 |
| `source_evidence` | 6 |

The organisation row is `Public Works Department Mantralaya` with count `32`.
The tender row is `2026_PWDM_1353319_1` with location `Nashik`, tender value
`28,82,333`, and product category `Electrical Works`.

The evidence table preserves raw values for location, tender value, and
organisation chain. The six rows reflect repeated evidence insertion from the
previous execution; the schema has no uniqueness constraint preventing duplicate
evidence rows on reruns.

## 12. Arvi and Wardha Location Handling

**Status: Not correctly implemented for the requested priority behavior.**

The code does not implement:

- Arvi-first ranking.
- Wardha district ranking.
- Nearby-district ranking.
- Maharashtra-wide fallback ranking.
- District, taluka, city/village, department, closing-date, or value filters.
- A location lookup or administrative-name normalization table.
- Organisation-tree matching for Wardha/Arvi organisations.

The tested tender is explicitly located as `Nashik`, not Arvi or Wardha. This is
useful evidence that the implementation did **not** incorrectly assume that a PWD
organisation name implies an Arvi location.

The current `location_fields` function stores the explicit location as a
district candidate, leaves city/village and taluka unset, and derives
`Maharashtra` from the portal scope. That is conservative, but it is not a
complete location resolver.

### Explicit filtering and missing locations

There is no query/filter implementation in the current client. The
`location_fields` helper only transforms one detail-page `Location` value into
stored fields; it does not search by district, taluka, city/village, or
department.

If a successfully parsed tender has no `Location` label, `location_fields(None)`
returns a `missing` provenance with null location fields, and `save_results`
does not reject that tender. Thus missing-location retention is **present as
code behavior**, but no live missing-location tender was retrieved and verified.

The only actual location result is:

- Raw/detail location: `Nashik`
- District candidate: `Nashik`
- Taluka: unset
- City/village: unset

No evidence supports Arvi, Wardha, or statewide district/taluka coverage.

## 13. Errors and Limitations

1. **API Anything is separate from this client.** Its local installation passed,
   but its MahaTenders organisation navigation failed; it is not a statewide
   discovery backend.
2. **No pagination.** Only one listing was retrieved.
3. **Single organisation.** The organisation tree was not fully investigated or
   persisted.
4. **No local-target search.** No Arvi or Wardha tender was tested.
5. **Incomplete field coverage.** EMD and tender fee are absent from the model and
   result.
6. **Location ambiguity.** A one-word location such as `Nashik` is stored as a
   district candidate, not proven city/taluka data.
7. **Parser fragility.** The parser relies on table cell order and exact labels;
   portal markup changes could break extraction.
8. **No response fixtures.** There are no checked-in raw HTML fixtures for
   reproducible offline parsing of the actual pages.
9. **No explicit cookie assertion.** Cookie handling is configured, but the run
   did not record a safe cookie-presence diagnostic.
10. **No rate limiting or retry policy.** The client makes a small bounded request
    sequence but does not implement a general crawler policy.
11. **Repeated evidence rows.** Reruns can add duplicate source-evidence records.
12. **No API/service layer.** The prototype is a command-line script, not a local
    API or user-facing search interface.
13. **No standalone terminal logs.** The prior session transcript records the
    successful command output, but the workspace contains no terminal log files.

## 14. Actual Data vs Mock Data

**Conclusion: The saved organisation and tender values are real extracted
MahaTenders data, not mock data.**

Evidence:

- The prior task’s live browser session reached the MahaTenders public pages.
- The persisted source URLs point to the MahaTenders domain.
- The output contains generated session-bound links rather than invented static
  detail URLs.
- The detail fields are internally consistent: the listing tender ID and detail
  tender ID match.
- The prior output and SQLite/JSON artifacts agree on the organisation, count,
  tender ID, dates, value, category, organisation chain, and location.

The records are a **single live snapshot** observed on
`2026-11-12T03:07:16.928213+00:00` as recorded in the JSON/database. They should
not be treated as current indefinitely.

## 15. Remaining Tasks

### Not completed from the approved plan

- Full organisation-tree investigation and actual-name mapping for local
  departments.
- SQLite schema support for a larger ingestion set and refresh history.
- Pagination and multi-tender ingestion.
- Arvi/Wardha/nearby/Maharashtra priority ranking.
- Requested filters.
- Broader location extraction from listing/detail text with provenance.
- Representative fixtures and more edge-case coverage.

### API Anything-specific status

- Installation, local health, and a bundled operation are verified separately.
- MahaTenders homepage capture succeeded, but organisation-page navigation failed
  with `net::ERR_FAILED`.
- No API Anything organisation, listing, or detail result should be counted as
  part of this Python prototype's coverage.

## 16. Overall Feasibility Assessment

**Direct HTML extraction feasibility: Promising for a bounded, read-only flow.**

The tested sequence demonstrates that public server-rendered pages, generated
Tapestry links, organisation counts, listing rows, and tender detail fields can be
retrieved with a small standard-library client when the relevant pages are
available without an interaction CAPTCHA.

**API Anything feasibility: Undetermined.**

There is no installation or runtime evidence, so this review cannot conclude
whether API Anything can reproduce the working flow.

**Production discovery readiness: Not ready.**

The current prototype is a proof of concept for one organisation and one tender.
Pagination, robust parsing, local prioritisation, filters, refresh behavior,
rate-limited operation, and broader location validation are still required.

## 17. Recommended Next Steps

1. Separately install and verify API Anything according to its official
   documentation, recording only non-sensitive status output.
2. Add safe, offline HTML fixtures from permitted public responses and test
   organisation/listing/detail parsing against them.
3. Implement Tapestry pagination and verify that each page uses fresh generated
   links within the same cookie session.
4. Enumerate the complete organisation table and map actual names for PWD, Zilla
   Parishad Wardha, Panchayat Samiti Arvi, Municipal Council Arvi, Rural
   Development, Water Resources, and Water Supply and Sanitation.
5. Add location evidence records that distinguish explicit location, parsed
   district, inferred administrative levels, and confidence.
6. Implement ranking in the order Arvi, Wardha district, nearby districts, then
   the rest of Maharashtra, while retaining all records.
7. Add filters for district, taluka, city/village, department, closing date, and
   estimated value.
8. Add deduplication/refresh semantics for source evidence and tender snapshots.
9. Keep CAPTCHA and anti-bot handling explicit: stop and report when a required
   page is blocked; do not bypass it.
