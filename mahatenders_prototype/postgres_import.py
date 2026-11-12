"""Read-only SQLite schema inspection for the PostgreSQL import phase.

This module intentionally does not import data, execute PostgreSQL, apply
migrations, or modify SQLite files. It produces independent source manifests
and validates them against the reviewed import contract.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping, Optional, Sequence


DATASET_MAIN = "main"
DATASET_LOCATION = "location_ui"
MIGRATION_TABLE = "schema_migrations"
LOCATION_OPTIONAL_TABLES = frozenset(
    {
        "coverage_runs",
        "coverage_partitions",
        "coverage_pages",
        "coverage_tender_work",
        "tender_observations",
    }
)
_INSERT_BATCH_SIZE = 500

BASE_TABLES = (
    "organisations",
    "tenders",
    "source_evidence",
    "extraction_runs",
    "run_organisations",
    "listing_pages",
    "extraction_errors",
    "tender_occurrences",
)
MAIN_COVERAGE_TABLES = tuple(LOCATION_OPTIONAL_TABLES)
MAIN_IMPORT_ORDER = (
    "organisations",
    "extraction_runs",
    "tenders",
    "run_organisations",
    "listing_pages",
    "source_evidence",
    "tender_occurrences",
    "extraction_errors",
    "coverage_runs",
    "coverage_partitions",
    "coverage_pages",
    "coverage_tender_work",
    "tender_observations",
)
LOCATION_IMPORT_ORDER = (
    "organisations",
    "extraction_runs",
    "tenders",
    "run_organisations",
    "listing_pages",
    "source_evidence",
    "tender_occurrences",
    "extraction_errors",
)


@dataclass(frozen=True)
class ColumnManifest:
    name: str
    declared_type: str
    not_null: bool
    default: Optional[str]
    primary_key_position: int

    def as_dict(self) -> dict[str, object]:
        return {
            "name": self.name,
            "declared_type": self.declared_type,
            "not_null": self.not_null,
            "default": self.default,
            "primary_key_position": self.primary_key_position,
        }


@dataclass(frozen=True)
class IndexManifest:
    name: str
    unique: bool
    origin: str
    columns: tuple[str, ...]

    def as_dict(self) -> dict[str, object]:
        return {
            "name": self.name,
            "unique": self.unique,
            "origin": self.origin,
            "columns": list(self.columns),
        }


@dataclass(frozen=True)
class ForeignKeyManifest:
    identifier: int
    sequence: int
    referenced_table: str
    source_column: str
    referenced_column: str
    on_update: str
    on_delete: str
    match: str

    def as_dict(self) -> dict[str, object]:
        return {
            "identifier": self.identifier,
            "sequence": self.sequence,
            "referenced_table": self.referenced_table,
            "source_column": self.source_column,
            "referenced_column": self.referenced_column,
            "on_update": self.on_update,
            "on_delete": self.on_delete,
            "match": self.match,
        }


@dataclass(frozen=True)
class TableManifest:
    name: str
    columns: tuple[ColumnManifest, ...]
    indexes: tuple[IndexManifest, ...]
    foreign_keys: tuple[ForeignKeyManifest, ...]

    def as_dict(self) -> dict[str, object]:
        return {
            "name": self.name,
            "columns": [column.as_dict() for column in self.columns],
            "indexes": [index.as_dict() for index in self.indexes],
            "foreign_keys": [key.as_dict() for key in self.foreign_keys],
        }


@dataclass(frozen=True)
class SQLiteManifest:
    dataset: str
    database: str
    tables: tuple[TableManifest, ...]
    migration_versions: tuple[dict[str, str], ...]

    def as_dict(self) -> dict[str, object]:
        return {
            "dataset": self.dataset,
            "database": self.database,
            "tables": [table.as_dict() for table in self.tables],
            "migration_versions": [dict(row) for row in self.migration_versions],
        }


class SchemaValidationError(RuntimeError):
    """Raised when a source schema cannot safely enter the import contract."""

    def __init__(self, dataset: str, differences: Sequence[str]) -> None:
        self.dataset = dataset
        self.differences = tuple(differences)
        message = "%s SQLite schema validation failed: %s" % (
            dataset,
            "; ".join(self.differences),
        )
        super().__init__(message)


class ImportSafetyError(RuntimeError):
    """Raised when an import cannot proceed without risking source data."""


@dataclass(frozen=True)
class TableImportSummary:
    table: str
    row_count: int
    data_hash: str

    def as_dict(self) -> dict[str, object]:
        return {
            "table": self.table,
            "row_count": self.row_count,
            "data_hash": self.data_hash,
        }


@dataclass(frozen=True)
class SourceImportSummary:
    dataset: str
    tables: tuple[TableImportSummary, ...]
    orphan_occurrences: tuple[dict[str, object], ...]

    def as_dict(self) -> dict[str, object]:
        return {
            "dataset": self.dataset,
            "tables": [table.as_dict() for table in self.tables],
            "orphan_occurrences": [dict(row) for row in self.orphan_occurrences],
        }


def _quote_identifier(identifier: str) -> str:
    return '"' + identifier.replace('"', '""') + '"'


def _read_only_connection(database: Path) -> sqlite3.Connection:
    resolved = database.resolve()
    if not resolved.is_file():
        raise FileNotFoundError("SQLite database does not exist: %s" % resolved)
    return sqlite3.connect(
        resolved.as_uri() + "?mode=ro",
        uri=True,
    )


def _table_names(connection: sqlite3.Connection) -> tuple[str, ...]:
    return tuple(
        row[0]
        for row in connection.execute(
            """
            SELECT name
            FROM sqlite_master
            WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
            ORDER BY name
            """
        ).fetchall()
    )


def _table_manifest(
    connection: sqlite3.Connection, table: str
) -> TableManifest:
    quoted_table = _quote_identifier(table)
    columns = tuple(
        ColumnManifest(
            name=row[1],
            declared_type=row[2] or "",
            not_null=bool(row[3]),
            default=row[4],
            primary_key_position=int(row[5]),
        )
        for row in connection.execute("PRAGMA table_info(%s)" % quoted_table)
    )
    indexes: list[IndexManifest] = []
    for row in connection.execute("PRAGMA index_list(%s)" % quoted_table):
        index_name = str(row[1])
        quoted_index = _quote_identifier(index_name)
        index_columns = tuple(
            index_row[2]
            for index_row in connection.execute(
                "PRAGMA index_info(%s)" % quoted_index
            )
            if index_row[2] is not None
        )
        indexes.append(
            IndexManifest(
                name=index_name,
                unique=bool(row[2]),
                origin=str(row[3]),
                columns=index_columns,
            )
        )
    foreign_keys = tuple(
        ForeignKeyManifest(
            identifier=int(row[0]),
            sequence=int(row[1]),
            referenced_table=str(row[2]),
            source_column=str(row[3]),
            referenced_column=str(row[4]),
            on_update=str(row[5]),
            on_delete=str(row[6]),
            match=str(row[7]),
        )
        for row in connection.execute("PRAGMA foreign_key_list(%s)" % quoted_table)
    )
    return TableManifest(
        name=table,
        columns=columns,
        indexes=tuple(indexes),
        foreign_keys=foreign_keys,
    )


def inspect_sqlite_schema(database: Path, dataset: str) -> SQLiteManifest:
    """Inspect one SQLite source using a read-only connection."""

    if dataset not in (DATASET_MAIN, DATASET_LOCATION):
        raise ValueError("dataset must be main or location_ui")
    connection = _read_only_connection(database)
    try:
        tables = tuple(
            _table_manifest(connection, table)
            for table in _table_names(connection)
        )
        table_names = {table.name for table in tables}
        migration_versions: tuple[dict[str, str], ...] = ()
        if MIGRATION_TABLE in table_names:
            migration_versions = tuple(
                {
                    "version": str(row[0]),
                    "checksum": str(row[1]),
                    "applied_at": str(row[2]),
                }
                for row in connection.execute(
                    """
                    SELECT version, checksum, applied_at
                    FROM schema_migrations
                    ORDER BY version
                    """
                ).fetchall()
            )
        return SQLiteManifest(
            dataset=dataset,
            database=str(database.resolve()),
            tables=tables,
            migration_versions=migration_versions,
        )
    finally:
        connection.close()


def _column_specs(
    names: Sequence[str],
    not_null: Sequence[str] = (),
    primary_keys: Mapping[str, int] | None = None,
    types: Mapping[str, str] | None = None,
    defaults: Mapping[str, Optional[str]] | None = None,
) -> tuple[ColumnManifest, ...]:
    primary_keys = primary_keys or {}
    types = types or {}
    defaults = defaults or {}
    return tuple(
        ColumnManifest(
            name=name,
            declared_type=types.get(name, "TEXT"),
            not_null=name in not_null,
            default=defaults.get(name),
            primary_key_position=primary_keys.get(name, 0),
        )
        for name in names
    )


def _base_expected_columns() -> dict[str, tuple[ColumnManifest, ...]]:
    integer_id = lambda names, **kwargs: _column_specs(
        ("id", *names),
        primary_keys={"id": 1},
        types={"id": "INTEGER", **kwargs.pop("types", {})},
        **kwargs,
    )
    return {
        "organisations": integer_id(
            ("name", "tender_count", "source_url", "count_url", "observed_at"),
            not_null=("name", "tender_count", "source_url", "count_url", "observed_at"),
            types={"tender_count": "INTEGER"},
        ),
        "tenders": integer_id(
            (
                "tender_id", "reference_number", "title", "organisation_chain",
                "published_at", "closing_at", "opening_at", "estimated_value",
                "product_category", "location_raw", "location_city_village",
                "location_taluka", "location_district", "location_state",
                "location_provenance", "location_confidence", "scope_status",
                "scope_district", "scope_taluka", "scope_provenance",
                "source_listing_url", "source_detail_url", "observed_at",
            ),
            not_null=(
                "tender_id", "organisation_chain", "location_provenance",
                "location_confidence", "scope_status", "scope_provenance",
                "source_listing_url", "source_detail_url", "observed_at",
            ),
            defaults={
                "scope_status": "'UNKNOWN'",
                "scope_provenance": "'scope.unclassified'",
            },
            types={"location_confidence": "REAL"},
        ),
        "source_evidence": integer_id(
            (
                "tender_id", "field_name", "raw_value", "source_page",
                "extraction_method", "observed_at",
            ),
            not_null=("tender_id", "field_name", "source_page", "extraction_method", "observed_at"),
        ),
        "extraction_runs": integer_id(
            (
                "started_at", "finished_at", "max_organisations",
                "max_pages_per_organisation", "max_details_per_organisation",
                "status", "summary_json",
            ),
            not_null=(
                "started_at", "max_organisations", "max_pages_per_organisation",
                "max_details_per_organisation", "status",
            ),
            types={
                "max_organisations": "INTEGER",
                "max_pages_per_organisation": "INTEGER",
                "max_details_per_organisation": "INTEGER",
            },
        ),
        "run_organisations": _column_specs(
            ("run_id", "organisation_name", "status"),
            not_null=("run_id", "organisation_name", "status"),
            primary_keys={"run_id": 1, "organisation_name": 2},
            types={"run_id": "INTEGER"},
        ),
        "listing_pages": integer_id(
            (
                "run_id", "organisation_name", "page_number", "source_url",
                "tender_count", "page_fingerprint", "next_url", "observed_at",
            ),
            not_null=(
                "run_id", "organisation_name", "page_number", "source_url",
                "tender_count", "page_fingerprint", "observed_at",
            ),
            types={"run_id": "INTEGER", "page_number": "INTEGER", "tender_count": "INTEGER"},
        ),
        "extraction_errors": integer_id(
            (
                "run_id", "organisation_name", "stage", "message",
                "started_at", "finished_at",
            ),
            not_null=("run_id", "stage", "message", "started_at", "finished_at"),
            types={"run_id": "INTEGER"},
        ),
        "tender_occurrences": integer_id(
            (
                "tender_id", "search_taluka", "source_listing_url",
                "page_number", "observed_at",
            ),
            not_null=(
                "tender_id", "search_taluka", "source_listing_url",
                "page_number", "observed_at",
            ),
            types={"page_number": "INTEGER"},
        ),
        MIGRATION_TABLE: _column_specs(
            ("version", "checksum", "applied_at"),
            not_null=("version", "checksum", "applied_at"),
            primary_keys={"version": 1},
        ),
    }


def _coverage_expected_columns() -> dict[str, tuple[ColumnManifest, ...]]:
    integer_id = lambda names, **kwargs: _column_specs(
        ("id", *names),
        primary_keys={"id": 1},
        types={"id": "INTEGER", **kwargs.pop("types", {})},
        **kwargs,
    )
    return {
        "coverage_runs": integer_id(
            ("started_at", "finished_at", "status", "worker_version",
             "request_delay_seconds", "error"),
            not_null=("started_at", "status", "worker_version", "request_delay_seconds"),
            types={"request_delay_seconds": "REAL"},
        ),
        "coverage_partitions": integer_id(
            (
                "district", "taluka", "year", "month", "status_filter",
                "search_mode", "date_from", "date_to", "portal_query_signature",
                "state", "started_at", "finished_at", "last_success_at", "next_url",
                "pages_discovered", "pages_processed", "tender_ids_discovered",
                "details_retrieved", "details_failed", "details_skipped", "last_error",
            ),
            not_null=(
                "district", "taluka", "status_filter", "search_mode",
                "portal_query_signature", "state",
                "pages_discovered", "pages_processed", "tender_ids_discovered",
                "details_retrieved", "details_failed", "details_skipped",
            ),
            defaults={
                "pages_discovered": "0",
                "pages_processed": "0",
                "tender_ids_discovered": "0",
                "details_retrieved": "0",
                "details_failed": "0",
                "details_skipped": "0",
            },
            types={
                "year": "INTEGER",
                "month": "INTEGER",
                "pages_discovered": "INTEGER",
                "pages_processed": "INTEGER",
                "tender_ids_discovered": "INTEGER",
                "details_retrieved": "INTEGER",
                "details_failed": "INTEGER",
                "details_skipped": "INTEGER",
            },
        ),
        "coverage_pages": integer_id(
            (
                "partition_id", "page_number", "source_url", "page_fingerprint",
                "next_url", "status", "tender_count", "processed_at", "error",
            ),
            not_null=(
                "partition_id", "page_number", "source_url", "page_fingerprint",
                "status", "tender_count",
            ),
            defaults={"tender_count": "0"},
            types={"partition_id": "INTEGER", "page_number": "INTEGER", "tender_count": "INTEGER"},
        ),
        "coverage_tender_work": integer_id(
            (
                "partition_id", "tender_id", "source_listing_url", "detail_status",
                "attempt_count", "first_discovered_at", "last_attempt_at",
                "retrieved_at", "failure_reason", "skip_reason",
            ),
            not_null=(
                "partition_id", "tender_id", "source_listing_url", "detail_status",
                "attempt_count", "first_discovered_at",
            ),
            defaults={"attempt_count": "0"},
            types={"partition_id": "INTEGER", "attempt_count": "INTEGER"},
        ),
        "tender_observations": integer_id(
            (
                "tender_id", "partition_id", "retrieved_at", "source_listing_url",
                "source_detail_url", "detail_content_hash", "parsed_fields_json",
                "sanitized_html", "classification_status", "classification_provenance",
            ),
            not_null=(
                "tender_id", "partition_id", "retrieved_at", "source_listing_url",
                "source_detail_url", "detail_content_hash", "classification_status",
                "classification_provenance",
            ),
            types={"partition_id": "INTEGER"},
        ),
    }


def _unique_signatures(table: TableManifest) -> set[tuple[str, ...]]:
    return {
        index.columns
        for index in table.indexes
        if index.unique and index.columns
    }


def _foreign_key_signatures(
    table: TableManifest,
) -> set[tuple[str, str, str, str, str]]:
    return {
        (
            key.source_column,
            key.referenced_table,
            key.referenced_column,
            key.on_update,
            key.on_delete,
        )
        for key in table.foreign_keys
    }


def _expected_unique_signatures() -> dict[str, set[tuple[str, ...]]]:
    return {
        "organisations": {("name",)},
        "tenders": {("tender_id",)},
        "run_organisations": {("run_id", "organisation_name")},
        "listing_pages": {("run_id", "organisation_name", "page_number")},
        "tender_occurrences": {
            ("tender_id", "search_taluka", "source_listing_url")
        },
        "coverage_partitions": {
            (
                "district", "taluka", "year", "month", "status_filter",
                "search_mode", "date_from", "date_to", "portal_query_signature",
            )
        },
        "coverage_pages": {
            ("partition_id", "page_number", "page_fingerprint")
        },
        "coverage_tender_work": {("partition_id", "tender_id")},
        "tender_observations": {
            ("tender_id", "partition_id", "detail_content_hash")
        },
        MIGRATION_TABLE: {("version",)},
    }


def _expected_foreign_keys(
    dataset: str,
) -> dict[str, set[tuple[str, str, str, str, str]]]:
    no_action = "NO ACTION"
    expected = {
        "run_organisations": {("run_id", "extraction_runs", "id", no_action, no_action)},
        "listing_pages": {("run_id", "extraction_runs", "id", no_action, no_action)},
        "extraction_errors": {("run_id", "extraction_runs", "id", no_action, no_action)},
        "tender_occurrences": {("tender_id", "tenders", "tender_id", no_action, no_action)},
        "coverage_pages": {("partition_id", "coverage_partitions", "id", no_action, no_action)},
        "coverage_tender_work": {("partition_id", "coverage_partitions", "id", no_action, no_action)},
        "tender_observations": {
            ("tender_id", "tenders", "tender_id", no_action, no_action),
            ("partition_id", "coverage_partitions", "id", no_action, no_action),
        },
    }
    if dataset == DATASET_MAIN:
        expected["source_evidence"] = {
            ("tender_id", "tenders", "tender_id", no_action, no_action)
        }
    return expected


def validate_manifest(manifest: SQLiteManifest) -> None:
    """Validate a source manifest and raise before any import can proceed."""

    expected_tables = set(BASE_TABLES)
    if manifest.dataset == DATASET_MAIN:
        expected_tables.update(MAIN_COVERAGE_TABLES)
    actual_tables = {table.name for table in manifest.tables}
    differences: list[str] = []
    missing = expected_tables - actual_tables
    unexpected = actual_tables - expected_tables
    if missing:
        differences.append("missing required tables: %s" % ", ".join(sorted(missing)))
    if unexpected:
        differences.append("unexpected tables: %s" % ", ".join(sorted(unexpected)))

    expected_columns = _base_expected_columns()
    expected_columns.update(_coverage_expected_columns())
    for table in sorted(actual_tables & expected_tables):
        actual = next(item for item in manifest.tables if item.name == table)
        actual_by_name = {column.name: column for column in actual.columns}
        expected = {column.name: column for column in expected_columns[table]}
        missing_columns = set(expected) - set(actual_by_name)
        unexpected_columns = set(actual_by_name) - set(expected)
        if missing_columns:
            differences.append(
                "%s missing columns: %s" % (table, ", ".join(sorted(missing_columns)))
            )
        if unexpected_columns:
            differences.append(
                "%s unexpected columns: %s"
                % (table, ", ".join(sorted(unexpected_columns)))
            )
        for column_name in sorted(set(expected) & set(actual_by_name)):
            expected_column = expected[column_name]
            actual_column = actual_by_name[column_name]
            if (
                expected_column.declared_type.upper()
                != actual_column.declared_type.upper()
                or expected_column.not_null != actual_column.not_null
                or expected_column.default != actual_column.default
                or expected_column.primary_key_position
                != actual_column.primary_key_position
            ):
                differences.append(
                    "%s.%s definition differs: expected %s, got %s"
                    % (
                        table,
                        column_name,
                        expected_column.as_dict(),
                        actual_column.as_dict(),
                    )
                )

        required_unique = _expected_unique_signatures().get(table, set())
        missing_unique = required_unique - _unique_signatures(actual)
        if missing_unique:
            differences.append(
                "%s missing unique constraints/indexes: %s"
                % (table, sorted(missing_unique))
            )
        required_fks = _expected_foreign_keys(manifest.dataset).get(table, set())
        actual_fks = _foreign_key_signatures(actual)
        if required_fks - actual_fks:
            differences.append(
                "%s missing foreign keys: %s"
                % (table, sorted(required_fks - actual_fks))
            )
        if actual_fks - required_fks:
            differences.append(
                "%s unexpected foreign keys: %s"
                % (table, sorted(actual_fks - required_fks))
            )

    if MIGRATION_TABLE in actual_tables:
        differences.append(
            "schema_migrations must not be imported from SQLite; "
            "PostgreSQL migration history is managed separately"
        )
    if differences:
        raise SchemaValidationError(manifest.dataset, differences)


def inspect_and_validate(database: Path, dataset: str) -> SQLiteManifest:
    """Inspect one source and fail safely if its schema is unexpected."""

    manifest = inspect_sqlite_schema(database, dataset)
    validate_manifest(manifest)
    return manifest


def inspect_sources(
    main_database: Path, location_database: Path
) -> tuple[SQLiteManifest, SQLiteManifest]:
    """Inspect both sources independently before any import operation."""

    return (
        inspect_sqlite_schema(main_database, DATASET_MAIN),
        inspect_sqlite_schema(location_database, DATASET_LOCATION),
    )


def _table_by_name(manifest: SQLiteManifest, table: str) -> TableManifest:
    for candidate in manifest.tables:
        if candidate.name == table:
            return candidate
    raise ImportSafetyError(
        "%s source table is missing from the validated manifest: %s"
        % (manifest.dataset, table)
    )


def _import_order(dataset: str) -> tuple[str, ...]:
    if dataset == DATASET_MAIN:
        return MAIN_IMPORT_ORDER
    if dataset == DATASET_LOCATION:
        return LOCATION_IMPORT_ORDER
    raise ValueError("dataset must be main or location_ui")


def _row_values(row: Any, columns: Sequence[str]) -> tuple[object, ...]:
    if isinstance(row, Mapping):
        return tuple(row[column] for column in columns)
    return tuple(row[index] for index in range(len(columns)))


def _canonical_value(value: object) -> object:
    if isinstance(value, bytes):
        return {"__bytes__": value.hex()}
    return value


def _data_hash(
    rows: Sequence[Any], columns: Sequence[str]
) -> str:
    digest = hashlib.sha256()
    for row in rows:
        values = [_canonical_value(value) for value in _row_values(row, columns)]
        encoded = json.dumps(
            values,
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode("utf-8")
        digest.update(encoded)
        digest.update(b"\0")
    return digest.hexdigest()


def _primary_key_columns(table: TableManifest) -> tuple[str, ...]:
    return tuple(
        column.name
        for column in sorted(
            table.columns,
            key=lambda item: item.primary_key_position or 10**9,
        )
        if column.primary_key_position
    )


def _select_source_rows(
    connection: sqlite3.Connection, table: TableManifest
) -> tuple[sqlite3.Row, ...]:
    columns = ", ".join(_quote_identifier(column.name) for column in table.columns)
    order_columns = _primary_key_columns(table)
    order = (
        " ORDER BY "
        + ", ".join(_quote_identifier(column) for column in order_columns)
        if order_columns
        else ""
    )
    return tuple(
        connection.execute(
            "SELECT %s FROM %s%s"
            % (columns, _quote_identifier(table.name), order)
        ).fetchall()
    )


@dataclass(frozen=True)
class _SourceSnapshot:
    manifest: SQLiteManifest
    rows: Mapping[str, tuple[sqlite3.Row, ...]]
    summary: SourceImportSummary


def _orphan_occurrences(
    connection: sqlite3.Connection, manifest: SQLiteManifest
) -> tuple[dict[str, object], ...]:
    if manifest.dataset != DATASET_MAIN:
        return ()
    table = _table_by_name(manifest, "tender_occurrences")
    columns = ", ".join(
        "o.%s" % _quote_identifier(column.name) for column in table.columns
    )
    rows = connection.execute(
        """
        SELECT %s
        FROM tender_occurrences AS o
        LEFT JOIN tenders AS t ON t.tender_id = o.tender_id
        WHERE t.tender_id IS NULL
        ORDER BY o.id
        """
        % columns
    ).fetchall()
    return tuple(
        {
            column.name: row[index]
            for index, column in enumerate(table.columns)
        }
        for row in rows
    )


def _read_source_snapshot(
    database: Path, dataset: str
) -> _SourceSnapshot:
    manifest = inspect_sqlite_schema(database, dataset)
    validate_manifest(manifest)
    connection = _read_only_connection(database)
    connection.row_factory = sqlite3.Row
    try:
        rows = {
            table: _select_source_rows(
                connection, _table_by_name(manifest, table)
            )
            for table in _import_order(dataset)
        }
        orphan_occurrences = _orphan_occurrences(connection, manifest)
    finally:
        connection.close()

    if dataset == DATASET_MAIN and len(orphan_occurrences) != 7:
        raise ImportSafetyError(
            "main source contains %d occurrence orphans; expected the seven "
            "reviewed historical orphans"
            % len(orphan_occurrences)
        )
    summaries = tuple(
        TableImportSummary(
            table=table,
            row_count=len(table_rows),
            data_hash=_data_hash(
                table_rows,
                [column.name for column in _table_by_name(manifest, table).columns],
            ),
        )
        for table, table_rows in rows.items()
    )
    return _SourceSnapshot(
        manifest=manifest,
        rows=rows,
        summary=SourceImportSummary(
            dataset=dataset,
            tables=summaries,
            orphan_occurrences=orphan_occurrences,
        ),
    )


def preflight_sources(
    main_database: Path, location_database: Path
) -> tuple[SourceImportSummary, SourceImportSummary]:
    """Inspect, validate, hash, and report both sources without target access."""

    return (
        _read_source_snapshot(main_database, DATASET_MAIN).summary,
        _read_source_snapshot(location_database, DATASET_LOCATION).summary,
    )


def _target_table(handle: Any, table: str) -> str:
    try:
        return handle.qualify(table)
    except AttributeError as exc:
        raise ImportSafetyError("target handle does not support schema qualification") from exc


def _target_rows(
    connection: Any, handle: Any, table_manifest: TableManifest
) -> tuple[Any, ...]:
    columns = ", ".join(
        _quote_identifier(column.name) for column in table_manifest.columns
    )
    order_columns = _primary_key_columns(table_manifest)
    order = (
        " ORDER BY "
        + ", ".join(_quote_identifier(column) for column in order_columns)
        if order_columns
        else ""
    )
    cursor = connection.execute(
        "SELECT %s FROM %s%s"
        % (columns, _target_table(handle, table_manifest.name), order)
    )
    return tuple(cursor.fetchall())


def _assert_target_empty(
    connection: Any, handle: Any, manifest: SQLiteManifest
) -> None:
    for table in _import_order(manifest.dataset):
        table_name = _target_table(handle, table)
        row = connection.execute(
            "SELECT COUNT(*) AS row_count FROM %s" % table_name
        ).fetchone()
        count = row["row_count"] if isinstance(row, Mapping) else row[0]
        if int(count) != 0:
            raise ImportSafetyError(
                "refusing to import into non-empty target table %s" % table_name
            )


def _insert_snapshot(
    connection: Any, handle: Any, snapshot: _SourceSnapshot
) -> None:
    for table in _import_order(snapshot.manifest.dataset):
        table_manifest = _table_by_name(snapshot.manifest, table)
        column_names = [column.name for column in table_manifest.columns]
        columns = ", ".join(_quote_identifier(column) for column in column_names)
        placeholders = ", ".join(["%s"] * len(column_names))
        statement = "INSERT INTO %s (%s) VALUES (%s)" % (
            _target_table(handle, table),
            columns,
            placeholders,
        )
        batch: list[tuple[Any, ...]] = []
        with connection.cursor() as cursor:
            for row in snapshot.rows[table]:
                batch.append(_row_values(row, column_names))
                if len(batch) == _INSERT_BATCH_SIZE:
                    cursor.executemany(statement, batch)
                    batch.clear()
            if batch:
                cursor.executemany(statement, batch)


def _advance_identity_sequences(
    connection: Any, handle: Any, manifest: SQLiteManifest
) -> None:
    for table in _import_order(manifest.dataset):
        table_manifest = _table_by_name(manifest, table)
        primary_keys = _primary_key_columns(table_manifest)
        if primary_keys != ("id",):
            continue
        table_name = _target_table(handle, table)
        connection.execute(
            """
            SELECT setval(
                pg_get_serial_sequence(%%s, %%s),
                COALESCE(MAX(id), 1),
                MAX(id) IS NOT NULL
            )
            FROM %s
            """
            % table_name,
            (table_name, "id"),
        )


def _count_value(row: Any) -> int:
    value = row["row_count"] if isinstance(row, Mapping) else row[0]
    return int(value)


def _verify_target_snapshot(
    connection: Any, handle: Any, snapshot: _SourceSnapshot
) -> None:
    for table in _import_order(snapshot.manifest.dataset):
        table_manifest = _table_by_name(snapshot.manifest, table)
        source_rows = snapshot.rows[table]
        target_rows = _target_rows(connection, handle, table_manifest)
        if len(target_rows) != len(source_rows):
            raise ImportSafetyError(
                "%s row count mismatch: source=%d target=%d"
                % (table, len(source_rows), len(target_rows))
            )
        columns = [column.name for column in table_manifest.columns]
        source_hash = _data_hash(source_rows, columns)
        target_hash = _data_hash(target_rows, columns)
        if source_hash != target_hash:
            raise ImportSafetyError("%s deterministic data hash mismatch" % table)
        primary_keys = _primary_key_columns(table_manifest)
        if primary_keys:
            source_ids = tuple(
                _row_values(row, primary_keys) for row in source_rows
            )
            target_ids = tuple(
                _row_values(row, primary_keys) for row in target_rows
            )
            if source_ids != target_ids:
                raise ImportSafetyError("%s primary-key set mismatch" % table)


def _verify_foreign_keys(
    connection: Any, handle: Any, manifest: SQLiteManifest
) -> None:
    for table in _import_order(manifest.dataset):
        for foreign_key in _expected_foreign_keys(manifest.dataset).get(table, ()):
            source_column, parent_table, parent_column, _, _ = foreign_key
            if (
                manifest.dataset == DATASET_MAIN
                and table == "tender_occurrences"
            ):
                continue
            child_name = _target_table(handle, table)
            parent_name = _target_table(handle, parent_table)
            row = connection.execute(
                """
                SELECT COUNT(*) AS row_count
                FROM %s AS child
                LEFT JOIN %s AS parent
                  ON parent.%s = child.%s
                WHERE parent.%s IS NULL
                """
                % (
                    child_name,
                    parent_name,
                    parent_column,
                    source_column,
                    parent_column,
                )
            ).fetchone()
            if _count_value(row) != 0:
                raise ImportSafetyError(
                    "%s.%s has foreign-key violations" % (manifest.dataset, table)
                )


def _ensure_main_occurrence_constraint(connection: Any) -> None:
    existing = connection.execute(
        """
        SELECT convalidated
        FROM pg_constraint
        WHERE conname = %s
          AND conrelid = 'main.tender_occurrences'::regclass
        """,
        ("tender_occurrences_tender_fk",),
    ).fetchone()
    if existing is None:
        connection.execute(
            """
            ALTER TABLE main.tender_occurrences
            ADD CONSTRAINT tender_occurrences_tender_fk
            FOREIGN KEY (tender_id) REFERENCES main.tenders(tender_id)
            NOT VALID
            """
        )
    else:
        validated = (
            existing["convalidated"]
            if isinstance(existing, Mapping)
            else existing[0]
        )
        if validated:
            raise ImportSafetyError(
                "main occurrence foreign key is validated; orphan preservation "
                "requires an unvalidated constraint"
            )


class PostgreSQLImporter:
    """Import validated SQLite snapshots into empty, pre-created target schemas."""

    def __init__(
        self,
        main_database: Path,
        location_database: Path,
        main_handle: Any,
        location_handle: Any,
    ) -> None:
        self.main_database = main_database
        self.location_database = location_database
        self.main_handle = main_handle
        self.location_handle = location_handle

    def preflight(self) -> tuple[SourceImportSummary, SourceImportSummary]:
        return preflight_sources(self.main_database, self.location_database)

    def apply(self) -> tuple[SourceImportSummary, SourceImportSummary]:
        main_snapshot = _read_source_snapshot(self.main_database, DATASET_MAIN)
        location_snapshot = _read_source_snapshot(
            self.location_database, DATASET_LOCATION
        )
        with self.main_handle.transaction() as connection:
            _assert_target_empty(connection, self.main_handle, main_snapshot.manifest)
            _assert_target_empty(
                connection, self.location_handle, location_snapshot.manifest
            )
            _insert_snapshot(connection, self.main_handle, main_snapshot)
            _insert_snapshot(connection, self.location_handle, location_snapshot)
            _advance_identity_sequences(
                connection, self.main_handle, main_snapshot.manifest
            )
            _advance_identity_sequences(
                connection, self.location_handle, location_snapshot.manifest
            )
            _verify_target_snapshot(
                connection, self.main_handle, main_snapshot
            )
            _verify_target_snapshot(
                connection, self.location_handle, location_snapshot
            )
            _verify_foreign_keys(
                connection, self.main_handle, main_snapshot.manifest
            )
            _verify_foreign_keys(
                connection, self.location_handle, location_snapshot.manifest
            )
            _ensure_main_occurrence_constraint(connection)
        return main_snapshot.summary, location_snapshot.summary


def _format_summary(summary: SourceImportSummary) -> str:
    return json.dumps(summary.as_dict(), ensure_ascii=False, indent=2)


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="Preflight or import MahaTenders SQLite data safely"
    )
    root = Path(__file__).resolve().parent
    parser.add_argument(
        "--main-database",
        type=Path,
        default=root / "data" / "mahatenders.sqlite3",
    )
    parser.add_argument(
        "--location-database",
        type=Path,
        default=root / "data" / "location_ui_test.sqlite3",
    )
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument(
        "--preflight",
        action="store_true",
        help="inspect and hash SQLite sources without accessing PostgreSQL",
    )
    mode.add_argument(
        "--apply",
        action="store_true",
        help="import into pre-created empty PostgreSQL schemas",
    )
    args = parser.parse_args(argv)
    if not args.apply:
        try:
            summaries = preflight_sources(
                args.main_database,
                args.location_database,
            )
        except (SchemaValidationError, ImportSafetyError, FileNotFoundError) as exc:
            print("PREFLIGHT FAILED: %s" % exc, file=sys.stderr)
            return 1
        for summary in summaries:
            print(_format_summary(summary))
        return 0

    try:
        from .db import DatabaseManager
    except ImportError as exc:
        raise RuntimeError(
            "PostgreSQL apply mode requires package execution and psycopg support"
        ) from exc

    manager = DatabaseManager.from_env()
    try:
        importer = PostgreSQLImporter(
            args.main_database,
            args.location_database,
            manager.main,
            manager.location_ui,
        )
        summaries = importer.apply()
        for summary in summaries:
            print(_format_summary(summary))
    finally:
        manager.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
