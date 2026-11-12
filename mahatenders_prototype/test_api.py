import json
import sqlite3
import tempfile
import threading
import unittest
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from pathlib import Path

from api import Handler, ScopedApi
from discover import DiscoveryStore


class ScopedApiTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.database = Path(self.directory.name) / "api.sqlite3"
        store = DiscoveryStore(self.database)
        store.close()
        connection = sqlite3.connect(self.database)
        connection.execute(
            """INSERT INTO tenders
               (tender_id, organisation_chain, location_raw, location_provenance, location_confidence,
                scope_status, scope_district, scope_taluka, scope_provenance,
                source_listing_url, source_detail_url, observed_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            ("IN_SCOPE_1", "test", "Arvi, Wardha", "test", 1.0, "IN_SCOPE", "Wardha", "Arvi", "test",
             "https://example.test/list", "https://example.test/detail", "2026-01-01"),
        )
        connection.execute(
            """INSERT INTO tenders
               (tender_id, organisation_chain, location_raw, location_provenance, location_confidence,
                scope_status, scope_district, scope_provenance,
                source_listing_url, source_detail_url, observed_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            ("OUT_SCOPE_1", "test", "Nashik", "test", 1.0, "OUT_OF_SCOPE", "Nashik", "test",
             "https://example.test/list", "https://example.test/detail", "2026-01-01"),
        )
        for tender_id, raw_location, district, taluka, status in (
            ("IN_SCOPE_2", "Tiwsa, Amravati", "Amravati", "Teosa", "IN_SCOPE"),
            ("PUNE_1", "Pune", None, None, "OUT_OF_SCOPE"),
            ("UNKNOWN_1", None, None, None, "UNKNOWN"),
        ):
            connection.execute(
                """INSERT INTO tenders
                   (tender_id, organisation_chain, location_raw, location_provenance,
                    location_confidence, scope_status, scope_district, scope_taluka,
                    scope_provenance, source_listing_url, source_detail_url, observed_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (tender_id, "test", raw_location, "test", 1.0, status, district, taluka, "test",
                 "https://example.test/list", "https://example.test/detail", "2026-01-01"),
            )
        connection.execute(
            """INSERT INTO organisations
               (name, tender_count, source_url, count_url, observed_at)
               VALUES (?, ?, ?, ?, ?)""",
            ("test", 999, "https://example.test/org", "https://example.test/count", "2026-01-01"),
        )
        connection.commit()
        connection.close()
        self.api = ScopedApi(self.database)

    def create_location_run(self, tenders):
        location_database = self.database.parent / "location_ui_test.sqlite3"
        store = DiscoveryStore(location_database)
        run_id = store.start_run(0, 0, 0)
        summary = {
            "run_id": run_id,
            "mode": "location",
            "status": "COMPLETED",
            "talukas_searched": ["Arvi"],
        }
        store.finish_run(run_id, summary, "COMPLETED")
        connection = sqlite3.connect(location_database)
        for page_number, tender in enumerate(tenders, start=1):
            connection.execute(
                """INSERT INTO listing_pages
                   (run_id, organisation_name, page_number, source_url, tender_count,
                    page_fingerprint, next_url, observed_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (run_id, "Arvi", page_number, tender["listing_url"], 1,
                 "fingerprint-%s" % page_number, None, "2026-01-01"),
            )
            connection.execute(
                """INSERT INTO tenders
                   (tender_id, reference_number, title, organisation_chain,
                    location_provenance, location_confidence, scope_status,
                    scope_district, scope_taluka, scope_provenance,
                    source_listing_url, source_detail_url, observed_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    tender["tender_id"], tender.get("reference_number"),
                    tender.get("title"), tender.get("organisation", "test"),
                    "detail.location_explicit", 1.0, tender.get("scope_status", "IN_SCOPE"),
                    tender.get("district", "Wardha"), tender.get("taluka", "Arvi"),
                    "test", tender["listing_url"], tender["detail_url"],
                    tender.get("observed_at", "2026-01-01"),
                ),
            )
            connection.execute(
                """INSERT INTO tender_occurrences
                   (tender_id, search_taluka, source_listing_url, page_number, observed_at)
                   VALUES (?, ?, ?, ?, ?)""",
                (tender["tender_id"], "Arvi", tender["listing_url"], page_number, "2026-01-01"),
            )
            if "evidence" in tender:
                connection.execute(
                    """INSERT INTO source_evidence
                       (tender_id, field_name, raw_value, source_page,
                        extraction_method, observed_at)
                       VALUES (?, '__detail_labels_json__', ?, ?, 'detail.labels.json', ?)""",
                    (
                        tender["tender_id"], tender["evidence"], tender["detail_url"],
                        tender.get("observed_at", "2026-01-01"),
                    ),
                )
        connection.commit()
        connection.close()
        store.close()
        return run_id

    def tearDown(self):
        self.directory.cleanup()

    def test_location_search_details_returns_dynamic_fields_and_job_metadata(self):
        run_id = self.create_location_run([
            {
                "tender_id": "JOB_1",
                "title": "Road work",
                "reference_number": "REF-1",
                "organisation": "PWD||Wardha",
                "listing_url": "https://example.test/list?page=1",
                "detail_url": "https://example.test/detail?session=secret&sp=token&x=1",
                "evidence": json.dumps({"Tender Type": "Open Tender", "No. of Covers": "2"}),
            },
            {
                "tender_id": "JOB_2",
                "title": "Bridge work",
                "listing_url": "https://example.test/list?page=2",
                "detail_url": "https://example.test/detail?session=secret2",
                "evidence": json.dumps({"Payment Mode": "Online"}),
            },
        ])

        status, body = self.api.response(
            "/api/v1/location-search/runs/%s/tenders" % run_id, {}
        )

        self.assertEqual(status, 200)
        self.assertEqual(body["job"]["run_id"], run_id)
        self.assertEqual(body["total_tender_count"], 2)
        self.assertEqual([row["tender_id"] for row in body["tenders"]], ["JOB_1", "JOB_2"])
        self.assertEqual(body["tenders"][0]["detail_fields"]["Tender Type"], "Open Tender")
        self.assertEqual(body["tenders"][0]["detail_fields"]["No. of Covers"], "2")
        self.assertNotIn("session", body["tenders"][0]["source"]["url"])
        self.assertNotIn("sp=", body["tenders"][0]["source"]["url"])
        self.assertIn("x=1", body["tenders"][0]["source"]["url"])
        self.assertEqual(body["tenders"][0]["source"]["evidence_type"], "detail.labels.json")

    def test_location_search_details_isolated_between_jobs(self):
        first_run = self.create_location_run([{
            "tender_id": "FIRST_JOB",
            "listing_url": "https://example.test/first",
            "detail_url": "https://example.test/first-detail",
            "evidence": json.dumps({"Field": "first"}),
        }])
        second_run = self.create_location_run([{
            "tender_id": "SECOND_JOB",
            "listing_url": "https://example.test/second",
            "detail_url": "https://example.test/second-detail",
            "evidence": json.dumps({"Field": "second"}),
        }])

        status, first = self.api.response(
            "/api/v1/location-search/runs/%s/tenders" % first_run, {}
        )
        self.assertEqual(status, 200)
        self.assertEqual([row["tender_id"] for row in first["tenders"]], ["FIRST_JOB"])
        status, second = self.api.response(
            "/api/v1/location-search/runs/%s/tenders" % second_run, {}
        )
        self.assertEqual(status, 200)
        self.assertEqual([row["tender_id"] for row in second["tenders"]], ["SECOND_JOB"])

    def test_location_search_details_handles_malformed_and_missing_evidence(self):
        run_id = self.create_location_run([
            {
                "tender_id": "MALFORMED",
                "title": None,
                "listing_url": "https://example.test/malformed",
                "detail_url": "https://example.test/malformed-detail",
                "evidence": "{not-json",
            },
            {
                "tender_id": "MISSING_EVIDENCE",
                "listing_url": "https://example.test/missing",
                "detail_url": "https://example.test/missing-detail",
            },
        ])

        status, body = self.api.response(
            "/api/v1/location-search/runs/%s/tenders" % run_id, {}
        )

        self.assertEqual(status, 200)
        self.assertEqual(body["total_tender_count"], 2)
        self.assertEqual(body["tenders"][0]["detail_fields"], {})
        self.assertIsNone(body["tenders"][0]["title"])
        self.assertEqual(body["tenders"][1]["detail_fields"], {})

    def test_empty_location_search_details_returns_empty_list(self):
        run_id = self.create_location_run([])

        status, body = self.api.response(
            "/api/v1/location-search/runs/%s/tenders" % run_id, {}
        )

        self.assertEqual(status, 200)
        self.assertEqual(body["total_tender_count"], 0)
        self.assertEqual(body["tenders"], [])

    def test_tenders_exclude_out_of_scope_records(self):
        status, body = self.api.response("/api/v1/tenders", {})
        self.assertEqual(status, 200)
        self.assertEqual(
            [row["tender_id"] for row in body["tenders"]],
            ["IN_SCOPE_1", "IN_SCOPE_2"],
        )

    def test_both_allowed_districts_are_accessible(self):
        for district, tender_id in (("Wardha", "IN_SCOPE_1"), ("Amravati", "IN_SCOPE_2")):
            status, body = self.api.response("/api/v1/tenders", {"district": [district]})
            self.assertEqual(status, 200)
            self.assertEqual([row["tender_id"] for row in body["tenders"]], [tender_id])

    def test_invalid_filters_are_rejected(self):
        for query in (
            {"district": ["Pune"]},
            {"district": ["Nashik"]},
            {"taluka": ["Pune"]},
            {"district": ["Wardha"], "taluka": ["Teosa"]},
            {"district": [""]},
            {"taluka": [""]},
        ):
            status, body = self.api.response("/api/v1/tenders", query)
            self.assertEqual(status, 400)
            self.assertIn("error", body)

    def test_taluka_alias_filter_is_canonicalized(self):
        status, body = self.api.response("/api/v1/tenders", {"district": ["Wardha"], "taluka": ["Arvi"]})
        self.assertEqual(status, 200)
        self.assertEqual(body["count"], 1)

    def test_unknown_and_out_of_scope_detail_are_not_returned(self):
        for tender_id in ("OUT_SCOPE_1", "PUNE_1", "UNKNOWN_1"):
            status, _ = self.api.response("/api/v1/tenders/" + tender_id, {})
            self.assertEqual(status, 404)

    def test_explicit_district_detail_is_returned(self):
        connection = sqlite3.connect(self.database)
        connection.execute(
            """INSERT INTO tenders
               (tender_id, organisation_chain, location_raw, location_provenance,
                location_confidence, scope_status, scope_district, scope_taluka,
                scope_provenance, source_listing_url, source_detail_url, observed_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            ("STALE_1", "test", "Amravati", "test", 1.0, "IN_SCOPE", "Amravati",
             "Amravati", "test", "https://example.test/list",
             "https://example.test/detail", "2026-01-01"),
        )
        connection.commit()
        connection.close()
        status, _ = self.api.response("/api/v1/tenders/STALE_1", {})
        self.assertEqual(status, 200)

    def test_stats_and_organisations_are_scope_filtered(self):
        status, stats = self.api.response("/api/v1/stats", {})
        self.assertEqual(status, 200)
        self.assertEqual({row["district"] for row in stats["districts"]}, {"Amravati", "Wardha"})
        self.assertEqual(sum(row["tender_count"] for row in stats["talukas"]), 2)

        status, organisations = self.api.response("/api/v1/organisations", {})
        self.assertEqual(status, 200)
        self.assertEqual(organisations["count"], 1)
        self.assertEqual(organisations["organisations"][0]["tender_count"], 2)
        self.assertNotEqual(organisations["organisations"][0]["tender_count"], 999)

    def test_scoped_api_opens_database_read_only(self):
        connection = self.api.connection()
        with self.assertRaises(Exception):
            connection.execute("INSERT INTO tenders (tender_id, organisation_chain, location_provenance, location_confidence, source_listing_url, source_detail_url, observed_at) VALUES ('WRITE_TEST', 'test', 'test', 1, 'x', 'y', 'z')")
        connection.close()

    def test_location_search_validates_scope_before_running_portal_request(self):
        calls = []

        def runner(taluka, options):
            calls.append((taluka, options))
            return {"status": "COMPLETED", "talukas_searched": [taluka]}

        api = ScopedApi(self.database, location_runner=runner)
        status, body = api.post_response(
            "/api/v1/location-search",
            {"district": "Wardha", "taluka": "Teosa", "human_captcha": True},
        )
        self.assertEqual(status, 400)
        self.assertEqual(calls, [])
        self.assertIn("error", body)

    def test_location_search_canonicalizes_alias_and_passes_captcha_option(self):
        calls = []

        def runner(taluka, options):
            calls.append((taluka, options))
            return {"status": "COMPLETED", "talukas_searched": [taluka]}

        api = ScopedApi(self.database, location_runner=runner)
        status, body = api.post_response(
            "/api/v1/location-search",
            {"district": "Amravati", "taluka": "Tiwsa", "human_captcha": True},
        )
        self.assertEqual(status, 200)
        self.assertEqual(body["talukas_searched"], ["Teosa"])
        self.assertEqual(calls[0][0], "Teosa")
        self.assertTrue(calls[0][1]["human_captcha"])
        self.assertIsNone(calls[0][1]["max_pages_per_taluka"])

    def test_empty_location_summary_remains_completed(self):
        def runner(taluka, options):
            return {
                "status": "COMPLETED",
                "listing_pages_processed": 1,
                "tender_ids_discovered": 0,
                "tender_details_retrieved": 0,
                "errors": [],
                "message": "No tenders found for this taluka.",
                "taluka": taluka,
            }

        api = ScopedApi(self.database, location_runner=runner)
        status, body = api.post_response(
            "/api/v1/location-search",
            {"district": "Wardha", "taluka": "Seloo"},
        )
        self.assertEqual(status, 200)
        self.assertEqual(body["status"], "COMPLETED")
        self.assertEqual(body["message"], "No tenders found for this taluka.")
        self.assertEqual(body["errors"], [])

    def test_browser_captcha_routes_keep_reference_and_answer_server_side(self):
        class FakeManager:
            def __init__(self):
                self.calls = []

            def start(self, district, taluka, options):
                self.calls.append(("start", district, taluka, options))
                return {
                    "reference": "temporary-reference",
                    "status": "CAPTCHA_REQUIRED",
                    "captcha": {"image": "data:image/png;base64,abc"},
                }

            def answer(self, reference, answer):
                self.calls.append(("answer", reference, answer))
                return 200, {"reference": reference, "status": "RUNNING"}

            def status(self, reference):
                return 200, {"reference": reference, "status": "RUNNING"}

            def cancel(self, reference):
                self.calls.append(("cancel", reference))
                return 200, {"reference": reference, "status": "CANCELLED"}

        manager = FakeManager()
        api = ScopedApi(self.database, location_manager=manager)
        status, started = api.post_response(
            "/api/v1/location-search/start",
            {"district": "Wardha", "taluka": "Arvi", "human_captcha": True},
        )
        self.assertEqual(status, 200)
        self.assertEqual(started["status"], "CAPTCHA_REQUIRED")
        self.assertNotIn("tokenSecret", str(started))
        status, continued = api.post_response(
            "/api/v1/location-search/temporary-reference/captcha",
            {"answer": "human-answer"},
        )
        self.assertEqual(status, 200)
        self.assertEqual(continued["reference"], "temporary-reference")
        self.assertEqual(manager.calls[-1][1:], ("temporary-reference", "human-answer"))
        status, cancelled = api.post_response(
            "/api/v1/location-search/temporary-reference/cancel", {}
        )
        self.assertEqual(status, 200)
        self.assertEqual(cancelled["status"], "CANCELLED")

    def test_expired_browser_captcha_reference_is_rejected(self):
        class ExpiredManager:
            def answer(self, reference, answer):
                return 404, {"error": "location search session expired or not found"}

        api = ScopedApi(self.database, location_manager=ExpiredManager())
        status, body = api.post_response(
            "/api/v1/location-search/expired/captcha", {"answer": "x"}
        )
        self.assertEqual(status, 404)
        self.assertIn("expired", body["error"])

    def test_http_post_and_unsupported_methods_return_json(self):
        Handler.api = ScopedApi(self.database)
        Handler.cors_origin = "http://127.0.0.1:5501"
        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            connection = HTTPConnection("127.0.0.1", server.server_port, timeout=5)
            connection.request(
                "POST", "/api/v1/location-search/start",
                body=b'{"district":"Pune","taluka":"Arvi"}',
                headers={"Content-Type": "application/json"},
            )
            response = connection.getresponse()
            body = response.read().decode("utf-8")
            self.assertEqual(response.status, 400)
            self.assertTrue(body.startswith("{"))
            self.assertIn("district and taluka", body)
            connection.request("PUT", "/api/v1/location-search/start")
            response = connection.getresponse()
            body = response.read().decode("utf-8")
            self.assertEqual(response.status, 405)
            self.assertTrue(body.startswith("{"))
            self.assertIn("method not allowed", body)
            connection.close()
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)


if __name__ == "__main__":
    unittest.main()
