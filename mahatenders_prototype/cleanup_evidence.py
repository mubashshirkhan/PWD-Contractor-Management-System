"""Dry-run and approval-gated cleanup for stored tender evidence."""

from __future__ import annotations

import argparse
import re
import shutil
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Tuple
from discover import (
    has_sensitive_evidence,
    has_sensitive_url,
    safe_url_for_log,
    sanitize_evidence_value,
)


if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


DEFAULT_DATABASE = Path(__file__).with_name("data") / "mahatenders.sqlite3"
def transformed_value(field_name: str, value: str | None) -> str | None:
    return sanitize_evidence_value(field_name, value)


def inspect_rows(connection: sqlite3.Connection) -> List[dict]:
    rows = connection.execute(
        """SELECT id, tender_id, field_name, raw_value, source_page,
                  extraction_method, observed_at
           FROM source_evidence
           ORDER BY id"""
    ).fetchall()
    return [
        {
            "id": row[0],
            "tender_id": row[1],
            "field_name": row[2],
            "raw_value": row[3],
            "source_page": row[4],
            "extraction_method": row[5],
            "observed_at": row[6],
        }
        for row in rows
    ]


def planned_changes(rows: List[dict]) -> Tuple[List[dict], List[dict]]:
    updates = []
    seen: Dict[tuple, int] = {}
    duplicates = []
    for row in rows:
        new_value = transformed_value(row["field_name"], row["raw_value"])
        new_source = safe_url_for_log(row["source_page"])
        if new_value != row["raw_value"] or new_source != row["source_page"]:
            issues = []
            if new_value != row["raw_value"]:
                issues.append("raw_value")
            if new_source != row["source_page"]:
                issues.append("source_page")
            updates.append({"row": row, "issues": issues, "new_value": new_value, "new_source": new_source})
        identity = (
            row["tender_id"],
            row["field_name"],
            new_value,
            new_source,
            row["extraction_method"],
        )
        if identity in seen:
            duplicates.append({"row": row, "kept_id": seen[identity]})
        else:
            seen[identity] = row["id"]
    return updates, duplicates


def print_plan(rows: List[dict], updates: List[dict], duplicates: List[dict]) -> None:
    affected_tenders = {item["row"]["tender_id"] for item in updates}
    affected_tenders.update(item["row"]["tender_id"] for item in duplicates)
    unsafe_url_rows = sum(has_sensitive_url(row["source_page"]) for row in rows)
    sensitive_value_rows = sum(has_sensitive_evidence(row["raw_value"]) for row in rows)
    print("Before evidence rows:", len(rows))
    print("Before sensitive-value rows:", sensitive_value_rows)
    print("Before unsafe-source-URL rows:", unsafe_url_rows)
    print("Rows requiring updates:", len(updates))
    print("Rows requiring deduplication:", len(duplicates))
    print("Tender records affected:", len(affected_tenders))
    projected_rows = projected_evidence(rows, updates, duplicates)
    projected_counts = evidence_counts(projected_rows)
    print("After evidence rows:", projected_counts["evidence_rows"])
    print("After sensitive-value rows:", projected_counts["sensitive_value_rows"])
    print("After unsafe-source-URL rows:", projected_counts["unsafe_url_rows"])
    print("After duplicate groups:", projected_counts["duplicate_groups"])
    print("After duplicate rows:", projected_counts["duplicate_rows"])
    print("Projected affected tender IDs:", len(affected_tenders))
    for item in updates:
        row = item["row"]
        print("UPDATE", row["id"], row["field_name"], ",".join(item["issues"]))
    for item in duplicates:
        row = item["row"]
        print("DEDUPLICATE", row["id"], row["field_name"], "keep", item["kept_id"])


def projected_evidence(rows: List[dict], updates: List[dict], duplicates: List[dict]) -> List[dict]:
    update_by_id = {item["row"]["id"]: item for item in updates}
    duplicate_ids = {item["row"]["id"] for item in duplicates}
    projected = []
    for row in rows:
        if row["id"] in duplicate_ids:
            continue
        item = update_by_id.get(row["id"])
        if item:
            row = dict(row, raw_value=item["new_value"], source_page=item["new_source"])
        projected.append(row)
    return projected


def evidence_counts(rows: List[dict]) -> dict:
    identities: Dict[tuple, int] = {}
    identity_counts: Dict[tuple, int] = {}
    for row in rows:
        identity = (
            row["tender_id"],
            row["field_name"],
            row["raw_value"],
            row["source_page"],
            row["extraction_method"],
        )
        identities.setdefault(identity, row["id"])
        identity_counts[identity] = identity_counts.get(identity, 0) + 1
    duplicate_groups = sum(count > 1 for count in identity_counts.values())
    duplicate_rows = sum(count - 1 for count in identity_counts.values() if count > 1)
    return {
        "evidence_rows": len(rows),
        "sensitive_value_rows": sum(has_sensitive_evidence(row["raw_value"]) for row in rows),
        "unsafe_url_rows": sum(has_sensitive_url(row["source_page"]) for row in rows),
        "duplicate_groups": duplicate_groups,
        "duplicate_rows": duplicate_rows,
    }


def verify_backup(path: Path) -> None:
    if not path.is_file() or path.stat().st_size == 0:
        raise RuntimeError("Backup was not created or is empty")
    connection = sqlite3.connect("file:" + str(path) + "?mode=ro", uri=True)
    try:
        result = connection.execute("PRAGMA integrity_check").fetchone()[0]
        if result != "ok":
            raise RuntimeError("Backup integrity check failed")
    finally:
        connection.close()


def apply_changes(database: Path, rows: List[dict], updates: List[dict], duplicates: List[dict]) -> None:
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup = database.with_name(database.name + ".backup-" + timestamp)
    shutil.copy2(database, backup)
    verify_backup(backup)
    connection = sqlite3.connect(database)
    try:
        connection.execute("BEGIN")
        for item in updates:
            row = item["row"]
            connection.execute(
                "UPDATE source_evidence SET raw_value=?, source_page=? WHERE id=?",
                (item["new_value"], item["new_source"], row["id"]),
            )
        for item in duplicates:
            connection.execute("DELETE FROM source_evidence WHERE id=?", (item["row"]["id"],))
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()
    print("Applied successfully; backup:", backup)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", type=Path, default=DEFAULT_DATABASE)
    parser.add_argument("--apply", action="store_true", help="Apply cleanup after creating a verified backup")
    args = parser.parse_args()

    connection = sqlite3.connect("file:" + str(args.database) + "?mode=ro", uri=True)
    try:
        rows = inspect_rows(connection)
    finally:
        connection.close()
    updates, duplicates = planned_changes(rows)
    print_plan(rows, updates, duplicates)
    if not args.apply:
        print("DRY RUN: no database changes made")
        return 0
    apply_changes(args.database, rows, updates, duplicates)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
