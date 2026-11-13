# OneDrive connection setup

## Current deployment findings

The frontend repository documents Vercel as its Next.js deployment target, but this checkout has no Vercel project link or deployment configuration that confirms an active frontend deployment. `render.yaml` configures only the Python API. The production frontend host therefore still needs confirmation.

The existing `Arch Design Studio` folder is in personal OneDrive. The integration uses the Microsoft consumer identity authority and Graph `driveItem` content endpoints. It does not use the Graph Excel workbook REST API, which is unsupported for OneDrive Consumer. Workbook files will be edited server-side and uploaded using the observed eTag as `If-Match`; a 412 response will be treated as a conflict and will not overwrite newer content.

## Entra application registration

Register an application that supports personal Microsoft accounts. Add a **Web** redirect URI for local development:

`http://localhost:3001/api/onedrive/auth/callback`

The frontend deployment's exact HTTPS callback URI must be added after its production host is confirmed. Grant delegated `Files.ReadWrite` permission. The application requests `openid`, `profile`, `offline_access`, and `Files.ReadWrite` through the `consumers` authority.

Copy `.env.example` to `.env.local` and enter the client ID, client secret, redirect URI, and a fresh random session secret of at least 32 characters. Keep the secret server-side. `.env*` is ignored by Git; do not add these values to `NEXT_PUBLIC_*` variables or commit them.

## Token cache

Local development currently uses an in-memory MSAL cache. Restarting Next.js loses it and requires sign-in again. Production sign-in deliberately fails closed until an encrypted persistent cache is configured.

If Vercel is the confirmed frontend host, the recommended compatible cache is Upstash Redis provisioned through Vercel Marketplace. Store each serialized MSAL cache under an opaque user/session key, encrypt the serialized value with application-side AES-256-GCM before Redis, use TLS, and set a bounded retention/expiration policy. Keep the encryption key in the host's server-only environment secrets. Redis access credentials and cached tokens must never reach client code. This is a proposed architecture only: no Redis service, database, Vercel project, or credentials have been provisioned.

Please confirm the actual frontend deployment platform and approve adding Upstash Redis plus the encrypted production cache adapter before that service is introduced. If the frontend is hosted elsewhere, choose a persistent encrypted cache supported by that host instead.

## Connection and verification status

The routes are `/api/onedrive/auth/start`, `/api/onedrive/auth/callback`, `/api/onedrive/status`, and `/api/onedrive/disconnect`. The status endpoint returns only a connection state and drive type; it does not return tokens, account identifiers, or drive IDs. The OAuth transaction is encrypted in a short-lived HttpOnly cookie, and the session identifier is HttpOnly. The access token stays in the server-side MSAL cache.

Do not perform a file write as part of connection verification. A separate test workbook must be approved before any write test. The approved test must use a new, dedicated test file and must not modify an existing workbook.
