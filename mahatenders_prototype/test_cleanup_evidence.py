import sqlite3
import subprocess
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from cleanup_evidence import evidence_counts, planned_changes, projected_evidence
from discover import sanitize_evidence_value


class CleanupEvidenceTests(unittest.TestCase):
    def test_common_sanitizer_redacts_encoded_raw_evidence(self):
        value = 'href="/detail?%73%70=secret%26keep%3Dyes"; tokenSecret = "token"'
        sanitized = sanitize_evidence_value("legacy", value)
        self.assertNotIn("secret", sanitized)
        self.assertNotIn("token\"", sanitized)
        self.assertIn("keep=yes", sanitized)

    def test_projection_preserves_distinct_evidence(self):
        rows = [
            {"id": 1, "tender_id": "T1", "field_name": "Location", "raw_value": "ARVI",
             "source_page": "https://x.test/detail?sp=one", "extraction_method": "detail.label"},
            {"id": 2, "tender_id": "T1", "field_name": "Location", "raw_value": "ARVI",
             "source_page": "https://x.test/detail?sp=two", "extraction_method": "detail.label"},
            {"id": 3, "tender_id": "T1", "field_name": "Location", "raw_value": "WARDHA",
             "source_page": "https://x.test/detail?sp=three", "extraction_method": "detail.label"},
            {"id": 4, "tender_id": "T1", "field_name": "District", "raw_value": "Wardha",
             "source_page": "https://x.test/detail?sp=four", "extraction_method": "detail.label"},
        ]
        updates, duplicates = planned_changes(rows)
        projected = projected_evidence(rows, updates, duplicates)
        self.assertEqual(len(projected), 3)
        self.assertEqual(evidence_counts(projected)["duplicate_rows"], 0)
        self.assertEqual({row["raw_value"] for row in projected}, {"ARVI", "WARDHA", "Wardha"})

    def test_dry_run_does_not_change_database_bytes(self):
        with TemporaryDirectory() as directory:
            database = Path(directory) / "evidence.sqlite3"
            connection = sqlite3.connect(database)
            connection.execute(
                """CREATE TABLE source_evidence (
                   id INTEGER PRIMARY KEY, tender_id TEXT, field_name TEXT,
                   raw_value TEXT, source_page TEXT, extraction_method TEXT,
                   observed_at TEXT)"""
            )
            connection.execute(
                "INSERT INTO source_evidence VALUES (1, 'T1', 'Location', 'ARVI', ?, 'detail.label', 'now')",
                ("https://x.test/detail?sp=secret",),
            )
            connection.commit()
            connection.close()
            before = database.read_bytes()
            result = subprocess.run(
                [sys.executable, str(Path(__file__).with_name("cleanup_evidence.py")),
                 "--database", str(database)],
                capture_output=True, text=True, check=True,
            )
            self.assertIn("DRY RUN: no database changes made", result.stdout)
            self.assertEqual(before, database.read_bytes())


if __name__ == "__main__":
    unittest.main()
