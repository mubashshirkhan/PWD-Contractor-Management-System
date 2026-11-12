# MahaTenders local discovery prototype

This prototype is separate from the existing BuildTrack project area and uses only
Python's standard library. It follows public MahaTenders links while preserving the
HTTP cookie jar and server-generated `session`/`sp` parameters. It does not solve or
bypass CAPTCHA.

## Run complete district extraction

```powershell
python .\mahatenders_prototype\discover.py
```

The default command performs a sequential extraction across every organisation
returned by the portal, follows every available listing page, and requests every
unique tender detail link. It has no organisation, page, or detail-count cap.
Requests are delayed by one second by default. The run is not a guarantee that
the portal exposes every historical tender; it records every page and error
observed during the run.

1. Load the public "Tenders by Organisation" page.
2. Read all visible organisation rows.
3. Visit every generated listing page per organisation.
4. Follow every unique tender detail link per organisation.
5. Normalize explicit location fields, classify against all 22 Wardha/Amravati
   talukas, and write run metrics to:
   - `mahatenders_prototype\data\mahatenders.sqlite3`
   - `mahatenders_prototype\data\discovery_results.json`

All detail records are classified from tender-location evidence. `IN_SCOPE`
records are available to the scoped API; `UNKNOWN` and `OUT_OF_SCOPE` records
are retained for audit but are not returned by normal scoped API endpoints.
The prototype preserves generated session/Tapestry links, deduplicates tender
IDs across organisations and pages, records page/errors/timing metrics, and
stops the run when CAPTCHA, authentication, or anti-bot blocking is detected.
No bypass is attempted.

If the site changes, the command exits non-zero with a visible error. It never
turns a blocked or CAPTCHA page into an empty success result.

## Run the confirmed location-search workflow

The portal's confirmed location form uses a `POST` to
`https://mahatenders.gov.in/nicgep/app` with `component=TendersbyLocation`,
`page=FrontEndTendersByLocation`, `service=direct`, `session=T`, and a dynamic
`Location` value. The extractor first loads the form, carries its generated
hidden fields and cookie session, and then submits each of the 22 configured
canonical talukas:

```powershell
python .\mahatenders_prototype\discover.py --location-search `
  --database .\mahatenders_prototype\data\mahatenders.sqlite3 `
  --json .\mahatenders_prototype\data\location_discovery_results.json
```

Optional limits are available for an approved bounded test:

```powershell
python .\mahatenders_prototype\discover.py --location-search `
  --max-pages-per-taluka 1 --max-details 3
```

The workflow follows generated next-page links, records every listing occurrence
in `tender_occurrences`, deduplicates detail requests by tender ID, and stops
when CAPTCHA or anti-bot blocking is detected. CAPTCHA values are never
automated.

For an approved human-assisted bounded run, add `--human-captcha`:

```powershell
python .\mahatenders_prototype\discover.py --location-search `
  --taluka Arvi --human-captcha --max-pages-per-taluka 1 --max-details 3 `
  --json .\mahatenders_prototype\data\location_discovery_test.json
```

The client fetches the CAPTCHA image through its existing cookie session, opens
a local viewer in the normal browser, and waits for manual terminal input. The
answer is submitted through the same Python `CookieJar`; browser cookies and
security values are never exported or logged. A blank answer, expired session,
CAPTCHA response, or block stops the run visibly.

## Render deployment preparation

The backend can be started as a package without serving the separate testing UI:

```powershell
pip install -r .\mahatenders_prototype\requirements.txt
python -m mahatenders_prototype.api
```

The service binds to `0.0.0.0` and uses Render's `PORT` environment variable.
Set `MAHATENDERS_CORS_ORIGIN` to the exact deployed frontend origin. Optional
path variables are `MAHATENDERS_DATABASE`, `MAHATENDERS_LOCATION_DATABASE`, and
`MAHATENDERS_LOCATION_JSON`; they preserve the existing two-database layout.

SQLite files on a normal Render filesystem are not durable across service
restarts or redeploys. Use a persistent disk or move production storage to a
durable database before relying on live extraction results. In-memory
`LocationJobManager` state and its `CookieJar` also do not survive restarts or
multiple service instances, so CAPTCHA sessions require sticky single-instance
operation or a shared session store before production use.
