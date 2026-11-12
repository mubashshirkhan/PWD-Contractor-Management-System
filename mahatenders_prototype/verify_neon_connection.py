"""Verify the configured PostgreSQL connection with one read-only query."""

from __future__ import annotations

from .db import DatabaseManager


def main() -> int:
    manager = None
    try:
        manager = DatabaseManager.from_env()
        with manager.transaction(read_only=True) as connection:
            row = connection.execute("SELECT current_database()").fetchone()
        database_name = row["current_database"] if isinstance(row, dict) else row[0]
        print("connection=success database=%s" % database_name)
        return 0
    except Exception:
        print("connection=failure")
        return 1
    finally:
        if manager is not None:
            manager.close()


if __name__ == "__main__":
    raise SystemExit(main())
