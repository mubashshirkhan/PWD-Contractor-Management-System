"""PostgreSQL persistence repositories for MahaTenders extraction.

The repositories contain database operations only. Portal communication,
parsing, classification, and evidence sanitization remain in ``discover``.
"""

from __future__ import annotations

import json
from typing import Any, Dict, Optional

try:
    from .db import DatabaseHandle, DatabaseManager
    from .discover import (
        ListingPage,
        Organisation,
        Tender,
        now,
        safe_url_for_log,
        sanitize_evidence_value,
    )
except ImportError:
    from db import DatabaseHandle, DatabaseManager
    from discover import (
        ListingPage,
        Organisation,
        Tender,
        now,
        safe_url_for_log,
        sanitize_evidence_value,
    )


class _ExtractionRepository:
    """Shared persistence implementation for one configured schema handle."""

    def __init__(self, handle: DatabaseHandle) -> None:
        self.handle = handle

    def start_run(self, max_organisations: int, max_pages: int, max_details: int) -> int:
        """Create a running extraction and return its database ID."""

        with self.handle.transaction() as connection:
            row = connection.execute(
                """
                INSERT INTO %s.extraction_runs
                    (started_at, max_organisations, max_pages_per_organisation,
                     max_details_per_organisation, status)
                VALUES (%%s, %%s, %%s, %%s, %%s)
                RETURNING id
                """
                % self.handle.schema,
                (now(), max_organisations, max_pages, max_details, "RUNNING"),
            ).fetchone()
            if row is None:
                raise RuntimeError("PostgreSQL did not return the extraction run ID")
            return int(row["id"])

    def save_organisation(self, organisation: Organisation, run_id: int) -> None:
        """Upsert an organisation and associate it with an extraction run."""

        with self.handle.transaction() as connection:
            connection.execute(
                """
                INSERT INTO %s.organisations
                    (name, tender_count, source_url, count_url, observed_at)
                VALUES (%%s, %%s, %%s, %%s, %%s)
                ON CONFLICT (name) DO UPDATE SET
                    tender_count = EXCLUDED.tender_count,
                    source_url = EXCLUDED.source_url,
                    count_url = EXCLUDED.count_url,
                    observed_at = EXCLUDED.observed_at
                """
                % self.handle.schema,
                (
                    organisation.name,
                    organisation.tender_count,
                    organisation.source_url,
                    organisation.count_url,
                    now(),
                ),
            )
            connection.execute(
                """
                INSERT INTO %s.run_organisations
                    (run_id, organisation_name, status)
                VALUES (%%s, %%s, %%s)
                ON CONFLICT (run_id, organisation_name) DO NOTHING
                """
                % self.handle.schema,
                (run_id, organisation.name, "DISCOVERED"),
            )

    def update_organisation_status(self, run_id: int, name: str, status: str) -> None:
        """Update the status of an organisation within an extraction run."""

        with self.handle.transaction() as connection:
            connection.execute(
                """
                UPDATE %s.run_organisations
                SET status = %%s
                WHERE run_id = %%s AND organisation_name = %%s
                """
                % self.handle.schema,
                (status, run_id, name),
            )

    def save_page(self, run_id: int, page: ListingPage) -> None:
        """Persist one listing page for an extraction run."""

        with self.handle.transaction() as connection:
            connection.execute(
                """
                INSERT INTO %s.listing_pages
                    (run_id, organisation_name, page_number, source_url,
                     tender_count, page_fingerprint, next_url, observed_at)
                VALUES (%%s, %%s, %%s, %%s, %%s, %%s, %%s, %%s)
                """
                % self.handle.schema,
                (
                    run_id,
                    page.organisation,
                    page.page_number,
                    page.url,
                    page.tender_count,
                    page.fingerprint,
                    page.next_url,
                    page.observed_at,
                ),
            )

    def finish_run(self, run_id: int, summary: Dict[str, object], status: str) -> None:
        """Mark an extraction run complete and preserve its JSON summary."""

        with self.handle.transaction() as connection:
            connection.execute(
                """
                UPDATE %s.extraction_runs
                SET finished_at = %%s, status = %%s, summary_json = %%s
                WHERE id = %%s
                """
                % self.handle.schema,
                (
                    now(),
                    status,
                    json.dumps(summary, ensure_ascii=False),
                    run_id,
                ),
            )

    def save_error(
        self,
        run_id: int,
        organisation: Optional[str],
        stage: str,
        message: str,
        started_at: str,
    ) -> None:
        """Persist one extraction error with its start and finish timestamps."""

        with self.handle.transaction() as connection:
            connection.execute(
                """
                INSERT INTO %s.extraction_errors
                    (run_id, organisation_name, stage, message, started_at, finished_at)
                VALUES (%%s, %%s, %%s, %%s, %%s, %%s)
                """
                % self.handle.schema,
                (run_id, organisation, stage, message, started_at, now()),
            )

    def save_tender(self, tender: Tender) -> None:
        """Upsert a tender and persist its sanitized evidence in one transaction."""

        tender_values = (
            tender.tender_id,
            tender.reference_number,
            tender.title,
            tender.organisation_chain,
            tender.published_at,
            tender.closing_at,
            tender.opening_at,
            tender.estimated_value,
            tender.product_category,
            tender.location_raw,
            tender.location_city_village,
            tender.location_taluka,
            tender.location_district,
            tender.location_state,
            tender.location_provenance,
            tender.location_confidence,
            tender.scope_status,
            tender.scope_district,
            tender.scope_taluka,
            tender.scope_provenance,
            tender.source_listing_url,
            tender.source_detail_url,
            tender.observed_at,
        )
        schema = self.handle.schema
        with self.handle.transaction() as connection:
            connection.execute(
                """
                INSERT INTO %s.tenders
                    (tender_id, reference_number, title, organisation_chain,
                     published_at, closing_at, opening_at, estimated_value,
                     product_category, location_raw, location_city_village,
                     location_taluka, location_district, location_state,
                     location_provenance, location_confidence, scope_status,
                     scope_district, scope_taluka, scope_provenance,
                     source_listing_url, source_detail_url, observed_at)
                VALUES (%%s, %%s, %%s, %%s, %%s, %%s, %%s, %%s, %%s, %%s, %%s,
                        %%s, %%s, %%s, %%s, %%s, %%s, %%s, %%s, %%s, %%s, %%s,
                        %%s)
                ON CONFLICT (tender_id) DO UPDATE SET
                    reference_number = EXCLUDED.reference_number,
                    title = EXCLUDED.title,
                    organisation_chain = EXCLUDED.organisation_chain,
                    published_at = EXCLUDED.published_at,
                    closing_at = EXCLUDED.closing_at,
                    opening_at = EXCLUDED.opening_at,
                    estimated_value = EXCLUDED.estimated_value,
                    product_category = EXCLUDED.product_category,
                    location_raw = EXCLUDED.location_raw,
                    location_city_village = EXCLUDED.location_city_village,
                    location_taluka = EXCLUDED.location_taluka,
                    location_district = EXCLUDED.location_district,
                    location_state = EXCLUDED.location_state,
                    location_provenance = EXCLUDED.location_provenance,
                    location_confidence = EXCLUDED.location_confidence,
                    scope_status = EXCLUDED.scope_status,
                    scope_district = EXCLUDED.scope_district,
                    scope_taluka = EXCLUDED.scope_taluka,
                    scope_provenance = EXCLUDED.scope_provenance,
                    source_listing_url = EXCLUDED.source_listing_url,
                    source_detail_url = EXCLUDED.source_detail_url,
                    observed_at = EXCLUDED.observed_at
                """
                % schema,
                tender_values,
            )

            evidence_source = safe_url_for_log(tender.source_detail_url)
            for field_name, raw_value, method in self._evidence_rows(tender):
                if raw_value is None:
                    continue
                sanitized_value = sanitize_evidence_value(field_name, raw_value)
                connection.execute(
                    """
                    INSERT INTO %s.source_evidence
                        (tender_id, field_name, raw_value, source_page,
                         extraction_method, observed_at)
                    SELECT %%s, %%s, %%s, %%s, %%s, %%s
                    WHERE NOT EXISTS (
                        SELECT 1
                        FROM %s.source_evidence
                        WHERE tender_id = %%s
                          AND field_name = %%s
                          AND raw_value IS NOT DISTINCT FROM %%s
                          AND source_page = %%s
                          AND extraction_method = %%s
                    )
                    """
                    % (schema, schema),
                    (
                        tender.tender_id,
                        field_name,
                        sanitized_value,
                        evidence_source,
                        method,
                        tender.observed_at,
                        tender.tender_id,
                        field_name,
                        sanitized_value,
                        evidence_source,
                        method,
                    ),
                )

    @staticmethod
    def _evidence_rows(tender: Tender) -> tuple[tuple[str, Optional[str], str], ...]:
        """Return the same evidence fields and provenance as the SQLite store."""

        classification = json.dumps(
            {
                "scope_status": tender.scope_status,
                "scope_district": tender.scope_district,
                "scope_taluka": tender.scope_taluka,
                "scope_provenance": tender.scope_provenance,
            },
            ensure_ascii=False,
            sort_keys=True,
        )
        return (
            ("Location", tender.location_raw, "detail.label"),
            ("Tender Value in ₹", tender.estimated_value, "detail.label"),
            ("Organisation Chain", tender.organisation_chain, "detail.label"),
            (
                "__detail_html_sanitized__",
                tender.detail_html_sanitized,
                "detail.html.sanitized",
            ),
            ("__detail_labels_json__", tender.detail_labels_json, "detail.labels.json"),
            (
                "__detail_sections_json__",
                tender.detail_sections_json,
                "detail.sections.json",
            ),
            ("__classification__", classification, "detail.classification"),
        )

    def save_tender_occurrence(
        self,
        tender_id: str,
        search_taluka: str,
        source_listing_url: str,
        page_number: int,
    ) -> None:
        """Persist a listing occurrence.

        The main schema intentionally permits historical orphan occurrences
        until its post-import ``NOT VALID`` foreign key is explicitly
        resolved and validated.
        """

        with self.handle.transaction() as connection:
            connection.execute(
                """
                INSERT INTO %s.tender_occurrences
                    (tender_id, search_taluka, source_listing_url,
                     page_number, observed_at)
                VALUES (%%s, %%s, %%s, %%s, %%s)
                ON CONFLICT (tender_id, search_taluka, source_listing_url)
                    DO NOTHING
                """
                % self.handle.schema,
                (tender_id, search_taluka, source_listing_url, page_number, now()),
            )


class MainExtractionRepository(_ExtractionRepository):
    """Extraction repository backed by the PostgreSQL ``main`` schema."""

    def __init__(self, database: DatabaseManager | DatabaseHandle) -> None:
        handle = database.main if isinstance(database, DatabaseManager) else database
        if handle.schema != "main":
            raise ValueError("MainExtractionRepository requires the main schema")
        super().__init__(handle)


class LocationExtractionRepository(_ExtractionRepository):
    """Extraction repository backed by the PostgreSQL ``location_ui`` schema."""

    def __init__(self, database: DatabaseManager | DatabaseHandle) -> None:
        handle = (
            database.location_ui
            if isinstance(database, DatabaseManager)
            else database
        )
        if handle.schema != "location_ui":
            raise ValueError(
                "LocationExtractionRepository requires the location_ui schema"
            )
        super().__init__(handle)


_TENDER_COLUMNS = (
    "tender_id, reference_number, title, organisation_chain, "
    "published_at, closing_at, opening_at, estimated_value, product_category, "
    "location_raw, location_city_village, location_taluka, location_district, "
    "location_state, location_provenance, location_confidence, scope_status, "
    "scope_district, scope_taluka, scope_provenance, source_listing_url, "
    "source_detail_url, observed_at"
)


class _ReadRepository:
    """Schema-qualified read operations shared by the two API datasets."""

    def __init__(self, handle: DatabaseHandle) -> None:
        self.handle = handle

    def _scope_sql(
        self,
        talukas: list[str],
        district: Optional[str],
        taluka: Optional[str],
        alias: str = "t",
    ) -> tuple[str, list[object]]:
        district_placeholders = ", ".join(["%s", "%s"])
        taluka_placeholders = ", ".join(["%s"] * len(talukas))
        clauses = [
            "%s.scope_status = 'IN_SCOPE'" % alias,
            "%s.scope_district IN (%s)" % (alias, district_placeholders),
            "%s.scope_taluka IN (%s)" % (alias, taluka_placeholders),
        ]
        values: list[object] = ["Wardha", "Amravati", *talukas]
        if district:
            clauses.append("%s.scope_district = %%s" % alias)
            values.append(district)
        if taluka:
            clauses.append("%s.scope_taluka = %%s" % alias)
            values.append(taluka)
        return " AND ".join(clauses), values

    def _strict_tenders(
        self,
        talukas: list[str],
        district: Optional[str] = None,
        taluka: Optional[str] = None,
        search: Optional[str] = None,
        closing_before: Optional[str] = None,
        closing_after: Optional[str] = None,
        tender_id: Optional[str] = None,
    ) -> list[dict[str, object]]:
        clauses, values = self._scope_sql(talukas, district, taluka)
        if search:
            clauses += (
                " AND (LOWER(t.tender_id) LIKE %s"
                " OR LOWER(COALESCE(t.title, '')) LIKE %s"
                " OR LOWER(COALESCE(t.location_raw, '')) LIKE %s)"
            )
            needle = "%" + search.casefold() + "%"
            values.extend((needle, needle, needle))
        if closing_before:
            clauses += " AND t.closing_at <= %s"
            values.append(closing_before)
        if closing_after:
            clauses += " AND t.closing_at >= %s"
            values.append(closing_after)
        if tender_id:
            clauses += " AND t.tender_id = %s"
            values.append(tender_id)
        statement = (
            "SELECT %s FROM %s.tenders AS t WHERE %s "
            "ORDER BY CASE WHEN t.closing_at IS NULL THEN 1 ELSE 0 END, "
            "t.closing_at, t.tender_id"
            % (_TENDER_COLUMNS, self.handle.schema, clauses)
        )
        with self.handle.transaction(read_only=True) as connection:
            return [dict(row) for row in connection.execute(statement, values).fetchall()]

    def tenders(
        self,
        talukas: list[str],
        district: Optional[str] = None,
        taluka: Optional[str] = None,
        search: Optional[str] = None,
        closing_before: Optional[str] = None,
        closing_after: Optional[str] = None,
    ) -> list[dict[str, object]]:
        return self._strict_tenders(
            talukas,
            district,
            taluka,
            search,
            closing_before,
            closing_after,
        )

    def tender(
        self,
        tender_id: str,
        talukas: list[str],
    ) -> Optional[dict[str, object]]:
        records = self._strict_tenders(talukas, tender_id=tender_id)
        return records[0] if records else None

    def organisations(self, talukas: list[str]) -> list[dict[str, object]]:
        clauses, values = self._scope_sql(talukas, None, None, alias="t")
        statement = """
            SELECT o.name, t.tender_id, o.source_url, o.count_url,
                   o.observed_at, t.location_raw, t.scope_district,
                   t.scope_taluka
            FROM %s.organisations AS o
            JOIN %s.tenders AS t
              ON t.organisation_chain LIKE '%%' || o.name || '%%'
             AND %s
            ORDER BY o.name, t.tender_id
        """ % (self.handle.schema, self.handle.schema, clauses)
        with self.handle.transaction(read_only=True) as connection:
            return [dict(row) for row in connection.execute(statement, values).fetchall()]

    def detail_fields(self, tender_id: str) -> dict[str, object]:
        statement = """
            SELECT raw_value
            FROM %s.source_evidence
            WHERE tender_id = %%s
              AND field_name = '__detail_labels_json__'
            ORDER BY id
        """ % self.handle.schema
        fields: dict[str, object] = {}
        with self.handle.transaction(read_only=True) as connection:
            rows = connection.execute(statement, (tender_id,)).fetchall()
        for row in rows:
            raw_value = row["raw_value"]
            try:
                parsed = json.loads(raw_value)
            except (TypeError, ValueError):
                continue
            if isinstance(parsed, dict):
                fields.update(parsed)
        return fields

    def location_run_details(
        self,
        run_id: int,
    ) -> tuple[Optional[dict[str, object]], list[dict[str, object]], dict[str, dict[str, object]]]:
        tender_columns = ", ".join(
            "t." + column.strip()
            for column in _TENDER_COLUMNS.split(",")
        )
        run_statement = """
            SELECT id, started_at, finished_at, status, summary_json
            FROM %s.extraction_runs
            WHERE id = %%s
        """ % self.handle.schema
        tender_statement = """
            SELECT DISTINCT ON (t.tender_id) %s
            FROM %s.tender_occurrences AS o
            JOIN %s.listing_pages AS p
              ON p.run_id = %%s
             AND p.organisation_name IN (
                 o.search_taluka, 'Location: ' || o.search_taluka
             )
             AND p.page_number = o.page_number
             AND p.source_url = o.source_listing_url
            JOIN %s.tenders AS t ON t.tender_id = o.tender_id
            WHERE p.run_id = %%s
            ORDER BY t.tender_id, o.search_taluka, o.page_number
        """ % (
            tender_columns,
            self.handle.schema,
            self.handle.schema,
            self.handle.schema,
        )
        with self.handle.transaction(read_only=True) as connection:
            run_row = connection.execute(run_statement, (run_id,)).fetchone()
            if run_row is None:
                return None, [], {}
            rows = [
                dict(row)
                for row in connection.execute(
                    tender_statement, (run_id, run_id)
                ).fetchall()
            ]
            if not rows:
                return dict(run_row), [], {}
            tender_ids = [row["tender_id"] for row in rows]
            placeholders = ", ".join(["%s"] * len(tender_ids))
            evidence_statement = """
                SELECT tender_id, raw_value
                FROM %s.source_evidence
                WHERE field_name = '__detail_labels_json__'
                  AND tender_id IN (%s)
                ORDER BY id
            """ % (self.handle.schema, placeholders)
            evidence_rows = connection.execute(
                evidence_statement, tender_ids
            ).fetchall()
        fields: dict[str, dict[str, object]] = {}
        for row in evidence_rows:
            target = fields.setdefault(row["tender_id"], {})
            try:
                parsed = json.loads(row["raw_value"])
            except (TypeError, ValueError):
                continue
            if isinstance(parsed, dict):
                target.update(parsed)
        return dict(run_row), rows, fields


class MainReadRepository(_ReadRepository):
    """Read repository bound to the PostgreSQL ``main`` schema."""

    def __init__(self, database: DatabaseManager | DatabaseHandle) -> None:
        handle = database.main if isinstance(database, DatabaseManager) else database
        if handle.schema != "main":
            raise ValueError("MainReadRepository requires the main schema")
        super().__init__(handle)


class LocationReadRepository(_ReadRepository):
    """Read repository bound to the PostgreSQL ``location_ui`` schema."""

    def __init__(self, database: DatabaseManager | DatabaseHandle) -> None:
        handle = (
            database.location_ui
            if isinstance(database, DatabaseManager)
            else database
        )
        if handle.schema != "location_ui":
            raise ValueError("LocationReadRepository requires the location_ui schema")
        super().__init__(handle)

