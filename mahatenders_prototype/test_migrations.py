from __future__ import annotations

import hashlib
import shutil
import sqlite3
import tempfile
import unittest
from pathlib import Path

import migrations
from migrations import apply_migrations


ROOT = Path(__file__).parent
PRIMARY_DATABASE = ROOT / "data" / "mahatenders.sqlite3"
ADDED_TABLES = {
    "coverage_runs",
    "coverage_partitions",
    "coverage_pages",
    "coverage_tender_work",
    "tender_observations",
}
MIGRATION_TABLE = "schema_migrations"


def table_names(connection: sqlite3.Connection) -> set[str]:
    return {
        row[0]
        for row in connection.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table'"
        )
    }


def table_digest(connection: sqlite3.Connection, table: str) -> str:
    columns = [row[1] for row in connection.execute("PRAGMA table_info(%s)" % table)]
    order = ", ".join('"%s"' % column for column in columns)
    digest = hashlib.sha256()
    for row in connection.execute('SELECT %s FROM "%s" ORDER BY rowid' % (order, table)):
        digest.update(repr(tuple(row)).encode("utf-8"))
    return digest.hexdigest()


class MigrationTests(unittest.TestCase):
    def test_migration_preserves_existing_tables_and_rows_on_copy(self):
        with tempfile.TemporaryDirectory() as directory:
            copy_path = Path(directory) / "mahatenders.sqlite3"
            shutil.copyfile(PRIMARY_DATABASE, copy_path)
            before = sqlite3.connect(copy_path)
            before_tables = table_names(before)
            before_digests = {table: table_digest(before, table) for table in before_tables}
            before_counts = {
                table: before.execute('SELECT COUNT(*) FROM "%s"' % table).fetchone()[0]
                for table in before_tables
            }
            before.close()

            apply_migrations(copy_path)

            after = sqlite3.connect(copy_path)
            self.assertTrue(ADDED_TABLES.issubset(table_names(after)))
            try:
                existing_tables = before_tables - ADDED_TABLES
                self.assertEqual(
                    existing_tables,
                    table_names(after) - ADDED_TABLES - {MIGRATION_TABLE},
                )
                for table in existing_tables:
                    self.assertEqual(
                        before_counts[table],
                        after.execute('SELECT COUNT(*) FROM "%s"' % table).fetchone()[0],
                    )
                    self.assertEqual(before_digests[table], table_digest(after, table))
            finally:
                after.close()

    def test_migration_is_idempotent(self):
        with tempfile.TemporaryDirectory() as directory:
            copy_path = Path(directory) / "mahatenders.sqlite3"
            shutil.copyfile(PRIMARY_DATABASE, copy_path)
            apply_migrations(copy_path)
            first = sqlite3.connect(copy_path)
            first_schema = sorted(
                first.execute(
                    "SELECT type, name, sql FROM sqlite_master WHERE name IN (%s)"
                    % ",".join("?" for _ in ADDED_TABLES),
                    tuple(ADDED_TABLES),
                ).fetchall()
            )
            first.close()

            apply_migrations(copy_path)

            second = sqlite3.connect(copy_path)
            second_schema = sorted(
                second.execute(
                    "SELECT type, name, sql FROM sqlite_master WHERE name IN (%s)"
                    % ",".join("?" for _ in ADDED_TABLES),
                    tuple(ADDED_TABLES),
                ).fetchall()
            )
            self.assertEqual(first_schema, second_schema)
            self.assertEqual(
                second.execute(
                    "SELECT version FROM schema_migrations ORDER BY version"
                ).fetchall(),
                [
                    ("001_add_coverage_tracking",),
                    ("002_harden_coverage_partitions",),
                ],
            )
            second.close()

    def test_migration_version_checksum_is_verified(self):
        with tempfile.TemporaryDirectory() as directory:
            copy_path = Path(directory) / "mahatenders.sqlite3"
            shutil.copyfile(PRIMARY_DATABASE, copy_path)
            apply_migrations(copy_path)
            connection = sqlite3.connect(copy_path)
            connection.execute(
                "UPDATE schema_migrations SET checksum = 'tampered' WHERE version = ?",
                ("001_add_coverage_tracking",),
            )
            connection.commit()
            connection.close()
            with self.assertRaisesRegex(RuntimeError, "checksum mismatch"):
                apply_migrations(copy_path)

    def test_null_partition_values_are_deduplicated(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "empty.sqlite3"
            connection = sqlite3.connect(database)
            connection.executescript((ROOT / "schema.sql").read_text(encoding="utf-8"))
            connection.close()
            apply_migrations(database)
            connection = sqlite3.connect(database)
            values = (
                "Wardha",
                "Arvi",
                None,
                None,
                None,
                "location",
                None,
                None,
                "same-query",
                "PENDING",
            )
            columns = (
                "district, taluka, year, month, status_filter, search_mode, "
                "date_from, date_to, portal_query_signature, state"
            )
            connection.execute(
                "INSERT INTO coverage_partitions (%s) VALUES (%s)"
                % (columns, ",".join("?" for _ in values)),
                values,
            )
            try:
                with self.assertRaises(sqlite3.IntegrityError):
                    connection.execute(
                        "INSERT INTO coverage_partitions (%s) VALUES (%s)"
                        % (columns, ",".join("?" for _ in values)),
                        values,
                    )
            finally:
                connection.close()

    def test_foreign_keys_are_enabled_and_enforced(self):
        with tempfile.TemporaryDirectory() as directory:
            copy_path = Path(directory) / "mahatenders.sqlite3"
            shutil.copyfile(PRIMARY_DATABASE, copy_path)
            apply_migrations(copy_path)
            connection = sqlite3.connect(copy_path)
            connection.execute("PRAGMA foreign_keys = ON")
            self.assertEqual(connection.execute("PRAGMA foreign_keys").fetchone()[0], 1)
            with self.assertRaises(sqlite3.IntegrityError):
                connection.execute(
                    """
                    INSERT INTO coverage_pages
                    (partition_id, page_number, source_url, page_fingerprint, status)
                    VALUES (999999, 1, 'https://example.test', 'fingerprint', 'PENDING')
                    """
                )
            connection.close()

    def test_failed_migration_rolls_back_schema_and_version_row(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "empty.sqlite3"
            sqlite3.connect(database).close()
            original = migrations.MIGRATIONS
            migrations.MIGRATIONS = original + (("003_test_failure", ("CREATE TABLE rollback_probe (id INTEGER)", "INVALID SQL")),)
            try:
                with self.assertRaises(sqlite3.OperationalError):
                    apply_migrations(database)
            finally:
                migrations.MIGRATIONS = original
            connection = sqlite3.connect(database)
            self.assertEqual(
                connection.execute(
                    "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN "
                    "('schema_migrations', 'rollback_probe')"
                ).fetchall(),
                [],
            )
            connection.close()

    def test_migration_does_not_touch_location_ui_database(self):
        with tempfile.TemporaryDirectory() as directory:
            primary_copy = Path(directory) / "primary.sqlite3"
            ui_copy = Path(directory) / "location_ui_test.sqlite3"
            shutil.copyfile(PRIMARY_DATABASE, primary_copy)
            shutil.copyfile(ROOT / "data" / "location_ui_test.sqlite3", ui_copy)
            before = ui_copy.read_bytes()
            apply_migrations(primary_copy)
            self.assertEqual(before, ui_copy.read_bytes())
            connection = sqlite3.connect(ui_copy)
            self.assertNotIn("coverage_runs", table_names(connection))
            connection.close()

if __name__ == "__main__":
    unittest.main()