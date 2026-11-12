import sqlite3
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from discover import (
    CaptchaRequired,
    DiscoveryError,
    DiscoveryStore,
    ListingPage,
    LocationSearch,
    MahaTendersClient,
    Tender,
    configured_location_searches,
    find_next_url,
    find_location_page_url,
    find_captcha_image_url,
    no_tenders_found_message,
    location_search_for,
    location_fields,
    parse_form_fields,
    parse_detail_sections,
    session_expired,
    parse_labeled_rows,
    parse_listing_rows,
    parse_organisation_rows,
    parse_tables,
    parse_tender_id,
    run_location_discovery,
    sanitize_detail_html,
    sanitize_labels,
    safe_url_for_log,
)
from scope import DISTRICT_TALUKAS, canonical_taluka, classify_location


class ParserTests(unittest.TestCase):
    def test_extracts_tender_id(self):
        self.assertEqual(parse_tender_id("[Notice][2026_PWDM_1353319_1]"), "2026_PWDM_1353319_1")

    def test_extracts_multiple_label_value_pairs(self):
        html = """
        <table><tr>
          <td>Tender Value in ₹</td><td>28,82,333</td>
          <td>Product Category</td><td>Electrical Works</td>
        </tr></table>
        """
        rows = parse_tables(html)
        self.assertEqual(
            parse_labeled_rows(rows),
            {"Tender Value in ₹": "28,82,333", "Product Category": "Electrical Works"},
        )

    def test_detail_sections_separate_core_and_portal_tables(self):
        html = """
        <td class="textbold1">Basic Details</td>
        <table class="tablebg">
          <tr><td>Organisation Chain</td><td>Municipal Administration, Wardha</td></tr>
          <tr><td>Tender ID</td><td>2026_DMA_1_1</td>
              <td>Optional Field</td><td>Present</td></tr>
        </table>
        <table id="onlineInstrumentsTableView" class="list_table">
          <tr><td>S.No</td><td>Bank Name</td></tr>
          <tr><td>1</td><td>SBI Bank</td></tr>
        </table>
        <table id="packetTableView">
          <tr><td>Cover No</td><td>Cover Type</td><td>Description</td><td>Document Type</td></tr>
          <tr><td>1</td><td>Finance</td><td>Upload BOQ</td><td>.xls</td></tr>
        </table>
        <table class="tablebg">
          <tr><td>Location</td><td>ARVI</td><td>Pincode</td><td>442201</td></tr>
          <tr><td>Title</td><td>Road work</td></tr>
        </table>
        <td class="textbold1">Tenders Documents</td>
        <table id="workItemDocumenttable" class="list_table">
          <tr><td>S.No</td><td>Document Name</td><td>Description</td></tr>
          <tr><td>1</td><td>BOQ.xls</td><td>BOQ</td></tr>
        </table>
        <div>Portal announcement should not be a field.</div>
        """

        sections = parse_detail_sections(html)

        self.assertEqual(sections["core"]["Tender ID"], "2026_DMA_1_1")
        self.assertEqual(sections["core"]["Location"], "ARVI")
        self.assertEqual(sections["core"]["Optional Field"], "Present")
        self.assertNotIn("S.No", sections["core"])
        self.assertNotIn("Bank Name", sections["core"])
        self.assertNotIn("Cover No", sections["core"])
        self.assertNotIn("Portal announcement", sections["core"])
        self.assertEqual(sections["covers"][0]["Cover Type"], "Finance")
        self.assertEqual(sections["payments"][0]["Bank Name"], "SBI Bank")
        self.assertEqual(sections["documents"][0]["Document Name"], "BOQ.xls")

    def test_detail_sections_support_missing_optional_fields(self):
        html = """
        <div>Basic Details</div>
        <table class="tablebg">
          <tr><td>Tender ID</td><td>2026_TEST_1_1</td></tr>
          <tr><td>Title</td><td>Test work</td></tr>
        </table>
        """

        sections = parse_detail_sections(html)

        self.assertEqual(sections["core"], {
            "Tender ID": "2026_TEST_1_1",
            "Title": "Test work",
        })
        self.assertEqual(sections["covers"], [])
        self.assertEqual(sections["documents"], [])
        self.assertEqual(sections["payments"], [])

    def test_stored_karanja_detail_uses_structural_documents_heading(self):
        database = Path(__file__).with_name("data") / "location_ui_test.sqlite3"
        connection = sqlite3.connect(
            database.as_uri() + "?mode=ro",
            uri=True,
        )
        try:
            row = connection.execute(
                """SELECT raw_value
                   FROM source_evidence
                   WHERE tender_id=?
                     AND field_name='__detail_html_sanitized__'
                   ORDER BY id DESC LIMIT 1""",
                ("2026_PWDM_1353056_3",),
            ).fetchone()
        finally:
            connection.close()
        self.assertIsNotNone(row)

        sections = parse_detail_sections(row[0])

        self.assertEqual(len(sections["core"]), 52)
        self.assertEqual(sections["core"]["Location"], "Karanja")
        self.assertEqual(sections["core"]["Pincode"], "444105")
        self.assertEqual(sections["core"]["Published Date"], "07-Nov-2026 03:10 PM")
        self.assertEqual(sections["core"]["Tender Value in ₹"], "11,38,271")
        self.assertEqual(sections["core"]["EMD Amount in ₹"], "12,000")
        self.assertIn("Work Description", sections["core"])
        self.assertNotIn("Tender Documents", sections["core"])
        self.assertNotIn("S.No", sections["core"])
        self.assertEqual(len(sections["covers"]), 3)
        self.assertEqual(len(sections["documents"]), 3)
        self.assertEqual(len(sections["payments"]), 1)

    def test_keeps_ambiguous_location_as_district_candidate(self):
        fields = location_fields("Nashik")
        self.assertIsNone(fields["city_village"])
        self.assertEqual(fields["district"], "Nashik")
        self.assertIn("district_candidate", fields["provenance"])

    def test_extracts_and_deduplicates_organisation_rows(self):
        html = """
        <table>
          <tr><th>S.No</th><th>Organisation</th><th>Count</th></tr>
          <tr><td>1</td><td>PWD</td><td><a href="/count?a=1">2</a></td></tr>
          <tr><td>2</td><td>PWD</td><td><a href="/count?a=1">2</a></td></tr>
          <tr><td>3</td><td>ZP Wardha</td><td><a href="/count?a=2">4</a></td></tr>
        </table>
        """
        organisations = parse_organisation_rows(parse_tables(html), "https://example.test/base")
        self.assertEqual([item.name for item in organisations], ["PWD", "ZP Wardha"])
        self.assertEqual(organisations[1].tender_count, 4)

    def test_extracts_all_listing_rows_and_next_page(self):
        html = """
        <table>
          <tr><th>S.No</th><th>Published</th><th>Closing</th><th>Opening</th><th>Tender</th><th>Org</th></tr>
          <tr><td>1</td><td>p1</td><td>c1</td><td>o1</td>
            <td><a href="/detail?id=1">2026_PWD_1_1 Tender A</a></td><td>PWD</td></tr>
          <tr><td>2</td><td>p2</td><td>c2</td><td>o2</td>
            <td><a href="/detail?id=2">2026_PWD_2_1 Tender B</a></td><td>PWD</td></tr>
          <tr><td colspan="6"><a href="/page=2">Next</a></td></tr>
        </table>
        """
        rows = parse_tables(html)
        listings = parse_listing_rows(rows, "https://example.test/base")
        self.assertEqual([item["tender_id"] for item in listings], ["2026_PWD_1_1", "2026_PWD_2_1"])
        self.assertEqual(find_next_url(rows, "https://example.test/base"), "https://example.test/page=2")

    def test_store_deduplicates_new_source_evidence(self):
        tender = Tender(
            tender_id="2026_TEST_1_1",
            reference_number="ref",
            title="title",
            organisation_chain="org",
            published_at=None,
            closing_at=None,
            opening_at=None,
            estimated_value=None,
            product_category=None,
            location_raw=None,
            location_city_village=None,
            location_taluka=None,
            location_district=None,
            location_state=None,
            location_provenance="missing",
            location_confidence=0.0,
            scope_status="UNKNOWN",
            scope_district=None,
            scope_taluka=None,
            scope_provenance="location.missing",
            source_listing_url="https://example.test/list",
            source_detail_url="https://example.test/detail",
            observed_at="2026-01-01T00:00:00+00:00",
        )
        with TemporaryDirectory() as directory:
            store = DiscoveryStore(Path(directory) / "test.sqlite3")
            store.save_tender(tender)
            store.save_tender(tender)
            count = store.connection.execute(
                "select count(*) from source_evidence where tender_id=?",
                (tender.tender_id,),
            ).fetchone()[0]
            store.close()
        self.assertEqual(count, 4)

    def test_detail_evidence_sanitizes_secrets_and_preserves_labels(self):
        fixture = """
        <form><input name="tokenSecret" value="secret-token">
        <input name="captchaText" value="human-answer"></form>
        <table><tr><td>Location</td><td>ARVI</td></tr>
        <tr><td>District</td><td>Wardha</td></tr>
        <tr><td>Taluka</td><td>Arvi</td></tr>
        <tr><td>Unrecognised Field</td><td>Preserve me</td></tr></table>
        """
        sanitized = sanitize_detail_html(fixture)
        labels = sanitize_labels({
            "Location": "ARVI",
            "District": "Wardha",
            "Taluka": "Arvi",
            "Unrecognised Field": "Preserve me",
            "tokenSecret": "secret-token",
            "captchaText": "human-answer",
        })
        self.assertIn("Location", sanitized)
        self.assertNotIn("secret-token", sanitized)
        self.assertNotIn("human-answer", sanitized)
        self.assertEqual(labels["Location"], "ARVI")
        self.assertEqual(labels["District"], "Wardha")
        self.assertEqual(labels["Taluka"], "Arvi")
        self.assertEqual(labels["Unrecognised Field"], "Preserve me")
        self.assertEqual(labels["tokenSecret"], "[REDACTED]")
        self.assertEqual(labels["captchaText"], "[REDACTED]")

    def test_sanitization_handles_attribute_order_encoded_urls_and_javascript(self):
        fixture = """
        <input value="secret" data-x="1" name="tokenSecret">
        <input name='captchaText' value='answer'>
        <a href="/detail?keep=yes&amp;sp=secret%2Bvalue&amp;session=T">Tender</a>
        <script>const tokenSecret = "secret-token";
          let x = { "sp": "secret-sp", session: "T" };</script>
        """
        sanitized = sanitize_detail_html(fixture)
        self.assertNotIn("secret", sanitized)
        self.assertNotIn("answer", sanitized)
        self.assertNotIn("secret-token", sanitized)
        self.assertNotIn("secret-sp", sanitized)
        self.assertNotIn("sp=secret", sanitized)
        self.assertNotIn("session=T", sanitized)
        self.assertIn("keep=yes", sanitized)

    def test_safe_url_preserves_only_non_sensitive_parameters(self):
        safe = safe_url_for_log(
            "https://example.test/detail?keep=yes&sp=secret&session=T&tokenSecret=tok&captchaText=x"
        )
        self.assertEqual(safe, "https://example.test/detail?keep=yes")

    def test_evidence_deduplicates_across_session_urls(self):
        tender = Tender(
            tender_id="2026_TEST_1_2", reference_number="ref", title="title",
            organisation_chain="org", published_at=None, closing_at=None, opening_at=None,
            estimated_value=None, product_category=None, location_raw="ARVI",
            location_city_village=None, location_taluka="Arvi", location_district=None,
            location_state=None, location_provenance="detail", location_confidence=0.5,
            scope_status="UNKNOWN", scope_district=None, scope_taluka="Arvi",
            scope_provenance="location.raw_missing_district_or_taluka",
            source_listing_url="https://example.test/list",
            source_detail_url="https://example.test/detail?sp=first&session=T",
            observed_at="2026-01-01T00:00:00+00:00",
            detail_html_sanitized="<p>same</p>", detail_labels_json='{"Location":"ARVI"}',
        )
        with TemporaryDirectory() as directory:
            store = DiscoveryStore(Path(directory) / "test.sqlite3")
            store.save_tender(tender)
            tender.source_detail_url = "https://example.test/detail?sp=second&session=T"
            tender.observed_at = "2026-01-01T00:00:01+00:00"
            store.save_tender(tender)
            count = store.connection.execute(
                "select count(*) from source_evidence where tender_id=?", (tender.tender_id,)
            ).fetchone()[0]
            store.close()
        self.assertEqual(count, 6)

    def test_tender_detail_preserves_explicit_location_evidence(self):
        html = """
        <table><tr>
          <td>Tender ID</td><td>2026_TEST_2_1</td>
          <td>Location</td><td>Arvi</td>
          <td>District</td><td>Wardha</td>
          <td>Taluka</td><td>Arvi</td>
          <td>Unrecognised Field</td><td>Preserve me</td>
        </tr></table>
        """
        client = MahaTendersClient("https://example.test", request_delay=0)
        client.fetch = lambda _url: (html, "https://example.test/detail")
        tender = client.tender_detail(
            {
                "tender_id": "2026_TEST_2_1",
                "title_ref": "Test",
                "organisation_chain": "Org",
                "published_at": "",
                "closing_at": "",
                "opening_at": "",
                "detail_url": "https://example.test/detail",
            },
            "https://example.test/list",
        )
        self.assertEqual(tender.scope_status, "IN_SCOPE")
        self.assertEqual(tender.scope_district, "Wardha")
        self.assertEqual(tender.scope_taluka, "Arvi")
        self.assertIn("Unrecognised Field", tender.detail_labels_json or "")

    def test_scope_contains_all_configured_talukas_and_aliases(self):
        self.assertEqual(sum(len(items) for items in DISTRICT_TALUKAS.values()), 22)
        self.assertEqual(canonical_taluka("Selu"), "Seloo")
        self.assertEqual(canonical_taluka("Karanja Ghadge"), "Karanja")
        self.assertEqual(canonical_taluka("Tiwsa"), "Teosa")
        self.assertEqual(canonical_taluka("Chandur Railway"), "Chandur Railway")

    def test_configures_exactly_22_location_searches(self):
        searches = configured_location_searches("https://example.test")
        self.assertEqual(len(searches), 22)
        self.assertEqual({search.taluka for search in searches}, {
            taluka for talukas in DISTRICT_TALUKAS.values() for taluka in talukas
        })
        self.assertEqual(location_search_for("Selu").taluka, "Seloo")
        self.assertEqual(location_search_for("Karanja Ghadge").taluka, "Karanja")
        self.assertEqual(location_search_for("Tiwsa").taluka, "Teosa")

    def test_location_post_uses_dynamic_form_fields_and_confirmed_route(self):
        home = """
        <a id="PageLink_3" href="/nicgep/app?page=FrontEndTendersByLocation&amp;service=page">
        Tenders by Location</a>
        """
        form = """
        <form>
          <input name="formids" value="dynamic-form">
          <input name="seedids" value="dynamic-seed">
          <input name="submitmode" value="submit">
          <input name="submitname" value="submit">
          <input name="tokenSecret" value="dynamic-token">
          <input name="If_17" value="">
          <input name="captchaText" value="">
          <input name="captcha" value="">
          <input name="submit" value="Search">
        </form>
        """
        listing = """
        <table><tr><th>S.No</th><th>Published</th><th>Closing</th><th>Opening</th><th>Tender</th><th>Org</th></tr>
        <tr><td>1</td><td>p</td><td>c</td><td>o</td>
        <td><a href="/detail">2026_PWD_1_1 Tender</a></td><td>Org</td></tr></table>
        """
        client = MahaTendersClient("https://example.test", request_delay=0)
        captured = {}
        client.fetch = lambda url: (home, url) if "FrontEndTendersByLocation" not in url else (form, url)
        client.post = lambda url, fields: (
            captured.update({"url": url, "fields": fields}) or (listing, url)
        )
        rows, final_url, next_url = client.submit_location_search(
            LocationSearch("Arvi", "Wardha", "Arvi", "https://example.test/nicgep/app")
        )
        self.assertEqual(rows[0]["tender_id"], "2026_PWD_1_1")
        self.assertIsNone(next_url)
        self.assertEqual(captured["url"], "https://example.test/nicgep/app")
        self.assertEqual(captured["fields"]["component"], "TendersbyLocation")
        self.assertEqual(captured["fields"]["page"], "FrontEndTendersByLocation")
        self.assertEqual(captured["fields"]["service"], "direct")
        self.assertEqual(captured["fields"]["session"], "T")
        self.assertEqual(captured["fields"]["Location"], "Arvi")
        self.assertEqual(captured["fields"]["tokenSecret"], "dynamic-token")

    def test_location_page_link_is_required(self):
        self.assertIsNone(find_location_page_url("<html><title>Home</title></html>", "https://example.test/app"))

    def test_captcha_required_stops_location_search(self):
        client = MahaTendersClient("https://example.test", request_delay=0)
        home = '<a href="/nicgep/app?page=FrontEndTendersByLocation&service=page">Location</a>'
        form = (
            '<form id="TendersbyLocation"><input name="formids" value="x"><input name="seedids" value="y">'
            '<input name="submitmode" value="s"><input name="submitname" value="n">'
            '<input name="tokenSecret" value="t"><input name="captchaText" value="required">'
            '</form>'
        )
        client.fetch = lambda url: (home, url) if "FrontEndTendersByLocation" not in url else (form, url)
        with self.assertRaises(CaptchaRequired):
            client.submit_location_search(location_search_for("Arvi"))

    def test_unavailable_human_captcha_input_stops_cleanly(self):
        client = MahaTendersClient("https://example.test", request_delay=0)
        with patch("discover.find_captcha_image_url", return_value="https://example.test/captcha.png"), \
             patch.object(client, "fetch_binary", return_value=(b"png", "image/png")), \
             patch("discover.webbrowser.open"), \
             patch("builtins.input", side_effect=EOFError):
            with self.assertRaises(CaptchaRequired):
                client.request_human_captcha("<img>", "https://example.test/form")

    def test_manually_completed_captcha_is_submitted(self):
        home = '<a href="/nicgep/app?page=FrontEndTendersByLocation&service=page">Location</a>'
        form = (
            '<form id="TendersbyLocation"><input name="formids" value="x"><input name="seedids" value="y">'
            '<input name="submitmode" value="s"><input name="submitname" value="n">'
            '<input name="tokenSecret" value="t"><input name="captchaText" value="required">'
            '<img id="captchaImage" src="/captcha.png"></form>'
        )
        listing = '<table><tr><td><a href="/detail">2026_PWD_3_1 Result</a></td><td>Org</td></tr></table>'
        client = MahaTendersClient("https://example.test", request_delay=0,
                                   captcha_handler=lambda _html, _url: "human-answer")
        captured = {}
        client.fetch = lambda url: (home, url) if "FrontEndTendersByLocation" not in url else (form, url)
        client.post = lambda url, fields: (
            captured.update({"fields": fields}) or (listing, url)
        )
        rows, _, _ = client.submit_location_search(location_search_for("Arvi"))
        self.assertEqual(rows[0]["tender_id"], "2026_PWD_3_1")
        self.assertEqual(captured["fields"]["captchaText"], "human-answer")

    def test_embedded_captcha_image_is_decoded_without_http_request(self):
        form = '<form id="TendersbyLocation"><img id="captchaImage" src="data:image/png;base64,AAE="></form>'
        image_url = find_captcha_image_url(form, "https://example.test/location")
        self.assertEqual(image_url, "data:image/png;base64,AAE=")
        client = MahaTendersClient("https://example.test", request_delay=0)
        image, content_type = client.fetch_binary(image_url)
        self.assertEqual(image, b"\x00\x01")
        self.assertEqual(content_type, "image/png")

    def test_expired_session_is_reported(self):
        self.assertTrue(session_expired("<html>Your session has expired</html>"))
        client = MahaTendersClient("https://example.test", request_delay=0)
        with self.assertRaisesRegex(Exception, "session expired"):
            client.parse_listing_response(
                "<html><body>Session expired</body></html>",
                "https://example.test/result",
                "Arvi",
            )

    def test_failed_taluka_search_cannot_finish_completed(self):
        class FailedClient:
            base_url = "https://example.test"
            request_delay = 0

            def iter_location_pages(self, _search):
                raise DiscoveryError("synthetic search failure")
                yield  # pragma: no cover

        with TemporaryDirectory() as directory:
            output = Path(directory) / "result.json"
            summary = run_location_discovery(
                FailedClient(), Path(directory) / "test.sqlite3", output, taluka="Arvi"
            )
        self.assertEqual(summary["status"], "FAILED")

    def test_recognizes_explicit_empty_location_result(self):
        empty_html = """
        <html><body><table><tr><td>No Tenders found</td></tr></table></body></html>
        """
        self.assertTrue(no_tenders_found_message(empty_html))
        client = MahaTendersClient("https://example.test", request_delay=0)
        rows, final_url, next_url = client.parse_listing_response(
            empty_html, "https://example.test/result", "Seloo"
        )
        self.assertEqual(rows, [])
        self.assertEqual(final_url, "https://example.test/result")
        self.assertIsNone(next_url)

    def test_malformed_empty_location_result_remains_failure(self):
        client = MahaTendersClient("https://example.test", request_delay=0)
        with self.assertRaisesRegex(DiscoveryError, "No parseable tender rows"):
            client.parse_listing_response(
                "<html><body><p>Unexpected response</p></body></html>",
                "https://example.test/result",
                "Seloo",
            )

    def test_empty_location_search_completes_with_zero_counts(self):
        class EmptyClient:
            base_url = "https://example.test"
            request_delay = 0

            def iter_location_pages(self, _search):
                yield (
                    ListingPage(
                        organisation="Seloo",
                        page_number=1,
                        url="https://example.test/empty",
                        tender_count=0,
                        fingerprint="empty-page",
                        next_url=None,
                        observed_at="2026-01-01",
                    ),
                    [],
                )

        with TemporaryDirectory() as directory:
            summary = run_location_discovery(
                EmptyClient(),
                Path(directory) / "test.sqlite3",
                Path(directory) / "result.json",
                taluka="Seloo",
            )
        self.assertEqual(summary["status"], "COMPLETED")
        self.assertEqual(summary["listing_pages_processed"], 1)
        self.assertEqual(summary["tender_ids_discovered"], 0)
        self.assertEqual(summary["tender_details_retrieved"], 0)
        self.assertEqual(summary["errors"], [])
        self.assertEqual(summary["message"], "No tenders found for this taluka.")

    def test_location_details_attempt_every_unique_id_and_continue_after_failure(self):
        attempted = []
        tender_ids = ["TENDER_%02d" % index for index in range(1, 13)]
        listings = [{"tender_id": tender_id} for tender_id in tender_ids]
        listings.append({"tender_id": tender_ids[0]})

        class DetailClient:
            base_url = "https://example.test"
            request_delay = 0

            def iter_location_pages(self, _search):
                for page_number, page_list in enumerate((listings[:7], listings[7:]), 1):
                    yield (
                        ListingPage(
                            organisation="Arvi",
                            page_number=page_number,
                            url="https://example.test/list/%d" % page_number,
                            tender_count=len(page_list),
                            fingerprint="page-%d" % page_number,
                            next_url=None,
                            observed_at="2026-01-01",
                        ),
                        page_list,
                    )

            def tender_detail(self, listing, listing_url):
                tender_id = listing["tender_id"]
                attempted.append(tender_id)
                if tender_id == "TENDER_05":
                    raise DiscoveryError("synthetic detail failure")
                return Tender(
                    tender_id=tender_id,
                    reference_number=None,
                    title="Test tender",
                    organisation_chain="Test organisation",
                    published_at=None,
                    closing_at=None,
                    opening_at=None,
                    estimated_value=None,
                    product_category=None,
                    location_raw="Arvi, Wardha",
                    location_city_village=None,
                    location_taluka="Arvi",
                    location_district="Wardha",
                    location_state="Maharashtra",
                    location_provenance="test",
                    location_confidence=1.0,
                    scope_status="IN_SCOPE",
                    scope_district="Wardha",
                    scope_taluka="Arvi",
                    scope_provenance="test",
                    source_listing_url=listing_url,
                    source_detail_url="https://example.test/detail/" + tender_id,
                    observed_at="2026-01-01",
                )

        with TemporaryDirectory() as directory:
            summary = run_location_discovery(
                DetailClient(),
                Path(directory) / "test.sqlite3",
                Path(directory) / "result.json",
                taluka="Arvi",
            )
        self.assertEqual(summary["tender_ids_discovered"], 13)
        self.assertEqual(summary["unique_tender_ids_discovered"], 12)
        self.assertEqual(summary["tender_details_attempted"], 12)
        self.assertEqual(summary["tender_details_retrieved"], 11)
        self.assertEqual(summary["tender_details_failed"], 1)
        self.assertEqual(summary["duplicate_tenders_prevented"], 1)
        self.assertEqual(summary["listing_pages_processed"], 2)
        self.assertEqual(len(attempted), 12)
        self.assertEqual(len(set(attempted)), 12)
        self.assertEqual(attempted[-1], "TENDER_12")
        self.assertEqual(summary["status"], "FAILED")

    def test_location_pagination_follows_generated_next_link(self):
        first = """
        <table><tr><td><a href="/page2">Next</a></td></tr>
        <tr><td><a href="/detail/1">2026_PWD_1_1 First</a></td><td>Org</td></tr></table>
        """
        second = """
        <table><tr><td><a href="/page3">Next</a></td></tr>
        <tr><td><a href="/detail/2">2026_PWD_2_1 Second</a></td><td>Org</td></tr></table>
        """
        third = """
        <table><tr><td><a href="/detail/3">2026_PWD_3_1 Third</a></td><td>Org</td></tr></table>
        """
        client = MahaTendersClient("https://example.test", request_delay=0)
        client.submit_location_search = lambda search: (
            parse_listing_rows(parse_tables(first), "https://example.test/page1"),
            "https://example.test/page1",
            "https://example.test/page2",
        )
        client.fetch = lambda url: (
            (second, url) if url.endswith("page2") else (third, url)
        )
        pages = list(client.iter_location_pages(location_search_for("Arvi")))
        self.assertEqual([page.page_number for page, _ in pages], [1, 2, 3])
        self.assertEqual([rows[0]["tender_id"] for _, rows in pages],
                         ["2026_PWD_1_1", "2026_PWD_2_1", "2026_PWD_3_1"])

    def test_explicit_location_page_limit_stops_after_requested_pages(self):
        class ThreePageClient:
            base_url = "https://example.test"
            request_delay = 0

            def iter_location_pages(self, _search):
                for page_number in range(1, 4):
                    yield (
                        ListingPage(
                            organisation="Arvi",
                            page_number=page_number,
                            url="https://example.test/page/%d" % page_number,
                            tender_count=0,
                            fingerprint="empty-%d" % page_number,
                            next_url=None,
                            observed_at="2026-01-01",
                        ),
                        [],
                    )

        with TemporaryDirectory() as directory:
            summary = run_location_discovery(
                ThreePageClient(),
                Path(directory) / "test.sqlite3",
                Path(directory) / "result.json",
                max_pages_per_taluka=2,
                taluka="Arvi",
            )
        self.assertEqual(summary["listing_pages_processed"], 2)

    def test_duplicate_occurrences_are_retained_separately(self):
        tender = Tender(
            tender_id="2026_TEST_1_1", reference_number=None, title=None,
            organisation_chain="org", published_at=None, closing_at=None,
            opening_at=None, estimated_value=None, product_category=None,
            location_raw="Arvi, Wardha", location_city_village=None,
            location_taluka=None, location_district="Arvi, Wardha",
            location_state="Maharashtra", location_provenance="test",
            location_confidence=1.0, scope_status="IN_SCOPE",
            scope_district="Wardha", scope_taluka="Arvi",
            scope_provenance="test", source_listing_url="list",
            source_detail_url="detail", observed_at="2026-01-01",
        )
        with TemporaryDirectory() as directory:
            store = DiscoveryStore(Path(directory) / "test.sqlite3")
            store.save_tender(tender)
            store.save_tender_occurrence(tender.tender_id, "Arvi", "list-1", 1)
            store.save_tender_occurrence(tender.tender_id, "Arvi", "list-2", 2)
            count = store.connection.execute(
                "SELECT count(*) FROM tender_occurrences WHERE tender_id=?",
                (tender.tender_id,),
            ).fetchone()[0]
            store.close()
        self.assertEqual(count, 2)

    def test_scope_uses_actual_location_not_organisation_name(self):
        wardha = classify_location("Arvi, Wardha district")
        amravati = classify_location("Tiwsa, Amravati")
        outside = classify_location("Nashik")
        unknown = classify_location(None)
        district_only = classify_location("Wardha")
        self.assertEqual((wardha["scope_status"], wardha["scope_district"]), ("IN_SCOPE", "Wardha"))
        self.assertEqual((amravati["scope_status"], amravati["scope_district"], amravati["scope_taluka"]),
                         ("IN_SCOPE", "Amravati", "Teosa"))
        self.assertEqual(outside["scope_status"], "OUT_OF_SCOPE")
        self.assertEqual(unknown["scope_status"], "UNKNOWN")
        self.assertEqual(district_only["scope_status"], "IN_SCOPE")

    def test_all_configured_talukas_classify_in_scope(self):
        for district, talukas in DISTRICT_TALUKAS.items():
            for taluka in talukas:
                result = classify_location(taluka.upper())
                self.assertEqual(result["scope_status"], "IN_SCOPE")
                self.assertEqual(result["scope_district"], district)
                self.assertEqual(result["scope_taluka"], taluka)

    def test_location_aliases_classify_in_scope(self):
        expected = {
            "SELU": ("Wardha", "Seloo"),
            "KARANJA GHADGE": ("Wardha", "Karanja"),
            "TIWSA": ("Amravati", "Teosa"),
        }
        for location, scope in expected.items():
            result = classify_location(location)
            self.assertEqual(
                (result["scope_status"], result["scope_district"], result["scope_taluka"]),
                ("IN_SCOPE", *scope),
            )

    def test_talukas_followed_by_district_markers_classify_in_scope(self):
        expected = {
            "AT.-ROHNA TALUKA.-ARVI DISTRICT- WARDHA": ("Wardha", "Arvi"),
            "At Bhapki Ta Warud Dist Amravati": ("Amravati", "Warud"),
            "CHICHPUR, TQ. MORSHI DIST. AMRAVATI": ("Amravati", "Morshi"),
        }
        for location, scope in expected.items():
            result = classify_location(location)
            self.assertEqual(
                (result["scope_status"], result["scope_district"], result["scope_taluka"]),
                ("IN_SCOPE", *scope),
            )

    def test_all_configured_talukas_with_district_markers_classify_in_scope(self):
        for district, talukas in DISTRICT_TALUKAS.items():
            for taluka in talukas:
                result = classify_location(
                    "%s Taluka Dist %s" % (taluka, district)
                )
                expected_taluka = None if taluka == district else taluka
                self.assertEqual(
                    (result["scope_status"], result["scope_district"], result["scope_taluka"]),
                    ("IN_SCOPE", district, expected_taluka),
                )

    def test_district_only_and_missing_locations_remain_distinct(self):
        district_only = classify_location("Wardha District")
        missing = classify_location("")
        self.assertEqual(
            (district_only["scope_status"], district_only["scope_district"], district_only["scope_taluka"]),
            ("IN_SCOPE", "Wardha", None),
        )
        self.assertEqual(
            (missing["scope_status"], missing["scope_district"], missing["scope_taluka"]),
            ("UNKNOWN", None, None),
        )

    def test_conflicting_location_evidence_remains_unknown(self):
        result = classify_location("ARVI, Amravati district")
        self.assertEqual(result["scope_status"], "UNKNOWN")
        self.assertEqual(result["scope_provenance"], "location.raw_conflicting_district_taluka")

    def test_ambiguous_and_external_locations_remain_safe(self):
        self.assertEqual(classify_location("Pune, Pune district")["scope_status"], "OUT_OF_SCOPE")
        self.assertEqual(classify_location("Wardha and Amravati")["scope_status"], "UNKNOWN")
        self.assertEqual(classify_location(None)["scope_status"], "UNKNOWN")


if __name__ == "__main__":
    unittest.main()
