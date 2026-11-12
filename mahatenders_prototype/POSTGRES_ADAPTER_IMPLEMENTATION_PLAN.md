# PostgreSQL Adapter Implementation Plan

## Status

This is an implementation plan only. No Python code, dependency manifest,
SQLite database, migration, SQL statement, Neon resource, or testing UI has
been modified or executed.

The target is one Neon PostgreSQL database with two independent schemas:

- `main`: the existing `mahatenders.sqlite3` dataset.
- `location_ui`: the existing `location_ui_test.sqlite3` dataset.

All SQL used by the adapter must be explicitly schema-qualified. The adapter
must not rely on an implicit `search_path` to distinguish the two datasets.

The reviewed schema and data migration design are documented in:

- [`postgres_schema.sql`](./postgres_schema.sql)
- [`POSTGRES_MIGRATION_PLAN.md`](./POSTGRES_MIGRATION_PLAN.md)

## Existing behavior that must remain unchanged

The database migration is an infrastructure substitution only. It must not
change:

- MahaTenders HTTP communication.
- `CookieJar` ownership or session cookies.
- Dynamic Tapestry form fields and generated parameters.
- Human-assisted CAPTCHA handling.
- Generated Next-link pagination and repeated-page detection.
- Tender detail parsing and section separation.
- Evidence sanitization and sensitive-URL redaction.
- Wardha/Amravati classification and all 22 taluka aliases.
- API endpoint paths, status codes, or JSON response shapes.
- Existing testing-dashboard behavior.

PostgreSQL does not provide CAPTCHA/session persistence automatically. The
current in-memory `LocationJobManager`, `LocationJob`, and client `CookieJar`
remain a separate deployment concern.

## SQLite-specific inventory

### `discover.py`

#### `DiscoveryStore.__init__`

Current behavior:

- Opens `sqlite3.connect(database)`.
- Enables foreign keys with `PRAGMA foreign_keys = ON`.
- Executes `schema.sql` with `executescript`.
- Inspects `PRAGMA table_info(tenders)`.
- Adds missing scope columns at runtime.
- Reclassifies existing tender rows during startup.

PostgreSQL replacement:

- Open a pooled PostgreSQL connection through the adapter.
- Do not create or alter production tables from `DiscoveryStore`.
- Move schema changes to the PostgreSQL migration runner.
- Remove runtime `table_info`/scope-column mutation from the PostgreSQL path.
- Keep any required classification backfill as an explicit, reviewed migration.

The SQLite implementation must remain available during the transition for
regression testing and rollback.

#### `DiscoveryStore.start_run`

Current behavior:

- Uses `?` parameters.
- Reads `cursor.lastrowid`.
- Commits explicitly.

PostgreSQL replacement:

```sql
INSERT INTO main.extraction_runs (...)
VALUES (%s, ...)
RETURNING id
```

Read the returned `id` from the cursor. Do not rely on a process-global
sequence or client-generated integer.

#### `DiscoveryStore.save_organisation`

Current behavior:

- Uses `ON CONFLICT(name) DO UPDATE`.
- Uses `INSERT OR IGNORE` for `run_organisations`.
- Commits both operations together.

PostgreSQL replacement:

- Keep `ON CONFLICT (name) DO UPDATE`.
- Replace `INSERT OR IGNORE` with:

```sql
ON CONFLICT (run_id, organisation_name) DO NOTHING
```

- Keep both operations in one transaction.

#### `DiscoveryStore.save_page`, `finish_run`, `update_organisation_status`,
`save_error`

Current behavior:

- Use SQLite `?` placeholders.
- Rely on SQLite implicit transaction behavior followed by `commit()`.

PostgreSQL replacement:

- Use `%s` placeholders.
- Execute through a transaction context.
- Preserve each existing method's commit boundary unless a later, explicitly
  tested batch-write optimization is approved.

#### `DiscoveryStore.save_tender`

Current behavior:

- Uses SQLite placeholders.
- Uses PostgreSQL-compatible `ON CONFLICT ... excluded` syntax.
- Writes tender and evidence rows in one method, then commits.
- Deduplicates evidence with a `NOT EXISTS` query using:

```sql
raw_value IS ?
```

PostgreSQL replacement:

- Use `%s` placeholders.
- Preserve the upsert assignments and column meanings.
- Replace the nullable equality condition with:

```sql
raw_value IS NOT DISTINCT FROM %s
```

- Preserve the tender-plus-evidence transaction boundary.
- Use explicit schema-qualified table names:
  `main.tenders`, `main.source_evidence`, or the selected location schema.

#### `DiscoveryStore.save_tender_occurrence`

Current behavior:

- Uses `INSERT OR IGNORE`.

PostgreSQL replacement:

```sql
ON CONFLICT (tender_id, search_taluka, source_listing_url) DO NOTHING
```

The main PostgreSQL schema must preserve the seven historical orphan
occurrences. The main foreign key is installed only after import as
`NOT VALID`; future invalid references must be rejected.

#### `save_results` and `run_location_discovery`

Current behavior:

- Construct a `DiscoveryStore` from a filesystem `Path`.
- Select either the main or location SQLite file.

PostgreSQL replacement:

- Pass a database manager/repository and an explicit dataset/schema value.
- Do not infer the location schema from a sibling filename.
- Preserve the current separation between full/main extraction and
  location-search extraction.

### `api.py`

#### `ScopedApi.connection` and `location_connection`

Current behavior:

- Open SQLite URI connections with `mode=ro`.
- Enable `PRAGMA foreign_keys = ON`.
- Set `sqlite3.Row`.

PostgreSQL replacement:

- Use pooled connections from the database manager.
- Use a read-only database role or a read-only transaction for API reads.
- Return mapping-like rows through psycopg row factories or explicit row
  conversion.
- Do not emulate SQLite URI read-only mode.
- Do not issue SQLite pragmas.

The adapter must not silently fall back to SQLite when the PostgreSQL
connection is unavailable.

#### API query methods

Affected methods include:

- `_detail_fields`
- `location_search_details`
- `tenders`
- individual tender lookup
- `organisations`

Current behavior:

- Use `?` placeholders.
- Build variable `IN (?, ?, ...)` lists.
- Use SQLite row objects.
- Catch `sqlite3.Error`.
- Use unqualified table names because each connection targets one SQLite file.

PostgreSQL replacement:

- Use `%s` placeholders and psycopg parameter binding.
- Generate placeholder lists only from trusted, counted parameters.
- Use explicit names such as `main.tenders` and `location_ui.tenders`.
- Replace `sqlite3.Error` with `psycopg.Error` subclasses.
- Preserve response dictionaries and field names exactly.
- Keep the job-scoped query restricted to `location_ui`.

The query expression `lower(...)`, `coalesce(...)`, concatenation with `||`,
and `ORDER BY closing_at IS NULL` should be reviewed for PostgreSQL ordering
semantics. If ordering is contract-sensitive, use an explicit `CASE`
expression while preserving the current result order.

#### `LocationJobManager`

Current behavior:

- Stores jobs in an in-memory dictionary.
- Starts worker threads.
- Writes location results through a `DiscoveryStore`.
- Keeps the client and CAPTCHA session in memory.

PostgreSQL replacement:

- Use the adapter for result writes.
- Keep job/session ownership separate from the database adapter.
- Use a pooled connection per transaction, never one shared connection across
  worker threads.
- Add retry handling for serialization/deadlock errors only where it is safe
  and idempotent.

This does not make CAPTCHA sessions durable. A later deployment design must
address restart, timeout, and multi-instance behavior separately.

### `migrations.py`

Current behavior:

- Uses `sqlite3.Connection`.
- Creates `schema_migrations` with SQLite DDL.
- Uses `?` parameters.
- Uses `PRAGMA foreign_keys`.
- Starts an explicit SQLite transaction.
- Executes migration statements one by one.
- Uses SQLite expression/index syntax and migration checksums.

PostgreSQL replacement:

- Create a PostgreSQL migration runner or use the selected migration tool.
- Use `main.schema_migrations` with the same version/checksum meaning.
- Use `%s` placeholders.
- Use PostgreSQL transactions.
- Acquire a PostgreSQL advisory lock so only one service applies migrations.
- Keep checksum verification.
- Use schema-qualified coverage tables and indexes.
- Preserve the existing two migration versions and columns.
- Keep the main occurrence constraint as a post-import `NOT VALID` operation,
  not as an ordinary pre-import migration.

SQLite metadata queries used only by tests must not be copied into production
PostgreSQL code.

### `cleanup_evidence.py`

Current behavior:

- Uses SQLite read-only URI connections.
- Runs `PRAGMA integrity_check`.
- Uses SQLite transactions and `?` placeholders.
- Creates filesystem backups.
- Updates/deletes `source_evidence`.

PostgreSQL replacement:

- Treat cleanup as a separate administrative tool, not part of the API
  adapter.
- Replace filesystem SQLite backups with a PostgreSQL backup/snapshot policy.
- Use a read-only inspection transaction.
- Use PostgreSQL exception handling and `%s` parameters.
- Require an explicit approval flag and a database backup before writes.
- Preserve the dry-run reporting behavior.

### Tests

The following tests intentionally use SQLite fixtures and should remain
available while the migration is developed:

- `test_api.py`
- `test_discover.py`
- `test_migrations.py`
- `test_cleanup_evidence.py`

SQLite-specific test helpers include `sqlite_master`, `PRAGMA table_info`,
`rowid`, SQLite URI read-only connections, and `?` placeholders. They should
not be mechanically converted. Add separate PostgreSQL adapter tests using
the target schemas and keep the existing SQLite tests as compatibility
regressions.

### Database-independent files

- `partitions.py` contains partition and portal-capability logic only.
- `scope.py` contains classification and canonical taluka logic only.
- `schema.sql` remains the SQLite schema and should not be modified by this
  implementation.
- `postgres_schema.sql` is the PostgreSQL target design and should be
  versioned independently from the SQLite schema.

## Recommended adapter architecture

### 1. Configuration object

Create a small database configuration module, for example `db.py`, with:

- `NEON_DATABASE_URL` or `DATABASE_URL`.
- `MAIN_SCHEMA`, defaulting to `main`.
- `LOCATION_SCHEMA`, defaulting to `location_ui`.
- Pool sizing and timeout settings.
- Optional read-only role configuration.

Credentials must come only from environment variables or the deployment
secret manager. They must never be embedded in source, logs, URLs returned by
the API, or evidence records.

Schema names are configuration identifiers and must be validated against a
strict identifier pattern before use. Prefer fixed internal schema constants
for SQL construction rather than interpolating arbitrary request values.

### 2. One pool manager, two logical dataset handles

Use psycopg 3 with `psycopg_pool.ConnectionPool`. A single Neon database can
use one pool because both schemas share the same server, while the adapter
exposes two explicit handles:

```text
database.main
database.location_ui
```

Each repository uses fixed, schema-qualified SQL. Do not rely on changing
`search_path` on a pooled connection.

If operational isolation later requires separate credentials or pools, the
two handles can be backed by separate pools without changing repository
interfaces.

### 3. Transaction context

Use a context manager for every unit of work:

- Acquire a pooled connection.
- Start `conn.transaction()`.
- Execute parameterized statements.
- Commit on normal exit.
- Roll back on exception.
- Return the connection to the pool.

Do not keep a connection on `DiscoveryStore` across worker threads. A store
instance should represent a repository and acquire connections per operation or
per explicit transaction.

### 4. Repository boundary

Keep the existing extraction and API orchestration logic, but move SQL into
small repositories:

- `MainExtractionRepository`
- `LocationExtractionRepository`
- `ScopedReadRepository`
- `MigrationRepository`

The repositories should preserve existing method-level behavior and return
the same dictionaries/dataclasses currently consumed by the application.

Avoid a generic ORM or large query-builder layer. The current schema is small,
SQL is already explicit, and a thin psycopg repository layer is easier to audit
for schema isolation.

### 5. Error handling

Map PostgreSQL errors explicitly:

- `UniqueViolation`: preserve idempotent upsert behavior or surface a
  conflict.
- `ForeignKeyViolation`: report invalid new references.
- `SerializationFailure` and `DeadlockDetected`: retry only idempotent,
  bounded operations.
- `OperationalError`: report unavailable database state; do not return
  success-shaped empty results.
- `DataError`: report malformed input/data and preserve the existing error
  contract.

Do not catch all exceptions and silently fall back to an empty result.

## Environment and dependency changes planned later

The current [requirements.txt](./requirements.txt) contains only a standard
library note. A later implementation will add, after approval:

```text
psycopg[binary]
psycopg_pool
```

The eventual runtime configuration should use:

```text
DATABASE_URL=<Neon connection string>
MAIN_SCHEMA=main
LOCATION_SCHEMA=location_ui
DB_POOL_MIN=<bounded integer>
DB_POOL_MAX=<bounded integer>
DB_CONNECT_TIMEOUT=<bounded seconds>
MAHATENDERS_CORS_ORIGIN=<frontend origin>
PORT=<Render-provided port>
```

The connection string must not be committed or printed. SQLite path
configuration should remain available for the transitional SQLite mode.

## Files that will eventually require modification

This planning task does not modify them. The implementation is expected to
touch only the following categories:

### New or replacement database layer

- `mahatenders_prototype/db.py` or equivalent configuration/pool module.
- A PostgreSQL repository module for extraction and API reads/writes.
- A PostgreSQL migration runner or approved migration-tool configuration.

### Runtime integration

- `api.py`: construct the PostgreSQL database manager and preserve endpoints.
- `discover.py`: replace `DiscoveryStore` persistence while preserving parser,
  pagination, CAPTCHA, and classification logic.
- `migrations.py`: replace SQLite migration execution or isolate it as the
  legacy SQLite path.
- `cleanup_evidence.py`: add a separate PostgreSQL administrative path if
  cleanup remains required.

### Dependencies and tests

- `requirements.txt`: add psycopg dependencies.
- Add PostgreSQL adapter/repository tests.
- Extend API/discovery tests with PostgreSQL-backed fixtures or a controlled
  local PostgreSQL test database.
- Keep existing SQLite tests unchanged as regression coverage.

### Files that should not require behavioral changes

- `partitions.py`
- `scope.py`
- extraction parser and portal-request helpers in `discover.py`
- `mahatenders-api-testing-ui/*`

## Testing strategy

No tests are being run as part of this planning task. The implementation
should use staged validation rather than repeatedly running the entire suite.

### Stage 1: SQLite regression

Before changing the runtime path:

1. Run the existing backend tests once.
2. Verify SQLite database hashes and row counts.
3. Confirm API response fixtures remain unchanged.
4. Confirm no live MahaTenders requests are made.

### Stage 2: Adapter unit tests

Test without Neon where possible:

- Configuration validation.
- Schema selection and qualification.
- `%s` parameter binding.
- Row-to-dictionary conversion.
- `RETURNING id` handling.
- `ON CONFLICT DO NOTHING` behavior.
- Nullable evidence equality.
- Error mapping.
- Connection cleanup after success and failure.

### Stage 3: PostgreSQL integration tests

Use a dedicated disposable PostgreSQL database or approved local PostgreSQL
instance, never the production Neon database:

- Create both schemas from the reviewed DDL.
- Insert explicit historical IDs.
- Adjust sequences.
- Verify generated IDs do not collide.
- Verify `main` and `location_ui` cannot cross-read each other.
- Import the seven orphan occurrences before adding the `NOT VALID` FK.
- Verify new invalid occurrence inserts fail after the FK is installed.
- Confirm constraint validation remains deferred.
- Test rollback after a multi-table write fails.
- Test duplicate-safe organisation/evidence/occurrence writes.
- Test two concurrent extraction transactions.

### Stage 4: Data parity

For both schemas compare SQLite and PostgreSQL:

- Every table row count.
- Primary-key sets.
- Unique-key sets.
- Tender IDs and the 13 cross-schema overlap IDs.
- Original integer IDs.
- Raw date strings byte-for-byte.
- Raw JSON text byte-for-byte.
- Sanitized HTML/evidence content hashes.
- Scope distributions.
- The seven known orphan rows.
- Empty main coverage tables and absent location coverage tables.

### Stage 5: API compatibility

Compare responses for:

- `/health`
- `/api/v1/scope`
- `/api/v1/tenders`
- `/api/v1/tenders/{tender_id}`
- `/api/v1/stats`
- `/api/v1/organisations`
- `/api/v1/location-search/runs/{run_id}/tenders`

The testing UI should use the same endpoint paths and response fields without
any frontend change.

### Stage 6: Operational tests

- Connection-pool exhaustion and recovery.
- Service restart during an idle state.
- Service restart during a non-CAPTCHA extraction.
- Concurrent location jobs.
- Serialization/deadlock retry behavior.
- Database outage error reporting.
- Read-only API role enforcement.

CAPTCHA continuity across restarts or multiple instances is not proven by
these database tests and requires a separate session-state design.

## Risks and compatibility concerns

1. The existing `DiscoveryStore` performs runtime schema initialization and
   scope backfills; PostgreSQL must move these to explicit migrations.
2. The seven orphan main occurrences cannot be validated until a business
   decision resolves them.
3. The 13 overlapping tender IDs must remain schema-qualified and independent.
4. Existing portal dates are text and must not silently become timezone-shifted
   timestamps.
5. JSON must remain exact text even if a parsed `jsonb` helper is introduced.
6. SQLite implicit transaction behavior differs from psycopg transaction
   contexts.
7. SQLite permits a single-file write pattern that does not map directly to
   concurrent PostgreSQL workers.
8. Pooled connections must be reset between requests so transaction state,
   read-only mode, and session settings do not leak.
9. A PostgreSQL failure must not be converted into an empty successful API
   response.
10. The in-memory CAPTCHA `CookieJar` and job registry remain vulnerable to
    process restarts and multi-instance routing.
11. The cleanup tool's SQLite backup model does not provide PostgreSQL backup
    guarantees.
12. Existing SQLite tests use SQLite-specific introspection and should not be
    treated as PostgreSQL migration tests.

## Recommended implementation order

1. Freeze the reviewed PostgreSQL schema and migration plan.
2. Add the dependency and environment configuration design.
3. Add the psycopg pool/configuration module without changing runtime
   selection.
4. Add repository interfaces and PostgreSQL repositories.
5. Add PostgreSQL migration execution with advisory locking.
6. Add adapter unit and disposable-PostgreSQL integration tests.
7. Implement explicit historical data import and identity-sequence adjustment.
8. Verify the seven orphan records and install the main `NOT VALID` FK only
   after occurrence import.
9. Add a configuration-controlled backend selection mode while retaining
   SQLite as the default rollback path.
10. Run SQLite regression tests and PostgreSQL parity tests.
11. Switch API reads to PostgreSQL in a staging environment.
12. Verify API response compatibility with the existing testing UI.
13. Test one controlled extraction write with CAPTCHA/session behavior.
14. Perform production cutover with SQLite backups retained.
15. Address durable job/CookieJar session state separately before scaling beyond
    a single backend instance.

## Readiness

This plan is ready for implementation review. Implementation should not start
until:

- The adapter/repository boundary is approved.
- The orphan-record policy is approved.
- PostgreSQL dependency and environment changes are approved.
- A disposable PostgreSQL test environment is available.
- The reviewed schema and import validation procedure are frozen.
