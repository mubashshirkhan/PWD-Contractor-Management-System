from __future__ import annotations

import argparse
import base64
import json
import logging
import os
import sqlite3
import threading
import time
import uuid
from contextlib import closing
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Optional
from urllib.parse import parse_qs, unquote, urlparse

try:
    from .discover import (
        CaptchaRequired,
        DEFAULT_DATABASE,
        MahaTendersClient,
        location_search_for,
        PreparedLocationSearch,
        run_location_discovery,
        safe_url_for_log,
    )
    from .scope import (
        DISTRICT_TALUKAS,
        canonical_district,
        canonical_taluka,
        classify_location,
        district_for_taluka,
        scope_configuration,
    )
except ImportError:
    from discover import (
        CaptchaRequired,
        DEFAULT_DATABASE,
        MahaTendersClient,
        location_search_for,
        PreparedLocationSearch,
        run_location_discovery,
        safe_url_for_log,
    )
    from scope import (
        DISTRICT_TALUKAS,
        canonical_district,
        canonical_taluka,
        classify_location,
        district_for_taluka,
        scope_configuration,
    )


DEFAULT_PORT = 8890
DEFAULT_CORS_ORIGIN = os.environ.get("MAHATENDERS_CORS_ORIGIN", "")
DEFAULT_HOST = os.environ.get("MAHATENDERS_HOST", "0.0.0.0")
LOCATION_SESSION_TTL = 15 * 60
LOGGER = logging.getLogger(__name__)


def json_bytes(value: object) -> bytes:
    return (json.dumps(value, ensure_ascii=False) + "\n").encode("utf-8")


class LocationJob:
    def __init__(self, reference: str, client: MahaTendersClient, search, options: dict[str, object]) -> None:
        self.reference = reference
        self.client = client
        self.search = search
        self.options = options
        self.prepared: Optional[PreparedLocationSearch] = None
        self.challenge: Optional[tuple[bytes, str]] = None
        self.status = "STARTING"
        self.summary: dict[str, object] = {}
        self.error: Optional[str] = None
        self.cancelled = False
        self.created_at = time.monotonic()
        self.lock = threading.Lock()

    def public(self) -> dict[str, object]:
        with self.lock:
            result = {
                "reference": self.reference,
                "status": self.status,
                "summary": self.summary,
                "error": self.error,
            }
            if self.challenge:
                image, content_type = self.challenge
                result["captcha"] = {
                    "image": "data:%s;base64,%s" % (
                        content_type, base64.b64encode(image).decode("ascii")
                    ),
                    "expires_in_seconds": max(
                        0, int(LOCATION_SESSION_TTL - (time.monotonic() - self.created_at))
                    ),
                }
            return result


class LocationJobManager:
    def __init__(
        self,
        database: Path,
        runner=None,
        location_database: Optional[Path] = None,
        location_json: Optional[Path] = None,
    ) -> None:
        self.database = database.resolve()
        self.location_database = (location_database or self.database.parent / "location_ui_test.sqlite3").resolve()
        self.location_json = (location_json or self.database.parent / "location_ui_test.json").resolve()
        self.jobs: dict[str, LocationJob] = {}
        self.lock = threading.Lock()
        self.runner = runner

    def _remove_expired(self) -> None:
        now = time.monotonic()
        with self.lock:
            for reference, job in list(self.jobs.items()):
                if now - job.created_at > LOCATION_SESSION_TTL:
                    job.status = "EXPIRED"
                    del self.jobs[reference]

    def start(self, district: str, taluka: str, options: dict[str, object]) -> dict[str, object]:
        self._remove_expired()
        search = location_search_for(taluka)
        client = MahaTendersClient(request_delay=1.0)
        job = LocationJob(uuid.uuid4().hex, client, search, options)
        with self.lock:
            self.jobs[job.reference] = job
        try:
            prepared, challenge = client.prepare_location_search(search)
            job.prepared = prepared
            job.challenge = challenge
            if challenge:
                job.status = "CAPTCHA_REQUIRED"
            else:
                self._launch(job, "")
        except Exception as exc:
            job.status = "FAILED"
            job.error = str(exc)
        return job.public()

    def _launch(self, job: LocationJob, answer: str) -> None:
        job.status = "RUNNING"
        job.challenge = None
        threading.Thread(target=self._run, args=(job, answer), daemon=True).start()

    def _run(self, job: LocationJob, answer: str) -> None:
        try:
            if job.prepared is None:
                raise RuntimeError("location session is not prepared")
            if self.runner:
                summary = self.runner(job, answer)
            else:
                original_submit = job.client.submit_location_search
                first = True

                def submit(search):
                    nonlocal first
                    if first:
                        first = False
                        listings, final_url, next_url, challenge, prepared = (
                            job.client.submit_prepared_location_search(job.prepared, answer)
                        )
                        job.prepared = prepared
                        if challenge:
                            job.challenge = challenge
                            raise CaptchaRequired("CAPTCHA_REQUIRED")
                        return listings, final_url, next_url
                    return original_submit(search)

                job.client.submit_location_search = submit
                summary = run_location_discovery(
                    job.client,
                    self.location_database,
                    self.location_json,
                    max_pages_per_taluka=job.options.get("max_pages_per_taluka"),
                    taluka=job.search.taluka,
                )
            with job.lock:
                job.summary = summary
                job.status = "COMPLETED" if summary.get("status") == "COMPLETED" else summary.get("status", "FAILED")
        except CaptchaRequired:
            with job.lock:
                job.status = "CAPTCHA_REQUIRED"
        except Exception as exc:
            with job.lock:
                job.status = "CANCELLED" if job.cancelled else "FAILED"
                job.error = str(exc)

    def status(self, reference: str) -> tuple[int, dict[str, object]]:
        self._remove_expired()
        with self.lock:
            job = self.jobs.get(reference)
        if not job:
            return HTTPStatus.NOT_FOUND, {"error": "location search session expired or not found"}
        return HTTPStatus.OK, job.public()

    def answer(self, reference: str, answer: str) -> tuple[int, dict[str, object]]:
        self._remove_expired()
        with self.lock:
            job = self.jobs.get(reference)
        if not job:
            return HTTPStatus.NOT_FOUND, {"error": "location search session expired or not found"}
        if not answer.strip():
            return HTTPStatus.BAD_REQUEST, {"error": "CAPTCHA answer is required"}
        with job.lock:
            if job.status != "CAPTCHA_REQUIRED":
                return HTTPStatus.CONFLICT, {"error": "search is not waiting for CAPTCHA"}
            self._launch(job, answer.strip())
        return HTTPStatus.OK, job.public()

    def cancel(self, reference: str) -> tuple[int, dict[str, object]]:
        with self.lock:
            job = self.jobs.get(reference)
        if not job:
            return HTTPStatus.NOT_FOUND, {"error": "location search session expired or not found"}
        with job.lock:
            job.cancelled = True
            job.status = "CANCELLED"
            job.challenge = None
        return HTTPStatus.OK, job.public()


class ScopedApi:
    def __init__(
        self,
        database: Path,
        location_runner=None,
        location_manager=None,
        location_database: Optional[Path] = None,
        location_json: Optional[Path] = None,
    ) -> None:
        self.database = database.resolve()
        self.storage_mode = os.environ.get("MAHATENDERS_STORAGE", "sqlite").strip().lower()
        if self.storage_mode not in {"sqlite", "postgres"}:
            raise ValueError("MAHATENDERS_STORAGE must be sqlite or postgres")
        self.location_database = (
            location_database or self.database.parent / "location_ui_test.sqlite3"
        ).resolve()
        self.location_json = (
            location_json or self.database.parent / "location_ui_test.json"
        ).resolve()
        self._postgres_manager = None
        self._main_reader = None
        self._location_reader = None
        if self.storage_mode == "postgres":
            try:
                from .db import DatabaseManager
                from .postgres_repositories import (
                    LocationReadRepository,
                    MainReadRepository,
                )
            except ImportError:
                from db import DatabaseManager
                from postgres_repositories import (
                    LocationReadRepository,
                    MainReadRepository,
                )
            self._postgres_manager = DatabaseManager.from_env()
            self._main_reader = MainReadRepository(self._postgres_manager)
            self._location_reader = LocationReadRepository(self._postgres_manager)
        self.location_runner = location_runner or self._run_location_search
        self.location_manager = location_manager or LocationJobManager(
            self.database,
            location_database=self.location_database,
            location_json=self.location_json,
        )

    def connection(self) -> sqlite3.Connection:
        if self.storage_mode != "sqlite":
            raise RuntimeError("SQLite connections are unavailable in PostgreSQL mode")
        connection = sqlite3.connect(
            self.database.as_uri() + "?mode=ro",
            uri=True,
        )
        connection.execute("PRAGMA foreign_keys = ON")
        connection.row_factory = sqlite3.Row
        return connection

    def location_connection(self) -> sqlite3.Connection:
        if self.storage_mode != "sqlite":
            raise RuntimeError("SQLite connections are unavailable in PostgreSQL mode")
        connection = sqlite3.connect(
            self.location_database.as_uri() + "?mode=ro",
            uri=True,
        )
        connection.execute("PRAGMA foreign_keys = ON")
        connection.row_factory = sqlite3.Row
        return connection

    @staticmethod
    def _detail_fields(connection: sqlite3.Connection, tender_id: str) -> dict[str, object]:
        fields: dict[str, object] = {}
        rows = connection.execute(
            """SELECT raw_value
               FROM source_evidence
               WHERE tender_id=? AND field_name='__detail_labels_json__'
               ORDER BY id""",
            (tender_id,),
        ).fetchall()
        for row in rows:
            try:
                parsed = json.loads(row["raw_value"])
            except (TypeError, ValueError):
                continue
            if isinstance(parsed, dict):
                fields.update(parsed)
        return fields

    def location_search_details(self, run_id_value: str) -> tuple[int, object]:
        try:
            run_id = int(run_id_value)
        except (TypeError, ValueError):
            return HTTPStatus.BAD_REQUEST, {"error": "location search run ID must be an integer"}
        if run_id < 1:
            return HTTPStatus.BAD_REQUEST, {"error": "location search run ID must be positive"}

        if self.storage_mode == "postgres":
            return self._postgres_location_search_details(run_id)

        try:
            with closing(self.location_connection()) as connection:
                run = connection.execute(
                    """SELECT id, started_at, finished_at, status, summary_json
                       FROM extraction_runs WHERE id=?""",
                    (run_id,),
                ).fetchone()
                if not run:
                    return HTTPStatus.NOT_FOUND, {"error": "location search run not found"}
                try:
                    summary = json.loads(run["summary_json"]) if run["summary_json"] else {}
                except (TypeError, ValueError):
                    summary = {}
                if not isinstance(summary, dict) or summary.get("mode") != "location":
                    return HTTPStatus.NOT_FOUND, {"error": "location search run not found"}

                rows = connection.execute(
                    """SELECT t.*, MIN(o.search_taluka) AS search_taluka,
                              MIN(o.page_number) AS page_number
                       FROM tender_occurrences o
                       JOIN listing_pages p
                         ON p.run_id=?
                        AND p.organisation_name IN (
                            o.search_taluka, 'Location: ' || o.search_taluka
                        )
                        AND p.page_number=o.page_number
                        AND p.source_url=o.source_listing_url
                       JOIN tenders t ON t.tender_id=o.tender_id
                       WHERE p.run_id=?
                       GROUP BY t.tender_id
                       ORDER BY t.tender_id""",
                    (run_id, run_id),
                ).fetchall()

                tenders: list[dict[str, object]] = []
                for row in rows:
                    tender = {
                        "tender_id": row["tender_id"],
                        "title": row["title"],
                        "organisation": row["organisation_chain"],
                        "reference_number": row["reference_number"],
                        "district": row["scope_district"],
                        "taluka": row["scope_taluka"],
                        "scope_classification": {
                            "status": row["scope_status"],
                            "district": row["scope_district"],
                            "taluka": row["scope_taluka"],
                            "provenance": row["scope_provenance"],
                        },
                        "detail_fields": self._detail_fields(connection, row["tender_id"]),
                        "source": {
                            "url": safe_url_for_log(row["source_detail_url"]),
                            "extracted_at": row["observed_at"],
                            "evidence_type": "detail.labels.json",
                        },
                    }
                    tenders.append(tender)
        except sqlite3.Error:
            return HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "location search results are unavailable"}

        return HTTPStatus.OK, {
            "job": {
                "run_id": run["id"],
                "started_at": run["started_at"],
                "finished_at": run["finished_at"],
                "status": run["status"],
                "summary": summary,
            },
            "total_tender_count": len(tenders),
            "tenders": tenders,
        }

    def _postgres_location_search_details(self, run_id: int) -> tuple[int, object]:
        try:
            run, rows, detail_fields = self._location_reader.location_run_details(run_id)
        except Exception:
            LOGGER.exception("PostgreSQL location search details failed")
            return HTTPStatus.INTERNAL_SERVER_ERROR, {
                "error": "location search results are unavailable"
            }
        if not run:
            return HTTPStatus.NOT_FOUND, {"error": "location search run not found"}
        try:
            summary = json.loads(run["summary_json"]) if run["summary_json"] else {}
        except (TypeError, ValueError):
            summary = {}
        if not isinstance(summary, dict) or summary.get("mode") != "location":
            return HTTPStatus.NOT_FOUND, {"error": "location search run not found"}
        tenders = [
            {
                "tender_id": row["tender_id"],
                "title": row["title"],
                "organisation": row["organisation_chain"],
                "reference_number": row["reference_number"],
                "district": row["scope_district"],
                "taluka": row["scope_taluka"],
                "scope_classification": {
                    "status": row["scope_status"],
                    "district": row["scope_district"],
                    "taluka": row["scope_taluka"],
                    "provenance": row["scope_provenance"],
                },
                "detail_fields": detail_fields.get(row["tender_id"], {}),
                "source": {
                    "url": safe_url_for_log(row["source_detail_url"]),
                    "extracted_at": row["observed_at"],
                    "evidence_type": "detail.labels.json",
                },
            }
            for row in rows
        ]
        return HTTPStatus.OK, {
            "job": {
                "run_id": run["id"],
                "started_at": run["started_at"],
                "finished_at": run["finished_at"],
                "status": run["status"],
                "summary": summary,
            },
            "total_tender_count": len(tenders),
            "tenders": tenders,
        }

    @staticmethod
    def scope_predicate() -> tuple[str, list[object]]:
        talukas = [taluka for values in DISTRICT_TALUKAS.values() for taluka in values]
        placeholders = ",".join("?" for _ in talukas)
        return (
            "scope_status = 'IN_SCOPE' AND scope_district IN (?, ?) "
            "AND scope_taluka IN (" + placeholders + ")",
            ["Wardha", "Amravati", *talukas],
        )

    @staticmethod
    def validate_filters(query: dict[str, list[str]]) -> tuple[Optional[str], Optional[str], Optional[str]]:
        district_value = query.get("district", [])
        taluka_value = query.get("taluka", [])
        if len(district_value) > 1 or len(taluka_value) > 1:
            return None, None, "district and taluka may each be specified once"
        district = canonical_district(district_value[0]) if district_value else None
        if district_value and not district:
            return None, None, "invalid district; only Wardha and Amravati are allowed"
        taluka = canonical_taluka(taluka_value[0]) if taluka_value else None
        if taluka_value and not taluka:
            return None, None, "invalid taluka; use one of the 22 configured talukas"
        if district and taluka and district_for_taluka(taluka) != district:
            return None, None, "district and taluka do not belong together"
        return district, taluka, None

    def tenders(self, query: dict[str, list[str]]) -> tuple[int, list[dict[str, object]]]:
        district, taluka, error = self.validate_filters(query)
        if error:
            return HTTPStatus.BAD_REQUEST, [{"error": error}]
        if self.storage_mode == "postgres":
            talukas = [taluka for values in DISTRICT_TALUKAS.values() for taluka in values]
            try:
                records = self._main_reader.tenders(
                    talukas,
                    district,
                    taluka,
                    query.get("q", [None])[0],
                    query.get("closing_before", [None])[0],
                    query.get("closing_after", [None])[0],
                )
            except Exception:
                LOGGER.exception("PostgreSQL tender listing failed")
                return HTTPStatus.INTERNAL_SERVER_ERROR, [
                    {"error": "tender data is unavailable"}
                ]
            return HTTPStatus.OK, [
                record for record in records
                if self._raw_location_is_strictly_in_scope(record)
            ]
        scope_clause, values = self.scope_predicate()
        search = query.get("q", [None])[0]
        clauses = [scope_clause]
        if district:
            clauses.append("scope_district = ?")
            values.append(district)
        if taluka:
            clauses.append("scope_taluka = ?")
            values.append(taluka)
        if search:
            clauses.append(
                "(lower(tender_id) LIKE ? OR lower(coalesce(title, '')) LIKE ? "
                "OR lower(coalesce(location_raw, '')) LIKE ?)"
            )
            needle = "%" + search.casefold() + "%"
            values.extend((needle, needle, needle))
        if query.get("closing_before", [None])[0]:
            clauses.append("closing_at <= ?")
            values.append(query["closing_before"][0])
        if query.get("closing_after", [None])[0]:
            clauses.append("closing_at >= ?")
            values.append(query["closing_after"][0])
        statement = (
            "SELECT tender_id, reference_number, title, organisation_chain, "
            "published_at, closing_at, opening_at, estimated_value, product_category, "
            "location_raw, location_city_village, location_taluka, location_district, "
            "location_state, location_provenance, location_confidence, scope_status, "
            "scope_district, scope_taluka, scope_provenance, source_listing_url, "
            "source_detail_url, observed_at FROM tenders WHERE "
            + " AND ".join(clauses)
            + " ORDER BY closing_at IS NULL, closing_at, tender_id"
        )
        with closing(self.connection()) as connection:
            records = [dict(row) for row in connection.execute(statement, values)]
        return HTTPStatus.OK, [
            record for record in records
            if self._raw_location_is_strictly_in_scope(record)
        ]

    @staticmethod
    def _raw_location_is_strictly_in_scope(record: dict[str, object]) -> bool:
        classified = classify_location(record.get("location_raw"))
        return (
            classified["scope_status"] == "IN_SCOPE"
            and classified["scope_district"] == record["scope_district"]
            and classified["scope_taluka"] == record["scope_taluka"]
        )

    def response(self, path: str, query: dict[str, list[str]]) -> tuple[int, object]:
        if path.startswith("/api/v1/location-search/runs/") and path.endswith("/tenders"):
            run_id = path[len("/api/v1/location-search/runs/"):-len("/tenders")]
            return self.location_search_details(run_id)
        if path.startswith("/api/v1/location-search/"):
            reference = unquote(path.split("/")[4])
            return self.location_manager.status(reference)
        if path == "/health":
            return HTTPStatus.OK, {"ok": True, "service": "mahatenders-python", "scope": "Wardha, Amravati"}
        if path == "/api/v1/scope":
            return HTTPStatus.OK, scope_configuration()
        if path == "/api/v1/tenders":
            status, records = self.tenders(query)
            if status != HTTPStatus.OK:
                return status, records[0]
            return status, {"count": len(records), "tenders": records}
        if path.startswith("/api/v1/tenders/"):
            tender_id = unquote(path.rsplit("/", 1)[-1])
            if self.storage_mode == "postgres":
                talukas = [
                    taluka
                    for values in DISTRICT_TALUKAS.values()
                    for taluka in values
                ]
                try:
                    record = self._main_reader.tender(tender_id, talukas)
                except Exception:
                    LOGGER.exception("PostgreSQL tender detail failed")
                    return HTTPStatus.INTERNAL_SERVER_ERROR, {
                        "error": "tender data is unavailable"
                    }
                if record and self._raw_location_is_strictly_in_scope(record):
                    return HTTPStatus.OK, record
                return HTTPStatus.NOT_FOUND, {"error": "in-scope tender not found"}
            scope_clause, values = self.scope_predicate()
            with closing(self.connection()) as connection:
                records = [dict(row) for row in connection.execute(
                    "SELECT tender_id, reference_number, title, organisation_chain, "
                    "published_at, closing_at, opening_at, estimated_value, product_category, "
                    "location_raw, location_city_village, location_taluka, location_district, "
                    "location_state, location_provenance, location_confidence, scope_status, "
                    "scope_district, scope_taluka, scope_provenance, source_listing_url, "
                    "source_detail_url, observed_at FROM tenders WHERE " + scope_clause
                    + " AND tender_id = ?",
                    values + [tender_id],
                )]
            if records and self._raw_location_is_strictly_in_scope(records[0]):
                return HTTPStatus.OK, records[0]
            return HTTPStatus.NOT_FOUND, {"error": "in-scope tender not found"}
        if path == "/api/v1/stats":
            _, records = self.tenders({})
            district_counts: dict[str, int] = {}
            taluka_counts: dict[tuple[str, str], int] = {}
            for record in records:
                district = str(record["scope_district"])
                taluka = str(record["scope_taluka"])
                district_counts[district] = district_counts.get(district, 0) + 1
                key = (district, taluka)
                taluka_counts[key] = taluka_counts.get(key, 0) + 1
            return HTTPStatus.OK, {
                "districts": [
                    {"district": district, "tender_count": count}
                    for district, count in sorted(district_counts.items())
                ],
                "talukas": [
                    {"district": district, "taluka": taluka, "tender_count": count}
                    for (district, taluka), count in sorted(taluka_counts.items())
                ],
            }
        if path == "/api/v1/organisations":
            if self.storage_mode == "postgres":
                talukas = [
                    taluka
                    for values in DISTRICT_TALUKAS.values()
                    for taluka in values
                ]
                try:
                    rows = self._main_reader.organisations(talukas)
                except Exception:
                    LOGGER.exception("PostgreSQL organisation lookup failed")
                    return HTTPStatus.INTERNAL_SERVER_ERROR, {
                        "error": "organisation data is unavailable"
                    }
                organisations: dict[str, dict[str, object]] = {}
                for row in rows:
                    if not self._raw_location_is_strictly_in_scope(row):
                        continue
                    organisation = organisations.setdefault(
                        str(row["name"]),
                        {
                            "name": row["name"],
                            "tender_count": 0,
                            "source_url": row["source_url"],
                            "count_url": row["count_url"],
                            "observed_at": row["observed_at"],
                        },
                    )
                    organisation["tender_count"] = int(organisation["tender_count"]) + 1
                result = [organisations[name] for name in sorted(organisations)]
                return HTTPStatus.OK, {"count": len(result), "organisations": result}
            scope_clause, values = self.scope_predicate()
            with closing(self.connection()) as connection:
                rows = connection.execute(
                    """SELECT o.name, t.tender_id,
                              o.source_url, o.count_url, o.observed_at,
                              t.location_raw, t.scope_district, t.scope_taluka
                       FROM organisations o JOIN tenders t
                         ON t.organisation_chain LIKE '%' || o.name || '%'
                        AND """ + scope_clause + """
                       ORDER BY o.name, t.tender_id""",
                    values,
                ).fetchall()
            organisations: dict[str, dict[str, object]] = {}
            for row in rows:
                record = dict(row)
                if not self._raw_location_is_strictly_in_scope(record):
                    continue
                organisation = organisations.setdefault(
                    str(record["name"]),
                    {
                        "name": record["name"],
                        "tender_count": 0,
                        "source_url": record["source_url"],
                        "count_url": record["count_url"],
                        "observed_at": record["observed_at"],
                    },
                )
                organisation["tender_count"] = int(organisation["tender_count"]) + 1
            result = [organisations[name] for name in sorted(organisations)]
            return HTTPStatus.OK, {"count": len(result), "organisations": result}
        return HTTPStatus.NOT_FOUND, {"error": "unknown endpoint"}

    def close(self) -> None:
        if self._postgres_manager is not None:
            self._postgres_manager.close()

    def _run_location_search(self, taluka: str, options: dict[str, object]) -> dict[str, object]:
        client = MahaTendersClient(request_delay=1.0)
        if options.get("human_captcha"):
            client.captcha_handler = client.request_human_captcha
        return run_location_discovery(
            client,
            self.location_database,
            self.location_json,
            max_pages_per_taluka=options.get("max_pages_per_taluka"),
            taluka=taluka,
        )

    def location_search(self, body: dict[str, object]) -> tuple[int, object]:
        district = canonical_district(str(body.get("district", "")))
        taluka = canonical_taluka(str(body.get("taluka", "")))
        if not district or not taluka:
            return HTTPStatus.BAD_REQUEST, {"error": "district and taluka are required"}
        if district_for_taluka(taluka) != district:
            return HTTPStatus.BAD_REQUEST, {"error": "district and taluka do not belong together"}
        options = {
            "human_captcha": bool(body.get("human_captcha", True)),
            "max_pages_per_taluka": body.get("max_pages_per_taluka"),
        }
        try:
            summary = self.location_runner(taluka, options)
        except (ValueError, TypeError) as exc:
            return HTTPStatus.BAD_REQUEST, {"error": str(exc)}
        return HTTPStatus.OK, summary

    def post_response(self, path: str, body: dict[str, object]) -> tuple[int, object]:
        if path == "/api/v1/location-search/start":
            district = canonical_district(str(body.get("district", "")))
            taluka = canonical_taluka(str(body.get("taluka", "")))
            if not district or not taluka:
                return HTTPStatus.BAD_REQUEST, {"error": "district and taluka are required"}
            if district_for_taluka(taluka) != district:
                return HTTPStatus.BAD_REQUEST, {"error": "district and taluka do not belong together"}
            return HTTPStatus.OK, self.location_manager.start(district, taluka, body)
        if path.startswith("/api/v1/location-search/") and path.endswith("/captcha"):
            reference = unquote(path.split("/")[4])
            return self.location_manager.answer(reference, str(body.get("answer", "")))
        if path.startswith("/api/v1/location-search/") and path.endswith("/cancel"):
            reference = unquote(path.split("/")[4])
            return self.location_manager.cancel(reference)
        if path == "/api/v1/location-search":
            return self.location_search(body)
        return HTTPStatus.NOT_FOUND, {"error": "unknown endpoint"}


class Handler(BaseHTTPRequestHandler):
    api: ScopedApi
    cors_origin: str

    def end_headers(self) -> None:
        if self.cors_origin:
            self.send_header("Access-Control-Allow-Origin", self.cors_origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Accept, Content-Type")
        super().end_headers()

    def do_OPTIONS(self) -> None:
        self.send_response(HTTPStatus.NO_CONTENT)
        self.end_headers()

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        status, body = self.api.response(
            parsed.path,
            parse_qs(parsed.query, keep_blank_values=True),
        )
        payload = json_bytes(body)
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        try:
            length = int(self.headers.get("Content-Length", "0"))
            body = json.loads(self.rfile.read(length).decode("utf-8"))
            if not isinstance(body, dict):
                raise ValueError("JSON request body must be an object")
            status, response = self.api.post_response(parsed.path, body)
        except (ValueError, json.JSONDecodeError) as exc:
            status, response = HTTPStatus.BAD_REQUEST, {"error": str(exc)}
        payload = json_bytes(response)
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _json_method_error(self) -> None:
        payload = json_bytes({
            "error": "method not allowed",
            "method": self.command,
            "allowed": ["GET", "POST", "OPTIONS"],
        })
        self.send_response(HTTPStatus.METHOD_NOT_ALLOWED)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Allow", "GET, POST, OPTIONS")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    do_PUT = _json_method_error
    do_PATCH = _json_method_error
    do_DELETE = _json_method_error

    def log_message(self, format: str, *args: object) -> None:
        return


def main() -> int:
    parser = argparse.ArgumentParser(description="Serve the scoped MahaTenders read-only API")
    parser.add_argument(
        "--database",
        type=Path,
        default=Path(os.environ.get("MAHATENDERS_DATABASE", str(DEFAULT_DATABASE))),
    )
    parser.add_argument(
        "--location-database",
        type=Path,
        default=(
            Path(os.environ["MAHATENDERS_LOCATION_DATABASE"])
            if os.environ.get("MAHATENDERS_LOCATION_DATABASE")
            else None
        ),
    )
    parser.add_argument(
        "--location-json",
        type=Path,
        default=(
            Path(os.environ["MAHATENDERS_LOCATION_JSON"])
            if os.environ.get("MAHATENDERS_LOCATION_JSON")
            else None
        ),
    )
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", DEFAULT_PORT)))
    parser.add_argument("--cors-origin", default=DEFAULT_CORS_ORIGIN)
    args = parser.parse_args()
    if args.cors_origin and (
        "*" in args.cors_origin or not args.cors_origin.startswith(("http://", "https://"))
    ):
        parser.error("--cors-origin must be one explicit http(s) origin, not *")
    api = ScopedApi(
        args.database,
        location_database=args.location_database,
        location_json=args.location_json,
    )
    Handler.api = api
    Handler.cors_origin = args.cors_origin
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(json.dumps({"ok": True, "host": args.host, "port": args.port, "scope": "Wardha, Amravati"}))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        api.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
