from __future__ import annotations

import argparse
import hashlib
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, Sequence


MIGRATION_NAME = "001_add_coverage_tracking"
MIGRATION_VERSION_TABLE = "schema_migrations"

_COVERAGE_STATEMENTS: tuple[str, ...] = (
    """
    CREATE TABLE IF NOT EXISTS coverage_runs (
        id INTEGER PRIMARY KEY,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        status TEXT NOT NULL,
        worker_version TEXT NOT NULL,
        request_delay_seconds REAL NOT NULL,
        error TEXT
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS coverage_partitions (
        id INTEGER PRIMARY KEY,
        district TEXT NOT NULL,
        taluka TEXT NOT NULL,
        year INTEGER,
        month INTEGER,
        status_filter TEXT,
        search_mode TEXT NOT NULL,
        date_from TEXT,
        date_to TEXT,
        portal_query_signature TEXT NOT NULL,
        state TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        last_success_at TEXT,
        next_url TEXT,
        pages_discovered INTEGER NOT NULL DEFAULT 0,
        pages_processed INTEGER NOT NULL DEFAULT 0,
        tender_ids_discovered INTEGER NOT NULL DEFAULT 0,
        details_retrieved INTEGER NOT NULL DEFAULT 0,
        details_failed INTEGER NOT NULL DEFAULT 0,
        details_skipped INTEGER NOT NULL DEFAULT 0,
        last_error TEXT
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS coverage_pages (
        id INTEGER PRIMARY KEY,
        partition_id INTEGER NOT NULL REFERENCES coverage_partitions(id),
        page_number INTEGER NOT NULL,
        source_url TEXT NOT NULL,
        page_fingerprint TEXT NOT NULL,
        next_url TEXT,
        status TEXT NOT NULL,
        tender_count INTEGER NOT NULL DEFAULT 0,
        processed_at TEXT,
        error TEXT,
        UNIQUE (partition_id, page_number, page_fingerprint)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS coverage_tender_work (
        id INTEGER PRIMARY KEY,
        partition_id INTEGER NOT NULL REFERENCES coverage_partitions(id),
        tender_id TEXT NOT NULL,
        source_listing_url TEXT NOT NULL,
        detail_status TEXT NOT NULL,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        first_discovered_at TEXT NOT NULL,
        last_attempt_at TEXT,
        retrieved_at TEXT,
        failure_reason TEXT,
        skip_reason TEXT,
        UNIQUE (partition_id, tender_id)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS tender_observations (
        id INTEGER PRIMARY KEY,
        tender_id TEXT NOT NULL REFERENCES tenders(tender_id),
        partition_id INTEGER NOT NULL REFERENCES coverage_partitions(id),
        retrieved_at TEXT NOT NULL,
        source_listing_url TEXT NOT NULL,
        source_detail_url TEXT NOT NULL,
        detail_content_hash TEXT NOT NULL,
        parsed_fields_json TEXT,
        sanitized_html TEXT,
        classification_status TEXT NOT NULL,
        classification_provenance TEXT NOT NULL,
        UNIQUE (tender_id, partition_id, detail_content_hash)
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_coverage_partitions_state ON coverage_partitions(state)",
    "CREATE INDEX IF NOT EXISTS idx_coverage_pages_partition_status ON coverage_pages(partition_id, status)",
    "CREATE INDEX IF NOT EXISTS idx_coverage_tender_work_status ON coverage_tender_work(partition_id, detail_status)",
    "CREATE INDEX IF NOT EXISTS idx_tender_observations_tender ON tender_observations(tender_id, retrieved_at)",
)

_HARDENING_STATEMENTS: tuple[str, ...] = (
    """
    CREATE UNIQUE INDEX IF NOT EXISTS uq_coverage_partitions_logical
    ON coverage_partitions (
        district,
        taluka,
        CASE WHEN year IS NULL THEN 0 ELSE 1 END,
        COALESCE(year, 0),
        CASE WHEN month IS NULL THEN 0 ELSE 1 END,
        COALESCE(month, 0),
        CASE WHEN status_filter IS NULL THEN 0 ELSE 1 END,
        COALESCE(status_filter, ''),
        search_mode,
        CASE WHEN date_from IS NULL THEN 0 ELSE 1 END,
        COALESCE(date_from, ''),
        CASE WHEN date_to IS NULL THEN 0 ELSE 1 END,
        COALESCE(date_to, ''),
        portal_query_signature
    )
    """,
)

MIGRATIONS: tuple[tuple[str, tuple[str, ...]], ...] = (
    (MIGRATION_NAME, _COVERAGE_STATEMENTS),
    ("002_harden_coverage_partitions", _HARDENING_STATEMENTS),
)


def migration_statements() -> Iterable[str]:
    for _, statements in MIGRATIONS:
        yield from statements


def _migration_checksum(statements: Sequence[str]) -> str:
    digest = hashlib.sha256()
    for statement in statements:
        digest.update(statement.strip().encode("utf-8"))
        digest.update(b"\0")
    return digest.hexdigest()


def _ensure_version_table(connection: sqlite3.Connection) -> None:
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version TEXT PRIMARY KEY,
            checksum TEXT NOT NULL,
            applied_at TEXT NOT NULL
        )
        """
    )


def _apply_migration(
    connection: sqlite3.Connection,
    version: str,
    statements: Sequence[str],
) -> None:
    checksum = _migration_checksum(statements)
    existing = connection.execute(
        "SELECT checksum FROM schema_migrations WHERE version = ?",
        (version,),
    ).fetchone()
    if existing:
        if existing[0] != checksum:
            raise RuntimeError("migration checksum mismatch: %s" % version)
        return
    for statement in statements:
        connection.execute(statement)
    connection.execute(
        """
        INSERT INTO schema_migrations (version, checksum, applied_at)
        VALUES (?, ?, ?)
        """,
        (version, checksum, datetime.now(timezone.utc).isoformat()),
    )


def apply_migrations(database: Path) -> None:
    database = database.resolve()
    if not database.exists():
        raise FileNotFoundError("database does not exist: %s" % database)
    connection = sqlite3.connect(database)
    try:
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("BEGIN")
        _ensure_version_table(connection)
        for version, statements in MIGRATIONS:
            _apply_migration(connection, version, statements)
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Apply additive MahaTenders schema migrations")
    parser.add_argument("database", type=Path)
    args = parser.parse_args()
    apply_migrations(args.database)
    print("Applied additive migrations to %s" % args.database.resolve())


if __name__ == "__main__":
    main()