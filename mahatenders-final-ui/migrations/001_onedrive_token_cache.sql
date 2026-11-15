-- Isolated server-side MSAL cache storage. Does not touch main/location_ui.
-- Run as a Neon database owner/migration role.

BEGIN;

CREATE ROLE onedrive_cache_runtime NOLOGIN;
CREATE ROLE onedrive_cache_app LOGIN;

CREATE SCHEMA app_auth;

CREATE TABLE app_auth.msal_token_cache (
  session_key TEXT PRIMARY KEY
    CHECK (session_key ~ '^[a-f0-9]{64}$'),
  cache_ciphertext TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_accessed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT onedrive_cache_runtime TO onedrive_cache_app;
GRANT USAGE ON SCHEMA app_auth TO onedrive_cache_runtime;
GRANT SELECT, INSERT, UPDATE ON TABLE app_auth.msal_token_cache TO onedrive_cache_runtime;

COMMENT ON TABLE app_auth.msal_token_cache IS 'AES-256-GCM encrypted MSAL cache entries keyed by SHA-256 session ID digest.';

COMMIT;
