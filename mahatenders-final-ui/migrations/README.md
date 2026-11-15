# OneDrive token cache database setup

The production Next.js runtime uses a dedicated Neon login role and only the
`app_auth.msal_token_cache` table. Operational records remain in OneDrive and
tender data remains in its existing schemas.

## Apply

1. Review `001_onedrive_token_cache.sql` and approve it before execution.
2. Apply it to the existing production `neondb` database as a Neon owner/migration
   role. The migration creates the `app_auth` schema, the cache table, and two
   roles: `onedrive_cache_app` (login) and `onedrive_cache_runtime` (NOLOGIN).
   The runtime role receives only schema USAGE and table SELECT/INSERT/UPDATE.
3. Configure the dedicated login password in Neon after applying the migration:
   - Open the Neon Console and select the existing project and production branch.
   - Under **Postgres database → Roles**, find `onedrive_cache_app` and choose
     **Reset password**. Neon generates the password; copy it directly into your
     password manager when the modal displays it. The migration intentionally
     contains no password.
   - Open **Connect** and select that same branch, database `neondb`, and role
     `onedrive_cache_app`. Turn **Connection pooling** on, then copy the resulting
     pooled connection string (its hostname has `-pooler`). Do not use the owner
     role's connection string.
   - If setting a self-generated password through `psql` instead, use its
     interactive `\password onedrive_cache_app` command so the password is
     prompted for and is not included in SQL history. Do not use a literal
     password in a SQL file, command argument, source file, or logs.
4. In Vercel, set server-only variables:
   - `ONEDRIVE_TOKEN_CACHE_DATABASE_URL`: pooled connection string for
     `onedrive_cache_app`. Add it in the Vercel project's **Settings → Environment
     Variables**, for the intended environments, with no `NEXT_PUBLIC_` prefix.
     Do not print or log the value; it contains the database password.
   - `ONEDRIVE_CACHE_ENCRYPTION_KEY`: output of `openssl rand -base64 32`.
     Add it in the same server-only Vercel settings. Keep the stable key in a
     secret manager and never expose it in browser code or build output.
   - Enable **Fluid Compute** for the Vercel project. New projects have it enabled
     by default; verify it for older projects. The server-side Neon pool is
     reused globally within each function instance, and Vercel's pool lifecycle
     helper lets idle clients expire before Fluid suspends that instance.
5. Keep the encryption key stable and back it up in the team's secret manager.
   Never put its value in `.env.example`, source control, or any `NEXT_PUBLIC_*` key.
6. Deploy the frontend after the migration and variables are configured. Run an
   authenticated OneDrive status check and verify an existing workbook can be
   read. This code does not migrate local development cache files into Neon;
   authenticate again once on the production deployment.

The migration does not modify `main`, `location_ui`, or any existing table or
record. It does not add a data-retention job. On disconnect the ciphertext is
cleared while a small null cache row remains as a concurrency-lock anchor. If
an entry has been idle for 30 days, its ciphertext is cleared the next time it
is accessed. A later cleanup job can remove old null rows if required.

During account switching, the newly authenticated session remains connected if
clearing the previous session cache fails. The frontend shows a safe warning;
the old encrypted cache entry may remain in the table until cache cleanup can be
retried or a separate retention cleanup is performed.

## Roll back

1. Disable OneDrive token-cache access by rolling back the frontend release or
   removing the new production environment variables.
2. If the login role has an active connection, wait for it to close.
3. Review and execute `001_onedrive_token_cache.rollback.sql` as a Neon owner.
   This drops only the isolated cache table/schema and the two dedicated roles.
4. Users will need to sign in to Microsoft again after rollback. OneDrive
   workbooks and tender data are unaffected.

Do not execute the rollback SQL while the production frontend still uses this
cache implementation.
