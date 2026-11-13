# Legacy frontend reference

This is the framework-free frontend for the PWD Contractor Management System.
It preserves the existing MahaTenders discovery, classification, detail,
organisation, location-search, and human-assisted CAPTCHA workflows while
providing a contractor workspace shell.

## Run locally

```powershell
python -m http.server 5500 --directory .\mahatenders-api-testing-ui
```

Open <http://127.0.0.1:5500/>. The production Python API is the default in the
connection settings, but the URL remains editable for local development.
API Anything is optional and is only used for its health check.

## Vercel settings

Create a Vercel project from this repository with:

- **Root directory:** `mahatenders-api-testing-ui`
- **Framework preset:** Other
- **Build command:** none
- **Output directory:** `.`
- **Install command:** none

The site is static and needs no environment variables. The API URL is a
visible, configurable field rather than a secret. Never put database
credentials, Neon connection strings, or Render secrets in this directory.

## Product boundary

Live sections are marked by verified API data and include tender discovery,
classification, tender details, organisation directory, statistics, and the
bounded location/CAPTCHA workflow. Contractor profile, documents, work orders,
project tracking, payments, reports, and user management are intentionally
labelled **PLANNED** until backend persistence and authentication exist. They
contain no fabricated business records.
