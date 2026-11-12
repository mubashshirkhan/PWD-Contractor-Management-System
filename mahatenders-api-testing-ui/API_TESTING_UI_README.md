# MahaTenders API Testing UI

Temporary, framework-free dashboard for testing the existing MahaTenders
prototypes. It is intentionally separate from:

- `mahatenders_prototype/`
- `api-anything-testing/`
- BuildTrack

The UI does not merge the prototypes and does not invent statewide results. The
organisation and tender tables display the one verified snapshot already saved
by the Python prototype:

- Organisation: `Public Works Department Mantralaya`
- Portal-reported organisation count: `32`
- Retrieved tender records: `1`
- Location: `Nashik` district candidate

## Run the API Anything service

From PowerShell:

```powershell
$env:API_ANYTHING_HOME = "$PWD\api-anything-testing\runtime"
Set-Location .\api-anything-testing\source
node dist\cli.js serve --port 8787 --cors http://127.0.0.1:5500 --cors http://localhost:5500
```

The UI only calls the unauthenticated `GET /v1/health` endpoint. It never reads
or displays the API Anything bearer token.

## Run the UI

In a second PowerShell window:

```powershell
python -m http.server 5500 --directory .\mahatenders-api-testing-ui
```

Open:

<http://127.0.0.1:5500/>

The API Anything base URL can be changed in the dashboard. If the service is
not running, the health test reports `FAILED` with the browser error.

## What is and is not live

### Live local check

- API Anything health: calls the real local `/v1/health` endpoint.

### Displayed verified snapshot

- Organisation explorer: data from
  `mahatenders_prototype\data\verified_results.json` and SQLite.
- Tender explorer and detail panel: the same verified Python snapshot.

### Explicitly unavailable

- Python HTTP health/check: no Python HTTP server exists.
- Python organisation/listing/detail HTTP operations: no endpoints exist.
- API Anything MahaTenders organisation/listing/detail operations: no operation
  is installed; previous organisation navigation failed with
  `net::ERR_FAILED`.
- Pagination: not implemented/tested.
- Maharashtra-wide discovery: not verified.

The public MahaTenders homepage button opens the verified public URL in a new
tab. It does not automate CAPTCHA, authentication, tender submission, payment,
or DSC actions.
