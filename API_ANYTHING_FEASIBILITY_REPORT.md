# API Anything Feasibility Report

## 1. Executive Summary

API Anything was independently installed in the separate
[`api-anything-testing/`](./api-anything-testing/) directory from the official
GitHub repository. The checkout installed successfully as version `0.4.0`;
Node.js `v22.16.0` satisfied the documented minimum of `22.13`.

The local API Anything server started successfully on loopback and its unauthenticated
health endpoint returned `{"ok":true,"version":"0.4.0"}`. A bundled Hacker News
operation also returned real data, proving basic API Anything functionality.

MahaTenders testing was only partially successful:

- The MahaTenders homepage loaded through API Anything's browser capture with HTTP
  status `200`.
- The homepage capture contained the public **Tenders by Organisation** link.
- Following that link from API Anything's browser failed with
  `page.goto: net::ERR_FAILED`.
- No MahaTenders API Anything operation was created or installed.
- No organisation count, tender listing, or tender detail was retrieved through
  API Anything.
- No CAPTCHA was bypassed and no authentication or security restriction was
  circumvented.

The existing Python prototype remains the only implementation that successfully
retrieved one organisation and one tender. API Anything is therefore **feasible
for local installation and basic operation**, but **not yet proven feasible for
the MahaTenders multi-step Tapestry flow**.

## 2. Official Documentation Reviewed

The following official sources were reviewed before installation:

- [API Anything repository](https://github.com/goodnight000/api-anything)
- [Official installation instructions](https://raw.githubusercontent.com/goodnight000/api-anything/main/INSTALL.md)
- [Official quick start](https://raw.githubusercontent.com/goodnight000/api-anything/main/docs/QUICKSTART.md)
- [Official HTTP server documentation](https://raw.githubusercontent.com/goodnight000/api-anything/main/docs/SERVE.md)
- [Official package manifest](https://raw.githubusercontent.com/goodnight000/api-anything/main/package.json)

Relevant documented behavior:

- Node.js `>=22.13.0`.
- `npx -y api-anything setup` is the documented agent setup path.
- `api-anything serve` exposes a loopback HTTP server with `/v1/health`.
- API Anything learns operations from browser traffic and can retain cookie
  references without exposing cookie values.
- Browser capture can be run with `--write` to stop non-GET state-changing
  requests before they leave the browser.
- CAPTCHA challenges are reported as blocked; the documentation does not support
  bypassing them.

## 3. Installation Results

### Prerequisites

| Tool | Observed version | Result |
|---|---:|---|
| Node.js | `v22.16.0` | Passed; above required `v22.13.0` |
| npm | `11.4.1` | Passed |
| Git | `2.47.0.windows.2` | Passed |

### Installation method

The repository was cloned and installed only in:

[`api-anything-testing/source/`](./api-anything-testing/source/)

Command used:

```powershell
git clone --depth 1 https://github.com/goodnight000/api-anything.git api-anything-testing\source
Set-Location api-anything-testing\source
npm ci --no-audit --no-fund
```

Installation result:

```text
added 169 packages in 14s
api-anything@0.4.0 prepare
tsc -p tsconfig.build.json
```

`npm run check` also passed from the checkout.

No files in `mahatenders_prototype/` or the existing BuildTrack project were
modified. No global installation was performed.

### Sharing and configuration

The isolated server used an `API_ANYTHING_HOME` under
`api-anything-testing/runtime/`. This kept runtime state separate from the
existing project and user-level API Anything state.

No VS Code MCP configuration was changed. No shared-catalog setup was performed,
and no credentials, cookies, or tokens are included in this report.

## 4. Local Server and Basic Functionality

### CLI

`node dist/cli.js --help` started successfully and displayed the API Anything
commands, including `capture`, `learn`, `add`, `call`, `serve`, `mcp`, and
`check`.

### Server

The isolated server started successfully with:

```powershell
node dist/cli.js serve --port 8787
```

It reported version `0.4.0` and a loopback URL at
`http://127.0.0.1:8787`. The generated token file was kept private and is not
reproduced here.

Health test:

```text
GET /v1/health
{"ok":true,"version":"0.4.0"}
```

The server was stopped after testing.

### Bundled operation

The control test:

```powershell
node dist/cli.js call hacker-news search query=sqlite
```

returned `ok: true`, `class: "ok"`, `tier: 1`, and a list of real Hacker News
results. This confirms that the installed CLI, operation registry, plain HTTP
calling path, and JSON result path work independently of MahaTenders.

## 5. MahaTenders Homepage Test

Target:

`https://mahatenders.gov.in/nicgep/app`

API Anything command:

```powershell
node dist/cli.js capture https://mahatenders.gov.in/nicgep/app --outline --write
```

Result:

- Capture completed.
- Final URL remained the MahaTenders homepage.
- `43` requests were observed.
- The main document returned HTTP `200`.
- The captured response type was HTML.
- The response title was `eProcurement System Government of Maharashtra`.
- The HTML contained the public link titled **Tenders by Organisation** with the
  expected `FrontEndTendersByOrganisation` route.

This proves that API Anything can open and observe the public MahaTenders
homepage in its browser capture environment.

The `--write` flag was used. No state-changing request was intentionally sent.

## 6. API Anything Site and Operation Discovery

The local installed-site listing contained the bundled API Anything sites, but no
`mahatenders.gov.in` site.

A direct operation lookup returned:

```text
{"ok":false,"error":"no site \"mahatenders.gov.in\""}
next: api-anything search mahatenders.gov.in finds a shared spec to pull; else api-anything capture and add learn it
```

The catalog search for `mahatenders.gov.in` returned no match. Therefore, there
was no existing shared MahaTenders operation to call.

## 7. Organisation-Tree Navigation Test

### Attempted browser navigation

The public homepage link was clicked using API Anything capture steps. The
capture observed an attempted document request for the organisation page:

`/nicgep/app?page=FrontEndTendersByOrganisation&service=page`

However, the browser navigation failed with:

```text
page.goto: net::ERR_FAILED
```

The capture ended at `chrome-error://chromewebdata/`, and the attempted
organisation document did not provide a usable successful response.

A direct `goto` step to the same organisation URL also failed with the same
browser navigation error.

### Result

| Operation | Status |
|---|---|
| Homepage load | Completed |
| Locate public organisation link in homepage | Completed |
| Navigate to organisation page in API Anything browser | Failed |
| Read organisation table | Not completed through API Anything |
| Extract organisation names | Not completed through API Anything |
| Extract tender counts | Not completed through API Anything |

This is a genuine failed test, not a successful extraction inferred from the
Python prototype.

## 8. Organisation Tender Listing Test

**Status: Not completed through API Anything.**

Because the organisation page navigation did not produce a usable response, API
Anything did not obtain the generated organisation count link or its
session-dependent parameters. It therefore did not retrieve a tender listing.

The previous Python prototype independently retrieved:

- Organisation: `Public Works Department Mantralaya`
- Organisation-reported tender count: `32`
- One listing: tender ID `2026_PWDM_1353319_1`

Those values are not API Anything results and are not counted as such here.

## 9. Individual Tender Detail Test

**Status: Not completed through API Anything.**

No API Anything organisation listing was available from which to obtain a
generated tender detail link. Consequently, no individual tender detail was
opened or parsed by API Anything.

The existing Python prototype did retrieve the following real detail separately:

- Tender ID: `2026_PWDM_1353319_1`
- Reference: `Notice No. 21/2026-27`
- Title: `Est.No.2209/2026-27`
- Location: `Nashik`
- Tender value: `28,82,333`
- Product category: `Electrical Works`

These are comparison data only, not API Anything output.

## 10. Session, Cookies, and Tapestry Parameters

### Session establishment

The initial API Anything browser capture successfully loaded the homepage and
observed its requests. This demonstrates browser-level access, but does not by
itself prove that a MahaTenders session was successfully replayed across the
organisation and tender-detail sequence.

The subsequent organisation-page navigation failed before a successful page
response was available. Therefore, session continuity across the required
multi-step flow is **not proven**.

### Cookies

API Anything's official documentation states that captures hold cookie values and
that reusable specifications retain cookie references rather than cookie values.
The test did not expose or log cookie contents.

Because the organization navigation failed, there is no verified API Anything
result showing that a session cookie was replayed successfully for a
session-dependent Tapestry callback.

### Dynamic Tapestry parameters

The homepage HTML exposed the ordinary organisation-page route. The required
organisation count and tender-detail links contain server-generated,
session-dependent parameters in the working Python flow.

API Anything did not reach a successful organisation page response, so it did not
extract or replay the generated organisation/tender `session`/`sp` parameters.
No such values are reproduced in this report.

## 11. CAPTCHA, Authentication, and Anti-Bot Restrictions

No CAPTCHA was solved or bypassed. No login, payment, DSC, bid submission, or
other protected action was attempted.

The API Anything homepage capture did not report a CAPTCHA challenge. The
organisation navigation failed with a browser `net::ERR_FAILED`; the available
output does not identify this as CAPTCHA or prove an anti-bot block.

The correct conclusion is:

- CAPTCHA did not prevent the tested homepage capture.
- The organisation navigation failed.
- The cause is **unresolved** from the available API Anything output.
- No security restriction was bypassed.

## 12. Pagination Test

**Status: Not tested through API Anything.**

No organisation listing was successfully loaded, so no Tapestry DirectLink
pagination callback, page parameter, next-page request, or complete result set was
observed.

The previous Python prototype also stopped after the first tender and did not
implement pagination. The organisation count of `32` remains only a portal
reported count, not proof that 32 records were retrieved.

## 13. Comparison with the Python Prototype

| Capability | API Anything test | Existing Python prototype |
|---|---|---|
| Separate installation | Installed `0.4.0` in testing directory | Not applicable |
| Local health/basic operation | Passed | Not applicable |
| MahaTenders homepage | Loaded with HTTP `200` capture | Loaded |
| Cookie/session infrastructure | Browser capture exists; replay not proven | `CookieJar` + `HTTPCookieProcessor` implemented |
| Organisation page | Failed with browser `net::ERR_FAILED` | Loaded successfully |
| Organisation name | Not extracted | `Public Works Department Mantralaya` |
| Organisation tender count | Not extracted | `32` |
| Tender listing | Not extracted | `2026_PWDM_1353319_1` |
| Tender detail | Not extracted | Nashik, ₹28,82,333, Electrical Works |
| Dynamic `session`/`sp` link use | Not reached | Read from HTML and followed |
| Pagination | Not tested | Not implemented |
| CAPTCHA bypass | Not attempted | Not attempted |

The Python prototype currently has the stronger MahaTenders result. API Anything
has the stronger general-purpose platform result because installation, health,
capture, and a bundled operation were independently verified.

## 14. Errors and Limitations

1. The first verification commands were accidentally run from the project root,
   not the checkout, causing `ENOENT`/module-not-found errors. The commands were
   rerun from the correct checkout and passed.
2. Direct API Anything browser navigation to the organisation page failed with
   `net::ERR_FAILED`.
3. The failure cause was not identified as CAPTCHA, authentication, or a specific
   HTTP status.
4. No MahaTenders API Anything operation was learned or saved.
5. No organisation, listing, or tender detail data came from API Anything.
6. API Anything's browser capture retained sensitive session state internally;
   this report does not expose it. The temporary capture/runtime state should be
   treated as sensitive and removed or protected when testing is finished.
7. No pagination behavior was observed.
8. No Arvi/Wardha organisation or tender was tested through API Anything.
9. No BuildTrack integration was attempted.

## 15. Remaining Tasks

### API Anything-specific

- Determine why API Anything's browser cannot navigate from the homepage to the
  organisation page while the existing browser tooling and Python client can.
- Re-test using a compliant same-session navigation method, without bypassing
  CAPTCHA or anti-bot controls.
- If the page becomes accessible, capture the organisation table and generated
  count link.
- Verify whether API Anything can carry the Tapestry session across the count and
  tender-detail callbacks.
- Learn only read operations and validate them with a different organisation or
  tender input where the site permits.
- Test pagination only after one listing is successfully captured.

### Data/product-specific

- Map actual PWD, Wardha, Arvi, Rural Development, Water Resources, and Water
  Supply and Sanitation organisation names.
- Add location-aware ranking and filters in the separate discovery prototype.
- Keep API Anything results separate from the Python SQLite snapshot until
  equivalence is demonstrated.

## 16. Overall Feasibility Assessment

### API Anything platform

**Feasible.** Installation, type-checking, CLI startup, local server startup,
health endpoint, bundled operation calling, and browser capture all worked.

### MahaTenders homepage

**Feasible in the tested environment.** API Anything captured the homepage and
observed its server-rendered HTML and asset requests.

### MahaTenders organisation/listing/detail workflow

**Unproven and currently blocked at organisation navigation.** The required
stateful Tapestry flow was not completed by API Anything, and no data should be
claimed beyond the successful homepage capture.

### Replacement of the Python prototype

**Not justified.** The Python prototype remains the only tested implementation
that successfully followed the generated organisation and tender links and
persisted real tender data.

## 17. Recommended Next Steps

1. Preserve the current API Anything failure as a reproducible test case and
   inspect only non-sensitive browser/navigation diagnostics.
2. Try a compliant API Anything capture that starts at the organisation route
   only if the site permits it; do not inject cookies or hardcode expired
   Tapestry parameters.
3. If direct browser navigation continues to fail, test whether API Anything can
   learn a read-only homepage operation only, and document that as a partial
   integration rather than a tender extractor.
4. Do not mark organisation/listing/detail extraction as working until API
   Anything itself produces those records.
5. Keep the existing Python adapter as the verified fallback and do not integrate
   either prototype into BuildTrack yet.
