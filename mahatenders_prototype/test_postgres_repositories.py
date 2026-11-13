import unittest
from contextlib import contextmanager

from discover import ListingPage, Organisation, Tender
from postgres_repositories import (
    LocationExtractionRepository,
    MainExtractionRepository,
    MainReadRepository,
)
from scope import DISTRICT_TALUKAS


class FakeCursor:
    def __init__(self, row=None, rows=None):
        self.row = row
        self.rows = rows or []

    def fetchone(self):
        return self.row

    def fetchall(self):
        return self.rows


class FakeConnection:
    def __init__(self, fail_on_execute=None):
        self.statements = []
        self.fail_on_execute = fail_on_execute

    def execute(self, statement, params=()):
        self.statements.append((statement, params))
        if self.fail_on_execute == len(self.statements):
            raise RuntimeError("database write failed")
        if "RETURNING id" in statement:
            return FakeCursor({"id": 41})
        return FakeCursor()


class ReadFakeConnection(FakeConnection):
    def execute(self, statement, params=()):
        self.statements.append((statement, params))
        return FakeCursor(
            rows=[
                {
                    "name": "Public Works Department",
                    "tender_id": "TENDER-1",
                    "source_url": "https://example.test/organisations",
                    "count_url": "https://example.test/count",
                    "observed_at": "2026-11-12",
                    "location_raw": "Arvi",
                    "scope_district": "Wardha",
                    "scope_taluka": "Arvi",
                }
            ]
        )


class EmptyThenFallbackConnection(ReadFakeConnection):
    def execute(self, statement, params=()):
        self.statements.append((statement, params))
        if "regexp_replace" in statement:
            return FakeCursor(
                rows=[
                    {
                        "name": "Municipal Council, Arvi",
                        "tender_id": "TENDER-2",
                        "source_url": "https://example.test/detail",
                        "count_url": "https://example.test/list",
                        "observed_at": "2026-11-12",
                        "location_raw": "Arvi",
                        "location_city_village": "Arvi",
                        "location_taluka": "Arvi",
                        "location_district": "Wardha",
                        "scope_district": "Wardha",
                        "scope_taluka": "Arvi",
                    }
                ]
            )
        return FakeCursor()


class FakeHandle:
    def __init__(self, schema, connection=None):
        self.schema = schema
        self.connection = connection or FakeConnection()
        self.transaction_count = 0
        self.commit_count = 0
        self.rollback_count = 0

    @contextmanager
    def transaction(self, *, read_only=False):
        self.transaction_count += 1
        try:
            yield self.connection
        except Exception:
            self.rollback_count += 1
            raise
        else:
            self.commit_count += 1


def sample_organisation():
    return Organisation(
        name="Public Works Department",
        tender_count=3,
        source_url="https://example.test/organisations",
        count_url="https://example.test/count",
    )


def sample_page():
    return ListingPage(
        organisation="Public Works Department",
        page_number=1,
        url="https://example.test/list",
        tender_count=1,
        fingerprint="page-fingerprint",
        next_url=None,
        observed_at="2026-11-12T10:00:00+00:00",
    )


def sample_tender():
    return Tender(
        tender_id="2026_TEST_1_1",
        reference_number="REF-1",
        title="Arvi road work",
        organisation_chain="PWD||Wardha",
        published_at="12-Nov-2026 10:00 AM",
        closing_at="20-Nov-2026 03:00 PM",
        opening_at="21-Nov-2026 03:00 PM",
        estimated_value="100000",
        product_category="Civil Works",
        location_raw="Arvi",
        location_city_village="Arvi",
        location_taluka="Arvi",
        location_district="Wardha",
        location_state="Maharashtra",
        location_provenance="detail.location_explicit",
        location_confidence=1.0,
        scope_status="IN_SCOPE",
        scope_district="Wardha",
        scope_taluka="Arvi",
        scope_provenance="scope.taluka_explicit",
        source_listing_url="https://example.test/list",
        source_detail_url="https://example.test/detail",
        observed_at="2026-11-12T10:00:00+00:00",
        detail_html_sanitized="<p>safe</p>",
        detail_labels_json='{"Title": "Arvi road work"}',
        detail_sections_json='{"core": {"Title": "Arvi road work"}}',
    )


class PostgreSQLRepositoryTests(unittest.TestCase):
    def repositories(self):
        return (
            ("main", MainExtractionRepository, FakeHandle("main")),
            ("location_ui", LocationExtractionRepository, FakeHandle("location_ui")),
        )

    def test_repository_classes_keep_schema_isolation(self):
        for schema, repository_type, handle in self.repositories():
            with self.subTest(schema=schema):
                repository = repository_type(handle)
                self.assertIs(repository.handle, handle)
                self.assertEqual(repository.handle.schema, schema)

    def test_all_repository_methods_use_qualified_postgresql_sql(self):
        for schema, repository_type, handle in self.repositories():
            with self.subTest(schema=schema):
                repository = repository_type(handle)
                run_id = repository.start_run(1, 2, 3)
                repository.save_organisation(sample_organisation(), run_id)
                repository.save_page(run_id, sample_page())
                repository.finish_run(run_id, {"status": "DONE"}, "COMPLETED")
                repository.update_organisation_status(
                    run_id, "Public Works Department", "COMPLETED"
                )
                repository.save_error(
                    run_id,
                    "Public Works Department",
                    "listing",
                    "no error details leaked",
                    "2026-11-12T10:00:00+00:00",
                )
                repository.save_tender(sample_tender())
                repository.save_tender_occurrence(
                    "2026_TEST_1_1", "Arvi", "https://example.test/list", 1
                )

                self.assertEqual(run_id, 41)
                self.assertGreater(len(handle.connection.statements), 0)
                for statement, _ in handle.connection.statements:
                    self.assertIn(schema + ".", statement)
                    self.assertIn("%s", statement)
                    self.assertNotIn("?", statement)
                    self.assertNotIn("postgresql://", statement)

    def test_start_run_uses_returning_id(self):
        for schema, repository_type, handle in self.repositories():
            with self.subTest(schema=schema):
                self.assertEqual(repository_type(handle).start_run(2, 3, 4), 41)
                statement, params = handle.connection.statements[0]
                self.assertIn("RETURNING id", statement)
                self.assertEqual(params[1:], (2, 3, 4, "RUNNING"))

    def test_save_organisation_groups_upsert_and_run_association(self):
        for schema, repository_type, handle in self.repositories():
            with self.subTest(schema=schema):
                repository_type(handle).save_organisation(sample_organisation(), 41)
                self.assertEqual(handle.transaction_count, 1)
                self.assertEqual(handle.commit_count, 1)
                self.assertEqual(handle.rollback_count, 0)
                self.assertEqual(len(handle.connection.statements), 2)
                self.assertIn("ON CONFLICT (name) DO UPDATE", handle.connection.statements[0][0])
                self.assertIn(
                    "ON CONFLICT (run_id, organisation_name) DO NOTHING",
                    handle.connection.statements[1][0],
                )

    def test_save_tender_groups_tender_and_evidence_writes(self):
        for schema, repository_type, handle in self.repositories():
            with self.subTest(schema=schema):
                repository_type(handle).save_tender(sample_tender())
                self.assertEqual(handle.transaction_count, 1)
                self.assertEqual(handle.commit_count, 1)
                self.assertEqual(handle.rollback_count, 0)
                statements = [statement for statement, _ in handle.connection.statements]
                self.assertIn("ON CONFLICT (tender_id) DO UPDATE", statements[0])
                evidence_statements = statements[1:]
                self.assertEqual(len(evidence_statements), 7)
                for statement in evidence_statements:
                    self.assertIn("IS NOT DISTINCT FROM %s", statement)
                    self.assertIn("source_evidence", statement)

    def test_occurrence_insert_supports_main_historical_orphans(self):
        handle = FakeHandle("main")
        MainExtractionRepository(handle).save_tender_occurrence(
            "historical-orphan-id", "Arvi", "https://example.test/list", 7
        )
        statement, params = handle.connection.statements[0]
        self.assertIn("main.tender_occurrences", statement)
        self.assertIn(
            "ON CONFLICT (tender_id, search_taluka, source_listing_url)",
            statement,
        )
        self.assertIn("DO NOTHING", statement)
        self.assertEqual(params[:4], ("historical-orphan-id", "Arvi", "https://example.test/list", 7))
        self.assertEqual(handle.commit_count, 1)

    def test_failures_propagate_and_roll_back(self):
        for schema, repository_type, _ in self.repositories():
            with self.subTest(schema=schema):
                connection = FakeConnection(fail_on_execute=2)
                handle = FakeHandle(schema, connection)
                with self.assertRaisesRegex(RuntimeError, "database write failed") as raised:
                    repository_type(handle).save_organisation(sample_organisation(), 41)
                self.assertEqual(str(raised.exception), "database write failed")
                self.assertEqual(handle.commit_count, 0)
                self.assertEqual(handle.rollback_count, 1)
                self.assertNotIn("postgresql://", str(raised.exception))

    def test_organisations_uses_full_scope_filter(self):
        handle = FakeHandle("main", ReadFakeConnection())
        talukas = [
            taluka
            for district_talukas in DISTRICT_TALUKAS.values()
            for taluka in district_talukas
        ]

        rows = MainReadRepository(handle).organisations(talukas)

        self.assertEqual(rows[0]["tender_id"], "TENDER-1")
        statement, params = handle.connection.statements[0]
        self.assertIn("t.scope_district IN (%s, %s)", statement)
        self.assertNotIn("t.scope_taluka IN (", statement)
        self.assertIn("LIKE '%%' || o.name || '%%'", statement)
        self.assertEqual(params[:2], ["Wardha", "Amravati"])
        self.assertEqual(params[2:], [])

    def test_tenders_support_all_classification_modes_without_taluka_requirement(self):
        talukas = [
            taluka
            for district_talukas in DISTRICT_TALUKAS.values()
            for taluka in district_talukas
        ]
        for classification in ("ALL", "IN_SCOPE", "UNKNOWN"):
            handle = FakeHandle("main", ReadFakeConnection())
            MainReadRepository(handle).tenders(
                talukas, classification=classification
            )
            statement, _ = handle.connection.statements[0]
            with self.subTest(classification=classification):
                if classification == "UNKNOWN":
                    self.assertIn("t.scope_status = 'UNKNOWN'", statement)
                    self.assertNotIn("t.scope_district IN", statement)
                else:
                    self.assertIn("t.scope_district IN", statement)
                self.assertNotIn("t.scope_taluka IN", statement)

    def test_organisations_falls_back_to_tender_chain_when_directory_has_no_match(self):
        handle = FakeHandle("main", EmptyThenFallbackConnection())
        talukas = [
            taluka
            for district_talukas in DISTRICT_TALUKAS.values()
            for taluka in district_talukas
        ]

        rows = MainReadRepository(handle).organisations(talukas)

        self.assertEqual(rows[0]["name"], "Municipal Council, Arvi")
        self.assertEqual(len(handle.connection.statements), 2)
        self.assertIn("regexp_replace", handle.connection.statements[1][0])
        self.assertEqual(handle.connection.statements[1][1], handle.connection.statements[0][1])


if __name__ == "__main__":
    unittest.main()
