-- Roll back only after the frontend no longer uses the persistent cache.
-- Dropping the table removes MSAL cache entries and requires Microsoft sign-in again.

BEGIN;

REVOKE SELECT, INSERT, UPDATE ON TABLE app_auth.msal_token_cache FROM onedrive_cache_runtime;
REVOKE USAGE ON SCHEMA app_auth FROM onedrive_cache_runtime;
REVOKE onedrive_cache_runtime FROM onedrive_cache_app;

DROP TABLE app_auth.msal_token_cache;
DROP SCHEMA app_auth;
DROP ROLE onedrive_cache_app;
DROP ROLE onedrive_cache_runtime;

COMMIT;
