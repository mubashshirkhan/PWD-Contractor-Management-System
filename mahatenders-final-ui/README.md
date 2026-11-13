# Arch Design Studio UI

Next.js App Router frontend for Arch Design Studio's project operations.

## Local development

```powershell
Set-Location .\mahatenders-final-ui
Copy-Item .env.example .env.local
npm install
npm run dev
```

Open <http://localhost:3000>.

`NEXT_PUBLIC_API_BASE_URL` defaults to
`https://mahatenders-backend.onrender.com`. Set it in `.env.local` to use a
different API during development. Do not put database credentials or private
connection strings in this variable.

## Vercel

- Root directory: `mahatenders-final-ui`
- Framework preset: Next.js
- Build command: `npm run build`
- Install command: `npm install`
- Output directory: `.next`
- Environment variable: `NEXT_PUBLIC_API_BASE_URL`

## Routes

Live API-backed routes:

- `/tender-search`
- `/tenders` (internal tender register route)
- `/tenders/[tenderId]`

Work orders, projects, payments, reports, and users routes are intentionally
marked as planned until backend persistence
and authentication exist.

## Legacy reference

The original static implementation is preserved in
`legacy-static/`. It remains available for comparison and for any workflow
details that still need to be migrated. The Python backend and Neon database
were not modified.
