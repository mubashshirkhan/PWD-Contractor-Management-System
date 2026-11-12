from __future__ import annotations

import argparse
import base64
import hashlib
import json
import logging
import os
import re
import sqlite3
import sys
import tempfile
import time
import webbrowser
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from html.parser import HTMLParser
from http.cookiejar import CookieJar
from pathlib import Path
from typing import Callable, Dict, Iterable, List, Optional, Sequence
from urllib.parse import parse_qsl, unquote, urlencode, urljoin, urlsplit
from urllib.request import HTTPCookieProcessor, Request, build_opener

try:
    from .scope import (
        DISTRICT_TALUKAS,
        TALUKA_ALIASES,
        canonical_taluka,
        classify_location,
        configured_talukas,
        district_for_taluka,
    )
except ImportError:
    from scope import (
        DISTRICT_TALUKAS,
        TALUKA_ALIASES,
        canonical_taluka,
        classify_location,
        configured_talukas,
        district_for_taluka,
    )


BASE_URL = "https://mahatenders.gov.in"
LOCATION_SEARCH_URL = BASE_URL + "/nicgep/app"
ORGANISATION_PATH = "/nicgep/app?page=FrontEndTendersByOrganisation&service=page"
TARGET_ORGANISATION = "Public Works Department Mantralaya"
USER_AGENT = "MahaTenders-LocalDiscovery/0.2 (research prototype)"
DEFAULT_DATABASE = Path(__file__).with_name("data") / "mahatenders.sqlite3"
DEFAULT_JSON = Path(__file__).with_name("data") / "discovery_results.json"
DEFAULT_REQUEST_DELAY = 1.0


class DiscoveryError(RuntimeError):
    pass


class BlockedError(DiscoveryError):
    pass


class CaptchaRequired(DiscoveryError):
    pass


LOGGER = logging.getLogger(__name__)


@dataclass
class Organisation:
    name: str
    tender_count: int
    source_url: str
    count_url: str


@dataclass
class Tender:
    tender_id: str
    reference_number: Optional[str]
    title: Optional[str]
    organisation_chain: str
    published_at: Optional[str]
    closing_at: Optional[str]
    opening_at: Optional[str]
    estimated_value: Optional[str]
    product_category: Optional[str]
    location_raw: Optional[str]
    location_city_village: Optional[str]
    location_taluka: Optional[str]
    location_district: Optional[str]
    location_state: Optional[str]
    location_provenance: str
    location_confidence: float
    scope_status: str
    scope_district: Optional[str]
    scope_taluka: Optional[str]
    scope_provenance: str
    source_listing_url: str
    source_detail_url: str
    observed_at: str
    detail_html_sanitized: Optional[str] = None
    detail_labels_json: Optional[str] = None
    detail_sections_json: Optional[str] = None


@dataclass
class ListingPage:
    organisation: str
    page_number: int
    url: str
    tender_count: int
    fingerprint: str
    next_url: Optional[str]
    observed_at: str


@dataclass(frozen=True)
class LocationSearch:
    taluka: str
    district: str
    location_value: str
    source_url: str


@dataclass
class PreparedLocationSearch:
    search: LocationSearch
    form_html: str
    form_url: str
    post_url: str
    fields: Dict[str, str]


class FormParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.fields: Dict[str, str] = {}
        self.forms: List[tuple[Optional[str], Dict[str, str]]] = []
        self.actions: Dict[Optional[str], Optional[str]] = {}
        self._in_form = False
        self._current_fields: Optional[Dict[str, str]] = None
        self._current_id: Optional[str] = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, Optional[str]]]) -> None:
        attributes = dict(attrs)
        if tag == "form":
            self._in_form = True
            self._current_id = attributes.get("id") or attributes.get("name")
            self._current_fields = {}
            self.forms.append((self._current_id, self._current_fields))
            self.actions[self._current_id] = attributes.get("action")
        if not self._in_form:
            return
        if tag in {"input", "select", "textarea"}:
            name = attributes.get("name")
            if name:
                value = attributes.get("value") or ""
                self._current_fields[name] = value
                self.fields[name] = value

    def handle_endtag(self, tag: str) -> None:
        if tag == "form":
            self._in_form = False
            self._current_fields = None
            self._current_id = None


def parse_form_fields(html: str, form_id: Optional[str] = None) -> Dict[str, str]:
    parser = FormParser()
    parser.feed(html)
    if form_id:
        for current_id, fields in parser.forms:
            if current_id == form_id:
                return dict(fields)
    return parser.fields


def parse_form_action(html: str, form_id: Optional[str] = None) -> Optional[str]:
    parser = FormParser()
    parser.feed(html)
    if form_id in parser.actions:
        return parser.actions[form_id]
    return next(iter(parser.actions.values()), None)


class LinkParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.links: List[tuple[str, str]] = []
        self._href: Optional[str] = None
        self._text: List[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, Optional[str]]]) -> None:
        if tag != "a":
            return
        attributes = dict(attrs)
        self._href = attributes.get("href")
        self._text = []

    def handle_data(self, data: str) -> None:
        if self._href is not None:
            self._text.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag == "a" and self._href:
            self.links.append((self._href, re.sub(r"\s+", " ", " ".join(self._text)).strip()))
            self._href = None
            self._text = []


class ImageParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.sources: List[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, Optional[str]]]) -> None:
        if tag != "img":
            return
        attributes = dict(attrs)
        marker = " ".join(
            (attributes.get("id") or "", attributes.get("class") or "", attributes.get("alt") or "")
        ).casefold()
        source = attributes.get("src")
        if source and "captcha" in (marker + " " + source.casefold()):
            self.sources.append(source)


def find_location_page_url(html: str, final_url: str) -> Optional[str]:
    parser = LinkParser()
    parser.feed(html)
    for href, _ in parser.links:
        if "page=FrontEndTendersByLocation" in href:
            return urljoin(final_url, href)
    return None


def find_captcha_image_url(html_text: str, final_url: str) -> Optional[str]:
    parser = ImageParser()
    parser.feed(html_text)
    return urljoin(final_url, parser.sources[0]) if parser.sources else None


def safe_url_for_log(url: str) -> str:
    parts = urlsplit(url)
    if parts.scheme == "data":
        return "data:%s;base64,<redacted>" % (parts.path.split(";", 1)[0] or "application/octet-stream")
    safe_query = [
        (key, value) for key, value in parse_qsl(parts.query, keep_blank_values=True)
        if not is_sensitive_name(key)
    ]
    query = "?" + urlencode(safe_query) if safe_query else ""
    return "%s://%s%s%s" % (parts.scheme, parts.netloc, parts.path, query)


def is_sensitive_name(name: str) -> bool:
    return unquote(name).casefold() in {
        "tokensecret", "captchatext", "captcha", "session", "sp"
    }


def redact_sensitive_text(value: str) -> str:
    names = r"(?:tokenSecret|captchaText|captcha|session|sp)"
    value = re.sub(
        rf"(?i)((?:[?&;]|&amp;|%26)\s*{names}\s*(?:=|%3d))"
        r"[^&#\s\"'<>;]+",
        r"\1[REDACTED]",
        value,
    )
    value = re.sub(
        rf"(?i)((?:[\"']?\s*){names}(?:[\"']?\s*[:=]\s*[\"']?))"
        r"[^\"'\s,;&<>}]+",
        r"\1[REDACTED]",
        value,
    )
    return value


def sanitize_detail_html(html_text: str) -> str:
    def remove_sensitive_input(match: re.Match[str]) -> str:
        tag = match.group(0)
        name_match = re.search(
            r"\bname\s*=\s*(?:[\"']([^\"']+)[\"']|([^\s>]+))", tag, re.I
        )
        return "" if name_match and is_sensitive_name(name_match.group(1) or name_match.group(2) or "") else tag

    sanitized = re.sub(r"<input\b[^>]*>", remove_sensitive_input, html_text, flags=re.I)
    sanitized = re.sub(
        r"(?i)(src\s*=\s*[\"'])data:image/[^\"']+([\"'])",
        r"\1[REDACTED]\2",
        sanitized,
    )
    decoded = unquote(sanitized)
    return redact_sensitive_text(decoded)


def sanitize_labels(labels: Dict[str, str]) -> Dict[str, str]:
    sensitive_names = {"tokensecret", "captchatext", "captcha", "session", "sp"}
    return {
        redact_sensitive_text(key): (
            "[REDACTED]" if key.casefold() in sensitive_names else redact_sensitive_text(value)
        )
        for key, value in labels.items()
    }


def sanitize_evidence_value(field_name: str, value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    if field_name == "__detail_html_sanitized__":
        return sanitize_detail_html(value)
    if field_name == "__detail_labels_json__":
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            parsed = None
        if isinstance(parsed, dict):
            return json.dumps(
                sanitize_labels({str(key): str(item) for key, item in parsed.items()}),
                ensure_ascii=False,
                sort_keys=True,
            )
    decoded = unquote(value)
    redacted = redact_sensitive_text(decoded)
    return redacted if redacted != decoded else redact_sensitive_text(value)


def has_sensitive_evidence(value: Optional[str]) -> bool:
    if value is None:
        return False
    decoded = unquote(value)
    return redact_sensitive_text(decoded) != decoded


def has_sensitive_url(url: str) -> bool:
    parts = urlsplit(url)
    parameters = parse_qsl(parts.query, keep_blank_values=True)
    parameters.extend(parse_qsl(parts.fragment, keep_blank_values=True))
    return any(is_sensitive_name(key) for key, _ in parameters)


def response_title(html: str) -> str:
    match = re.search(r"<title[^>]*>(.*?)</title>", html, re.I | re.S)
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", match.group(1))).strip() if match else ""


def log_response_diagnostics(
    requested_url: str, status: int, final_url: str, content_type: Optional[str], html: str
) -> None:
    parser = FormParser()
    parser.feed(html)
    form_ids = [form_id for form_id, _ in parser.forms if form_id]
    input_names = sorted({name for _, fields in parser.forms for name in fields})
    LOGGER.info(
        "MahaTenders response status=%s final_url=%s content_type=%s title=%r "
        "forms=%s input_names=%s requested_url=%s",
        status,
        final_url,
        content_type or "",
        response_title(html)[:160],
        form_ids,
        input_names,
        requested_url,
    )


def configured_location_searches(base_url: str = LOCATION_SEARCH_URL) -> List[LocationSearch]:
    return [
        LocationSearch(taluka, district_for_taluka(taluka) or "", taluka, base_url)
        for taluka in configured_talukas()
    ]


def location_search_for(value: str, base_url: str = LOCATION_SEARCH_URL) -> LocationSearch:
    taluka = canonical_taluka(value)
    if not taluka or taluka not in configured_talukas():
        raise DiscoveryError("Unsupported location search taluka: %s" % value)
    district = district_for_taluka(taluka)
    if not district:
        raise DiscoveryError("No configured district for taluka: %s" % taluka)
    return LocationSearch(taluka, district, taluka, base_url)


class TableParser(HTMLParser):
    """Collect table rows and cell text while retaining links in each cell."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.rows: List[List[Dict[str, object]]] = []
        self._row: Optional[List[Dict[str, object]]] = None
        self._cell: Optional[Dict[str, object]] = None
        self._link_href: Optional[str] = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, Optional[str]]]) -> None:
        attributes = dict(attrs)
        if tag == "tr":
            self._row = []
        elif tag in ("td", "th") and self._row is not None:
            self._cell = {"text": [], "hrefs": []}
            self._row.append(self._cell)
        elif tag == "a" and self._cell is not None:
            href = attributes.get("href")
            if href:
                self._link_href = href

    def handle_endtag(self, tag: str) -> None:
        if tag == "a":
            self._link_href = None
        elif tag in ("td", "th"):
            self._cell = None
        elif tag == "tr" and self._row is not None:
            if self._row:
                self.rows.append(self._row)
            self._row = None

    def handle_data(self, data: str) -> None:
        if self._cell is not None:
            self._cell["text"].append(data)
            if self._link_href:
                self._cell["hrefs"].append(self._link_href)


class DetailTableParser(HTMLParser):
    """Collect rows per HTML table, including table attributes."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.tables: List[Dict[str, object]] = []
        self._stack: List[Dict[str, object]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, Optional[str]]]) -> None:
        if tag == "table":
            context: Dict[str, object] = {
                "attrs": dict(attrs),
                "rows": [],
                "row": None,
                "cell": None,
            }
            self._stack.append(context)
            self.tables.append(context)
            return
        if not self._stack:
            return
        context = self._stack[-1]
        if tag == "tr":
            context["row"] = []
        elif tag in ("td", "th") and context["row"] is not None:
            cell = {"text": [], "hrefs": []}
            context["cell"] = cell
            context["row"].append(cell)

    def handle_endtag(self, tag: str) -> None:
        if not self._stack:
            return
        context = self._stack[-1]
        if tag in ("td", "th"):
            context["cell"] = None
        elif tag == "tr" and context["row"] is not None:
            if context["row"]:
                context["rows"].append(context["row"])
            context["row"] = None
        elif tag == "table":
            self._stack.pop()

    def handle_data(self, data: str) -> None:
        if not self._stack:
            return
        cell = self._stack[-1]["cell"]
        if cell is not None:
            cell["text"].append(data)


class VisibleTextParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: List[str] = []
        self._ignored_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, Optional[str]]]) -> None:
        if tag in ("script", "style"):
            self._ignored_depth += 1

    def handle_endtag(self, tag: str) -> None:
        if tag in ("script", "style") and self._ignored_depth:
            self._ignored_depth -= 1

    def handle_data(self, data: str) -> None:
        if not self._ignored_depth:
            self.parts.append(data)


def cell_text(cell: Dict[str, object]) -> str:
    return re.sub(r"\s+", " ", "".join(cell["text"])).strip()


def first_href(cell: Dict[str, object]) -> Optional[str]:
    hrefs = cell["hrefs"]
    return str(hrefs[0]) if hrefs else None


def parse_tables(html: str) -> List[List[Dict[str, object]]]:
    parser = TableParser()
    parser.feed(html)
    return parser.rows


def no_tenders_found_message(html: str) -> bool:
    parser = VisibleTextParser()
    parser.feed(html)
    visible_text = re.sub(r"\s+", " ", " ".join(parser.parts)).strip()
    return bool(re.search(r"\bno\s+tenders?\s+found\b", visible_text, re.IGNORECASE))


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalize_name(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    return re.sub(r"\s+", " ", value).strip()


def parse_tender_id(value: str) -> Optional[str]:
    matches = re.findall(r"\b\d{4}_[A-Z0-9]+_\d+_\d+\b", value)
    return matches[-1] if matches else None


def parse_labeled_rows(rows: Iterable[List[Dict[str, object]]]) -> Dict[str, str]:
    values: Dict[str, str] = {}
    for row in rows:
        for index in range(0, len(row) - 1, 2):
            label = cell_text(row[index])
            value = cell_text(row[index + 1])
            if label and value and label not in values:
                values[label] = value
    return values


def _table_rows(table: Dict[str, object]) -> List[List[Dict[str, object]]]:
    return table["rows"]


def _table_labels(table: Dict[str, object]) -> set[str]:
    labels: set[str] = set()
    for row in _table_rows(table):
        for index in range(0, len(row) - 1, 2):
            label = cell_text(row[index])
            if label:
                labels.add(label)
    return labels


def _rows_as_records(
    rows: Iterable[List[Dict[str, object]]],
) -> List[Dict[str, str]]:
    rows = list(rows)
    if not rows:
        return []
    headers = [cell_text(cell) for cell in rows[0]]
    if not headers or not all(headers):
        return []
    records: List[Dict[str, str]] = []
    for row in rows[1:]:
        values = [cell_text(cell) for cell in row]
        if len(values) != len(headers) or not any(values):
            continue
        records.append(dict(zip(headers, values)))
    return records


def _detail_heading_position(html: str, title: str, start: int = 0) -> Optional[int]:
    pattern = (
        r'<td\b[^>]*class=["\'][^"\']*\btextbold1\b[^"\']*["\'][^>]*>'
        r"\s*(?:<[^>]+>\s*)*" + re.escape(title) +
        r"\s*(?:</[^>]+>\s*)*</td>"
    )
    match = re.search(pattern, html[start:], re.IGNORECASE)
    return start + match.start() if match else None


def parse_detail_sections(html: str) -> Dict[str, object]:
    """Extract detail-page sections without flattening unrelated portal tables."""
    parser = DetailTableParser()
    parser.feed(html)
    tables = parser.tables

    core: Dict[str, str] = {}
    basic_start_marker = _detail_heading_position(html, "Basic Details")
    documents_start = (
        _detail_heading_position(html, "Tenders Documents", basic_start_marker or 0)
        if basic_start_marker is not None
        else None
    )
    if basic_start_marker is not None:
        basic_start = html.rfind("<table", 0, basic_start_marker)
        basic_html = html[
            basic_start if basic_start >= 0 else basic_start_marker:
            documents_start
        ]
        basic_parser = DetailTableParser()
        basic_parser.feed(basic_html)
        for table in basic_parser.tables:
            labels = _table_labels(table)
            attributes = table["attrs"]
            table_id = str(attributes.get("id", "")).casefold()
            if (
                table_id in {"packettableview", "onlineinstrumentstableview"}
                or "Cover No" in labels
                or "Bank Name" in labels
            ):
                continue
            core.update(parse_labeled_rows(_table_rows(table)))
    if not core:
        core_table = next(
            (
                table for table in tables
                if {"Organisation Chain", "Tender ID"} <= _table_labels(table)
            ),
            None,
        )
        if core_table is None:
            core_table = next(
                (
                    table for table in tables
                    if {"Tender ID", "Location"} <= _table_labels(table)
                ),
                None,
            )
        if core_table is None:
            core_table = next(
                (
                    table for table in tables
                    if {"Tender ID", "Title"} <= _table_labels(table)
                ),
                None,
            )
        core = parse_labeled_rows(_table_rows(core_table)) if core_table else {}

    covers: List[Dict[str, str]] = []
    documents: List[Dict[str, str]] = []
    corrigenda: List[Dict[str, str]] = []
    payments: List[Dict[str, str]] = []
    for table in tables:
        attributes = table["attrs"]
        table_id = str(attributes.get("id", "")).casefold()
        table_class = str(attributes.get("class", "")).casefold()
        labels = _table_labels(table)
        if table_id == "packettableview" or {"Cover No", "Cover Type"} <= labels:
            covers.extend(_rows_as_records(_table_rows(table)))
        elif "corrigendum" in table_id or "corrigendum" in str(attributes.get("jwcid", "")).casefold():
            corrigenda.extend(_rows_as_records(_table_rows(table)))
        elif table_id == "onlineinstrumentstableview" or "bank name" in labels:
            payments.extend(_rows_as_records(_table_rows(table)))
        elif "document" in table_id or table_class in {"list_table", "table_list"}:
            documents.extend(_rows_as_records(_table_rows(table)))

    return {
        "core": core,
        "covers": covers,
        "documents": documents,
        "corrigenda": corrigenda,
        "payments": payments,
    }


def location_fields(
    raw: Optional[str],
    *,
    city_village: Optional[str] = None,
    taluka: Optional[str] = None,
    district: Optional[str] = None,
) -> Dict[str, Optional[str]]:
    explicit_parts = [city_village, taluka, district]
    location = normalize_name(", ".join(part for part in ([raw] + explicit_parts) if part))
    if not location:
        return {
            "city_village": None,
            "taluka": None,
            "district": None,
            "state": None,
            "provenance": "missing",
            "confidence": 0.0,
        }
    return {
        "city_village": normalize_name(city_village),
        "taluka": normalize_name(taluka),
        "district": normalize_name(district) or (location if not explicit_parts[0] and not explicit_parts[1] else None),
        "state": "Maharashtra",
        "provenance": (
            "detail.location_explicit;detail.location_components;state.portal_scope"
            if any(explicit_parts)
            else "detail.location_explicit;district_candidate;state.portal_scope"
        ),
        "confidence": 0.9 if any(explicit_parts) else 0.7,
    }


def parse_organisation_rows(rows: Iterable[List[Dict[str, object]]], source_url: str) -> List[Organisation]:
    organisations: List[Organisation] = []
    seen: set[tuple[str, str]] = set()
    for row in rows:
        if len(row) < 3 or cell_text(row[0]).lower() in {"s.no", "sno"}:
            continue
        name = normalize_name(cell_text(row[1]))
        count_text = cell_text(row[2]).replace(",", "")
        href = first_href(row[2])
        if not name or not href or not count_text.isdigit():
            continue
        count_url = urljoin(source_url, href)
        key = (name.casefold(), count_url)
        if key in seen:
            continue
        seen.add(key)
        organisations.append(Organisation(name, int(count_text), source_url, count_url))
    return organisations


def parse_listing_rows(
    rows: Iterable[List[Dict[str, object]]], final_url: str
) -> List[Dict[str, str]]:
    listings: List[Dict[str, str]] = []
    seen: set[str] = set()
    for row in rows:
        if len(row) < 2 or cell_text(row[0]).lower() in {"s.no", "sno"}:
            continue
        tender_index = next(
            (index for index, cell in enumerate(row) if parse_tender_id(cell_text(cell))),
            None,
        )
        if tender_index is None:
            continue
        tender_id = parse_tender_id(cell_text(row[tender_index]))
        href = first_href(row[tender_index])
        if not tender_id or not href or tender_id in seen:
            continue
        seen.add(tender_id)
        values = [cell_text(cell) for cell in row]
        listings.append(
            {
                "published_at": values[1] if len(values) > 1 else "",
                "closing_at": values[2] if len(values) > 2 else "",
                "opening_at": values[3] if len(values) > 3 else "",
                "title_ref": values[tender_index],
                "tender_id": tender_id,
                "organisation_chain": values[tender_index + 1] if len(values) > tender_index + 1 else "",
                "detail_url": urljoin(final_url, href),
            }
        )
    return listings


def find_next_url(rows: Iterable[List[Dict[str, object]]], final_url: str) -> Optional[str]:
    for row in rows:
        for cell in row:
            text = cell_text(cell).casefold()
            href = first_href(cell)
            if href and text in {"next", "next page", "next >", "next »", ">"}:
                return urljoin(final_url, href)
    return None


def blocked_page(html: str, expected_content: bool) -> bool:
    if expected_content:
        return False
    lowered = html.casefold()
    markers = (
        "captcha",
        "access denied",
        "verify you are human",
        "cloudflare",
        "unauthorized",
        "forbidden",
    )
    return any(marker in lowered for marker in markers)


def captcha_required(html: str, fields: Dict[str, str]) -> bool:
    lowered = html.casefold()
    return bool(
        fields.get("captchaText", "").strip()
        or fields.get("captcha", "").strip()
        or any(marker in lowered for marker in (
            "captcha image",
            "enter captcha",
            "captcha required",
            "captcha validation",
        ))
    )


def session_expired(html: str) -> bool:
    lowered = html.casefold()
    return any(marker in lowered for marker in (
        "session expired",
        "your session has expired",
        "session timeout",
        "page has expired",
    ))


class MahaTendersClient:
    def __init__(
        self,
        base_url: str = BASE_URL,
        request_delay: float = DEFAULT_REQUEST_DELAY,
        captcha_handler: Optional[Callable[[str, str], str]] = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.request_delay = max(0.0, request_delay)
        self.captcha_handler = captcha_handler
        self._last_request_at = 0.0
        self.cookies = CookieJar()
        self.opener = build_opener(HTTPCookieProcessor(self.cookies))

    def fetch(self, url: str) -> tuple[str, str]:
        elapsed = time.monotonic() - self._last_request_at
        if elapsed < self.request_delay:
            time.sleep(self.request_delay - elapsed)
        request = Request(
            url,
            headers={
                "User-Agent": USER_AGENT,
                "Accept": "text/html,application/xhtml+xml",
            },
        )
        try:
            with self.opener.open(request, timeout=30) as response:
                body = response.read().decode(
                    response.headers.get_content_charset() or "utf-8", "replace"
                )
                final_url = response.geturl()
                status = response.status
                content_type = response.headers.get("Content-Type")
            self._last_request_at = time.monotonic()
        except Exception as exc:
            raise DiscoveryError("Request failed for %s: %s" % (url, exc)) from exc
        log_response_diagnostics(url, status, final_url, content_type, body)
        if status != 200:
            raise DiscoveryError("Unexpected HTTP status %s for %s" % (status, url))
        if len(body) < 1000:
            raise DiscoveryError("Unexpectedly small response for %s" % url)
        return body, final_url

    def fetch_binary(self, url: str) -> tuple[bytes, str]:
        if url.startswith("data:"):
            header, payload = url.split(",", 1)
            metadata = header[5:].split(";")
            content_type = metadata[0] or "application/octet-stream"
            if "base64" in metadata[1:]:
                return base64.b64decode(payload), content_type
            return unquote(payload).encode("utf-8"), content_type
        elapsed = time.monotonic() - self._last_request_at
        if elapsed < self.request_delay:
            time.sleep(self.request_delay - elapsed)
        request = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "image/*"})
        try:
            with self.opener.open(request, timeout=30) as response:
                body = response.read()
                content_type = response.headers.get("Content-Type") or "application/octet-stream"
                status = response.status
            self._last_request_at = time.monotonic()
        except Exception as exc:
            LOGGER.warning(
                "CAPTCHA image request failed url=%s error_type=%s error=%s",
                safe_url_for_log(url),
                type(exc).__name__,
                re.sub(r"https?://\S+", "<url-redacted>", str(exc)),
            )
            raise DiscoveryError("CAPTCHA image request failed") from exc
        if status != 200:
            LOGGER.warning(
                "CAPTCHA image HTTP failure url=%s status=%s",
                safe_url_for_log(url),
                status,
            )
            raise DiscoveryError("CAPTCHA image returned HTTP status %s" % status)
        return body, content_type.split(";", 1)[0]

    def request_human_captcha(self, form_html: str, form_url: str) -> str:
        image_url = find_captcha_image_url(form_html, form_url)
        if not image_url:
            raise CaptchaRequired(
                "CAPTCHA is required but no CAPTCHA image was available; human intervention is required"
            )
        LOGGER.info("CAPTCHA image resolved url=%s", safe_url_for_log(image_url))
        image, content_type = self.fetch_binary(image_url)
        if not image:
            raise DiscoveryError("CAPTCHA image response was empty; human intervention is required")
        directory = Path(tempfile.mkdtemp(prefix="mahatenders-captcha-"))
        viewer = directory / "captcha.html"
        viewer.write_text(
            "<!doctype html><meta charset='utf-8'><title>MahaTenders CAPTCHA</title>"
            "<p>Enter the CAPTCHA shown below in the waiting terminal prompt.</p>"
            "<img alt='CAPTCHA' src='data:%s;base64,%s'>"
            % (content_type, base64.b64encode(image).decode("ascii")),
            encoding="utf-8",
        )
        webbrowser.open(viewer.as_uri())
        try:
            try:
                answer = input("Enter the CAPTCHA displayed in your browser (blank cancels): ").strip()
            except EOFError as exc:
                raise CaptchaRequired(
                    "CAPTCHA entry was unavailable; extraction stopped"
                ) from exc
        finally:
            try:
                viewer.unlink()
                directory.rmdir()
            except OSError:
                pass
        if not answer:
            raise CaptchaRequired("CAPTCHA entry was cancelled; extraction stopped")
        return answer

    def submit_location_search(
        self, search: LocationSearch
    ) -> tuple[List[Dict[str, str]], str, Optional[str]]:
        prepared, challenge = self.prepare_location_search(search, load_captcha_image=False)
        if captcha_required(prepared.form_html, prepared.fields):
            if self.captcha_handler is None:
                raise CaptchaRequired(
                    "CAPTCHA is required for location search %s; human completion is required"
                    % search.taluka
                )
            captcha_answer = self.captcha_handler(prepared.form_html, prepared.form_url)
        else:
            captcha_answer = ""
        fields = dict(prepared.fields)
        if captcha_answer:
            fields["captchaText"] = captcha_answer
        fields.update({
            "component": "TendersbyLocation",
            "page": "FrontEndTendersByLocation",
            "service": "direct",
            "session": "T",
            "Location": search.location_value,
        })
        body, final_url = self.post(prepared.post_url, fields)
        return self.parse_listing_response(body, final_url, search.taluka)

    def prepare_location_search(
        self, search: LocationSearch, load_captcha_image: bool = True
    ) -> tuple[PreparedLocationSearch, Optional[tuple[bytes, str]]]:
        home_html, home_url = self.fetch(search.source_url)
        form_url = find_location_page_url(home_html, home_url)
        if not form_url:
            raise DiscoveryError("Initial response did not contain the TendersbyLocation page link")
        form_html, form_url = self.fetch(form_url)
        fields = parse_form_fields(form_html, "TendersbyLocation")
        post_url = urljoin(form_url, parse_form_action(form_html, "TendersbyLocation") or "/nicgep/app")
        required = {"formids", "seedids", "submitmode", "submitname", "tokenSecret"}
        missing = sorted(required - fields.keys())
        if missing:
            raise DiscoveryError("Location search form is missing dynamic fields: %s" % ", ".join(missing))
        if captcha_required(form_html, fields):
            if not load_captcha_image:
                return PreparedLocationSearch(search, form_html, form_url, post_url, fields), None
            image_url = find_captcha_image_url(form_html, form_url)
            if not image_url:
                raise CaptchaRequired("CAPTCHA image was not available")
            image, content_type = self.fetch_binary(image_url)
            return PreparedLocationSearch(search, form_html, form_url, post_url, fields), (image, content_type)
        return PreparedLocationSearch(search, form_html, form_url, post_url, fields), None

    def submit_prepared_location_search(
        self, prepared: PreparedLocationSearch, captcha_answer: str
    ) -> tuple[List[Dict[str, str]], str, Optional[str], Optional[tuple[bytes, str]], PreparedLocationSearch]:
        fields = dict(prepared.fields)
        if captcha_answer:
            fields["captchaText"] = captcha_answer
        fields.update({
            "component": "TendersbyLocation",
            "page": "FrontEndTendersByLocation",
            "service": "direct",
            "session": "T",
            "Location": prepared.search.location_value,
        })
        body, final_url = self.post_raw(prepared.post_url, fields)
        if captcha_required(body, parse_form_fields(body)):
            refreshed = parse_form_fields(body, "TendersbyLocation") or fields
            refreshed_prepared = PreparedLocationSearch(
                prepared.search, body, final_url, prepared.post_url, refreshed
            )
            image_url = find_captcha_image_url(body, final_url)
            if not image_url:
                raise CaptchaRequired("CAPTCHA image was not available")
            image, content_type = self.fetch_binary(image_url)
            return [], final_url, None, (image, content_type), refreshed_prepared
        listings, final_url, next_url = self.parse_listing_response(
            body, final_url, prepared.search.taluka
        )
        return listings, final_url, next_url, None, prepared

    def post(self, url: str, fields: Dict[str, str]) -> tuple[str, str]:
        body, final_url = self.post_raw(url, fields)
        if captcha_required(body, parse_form_fields(body)):
            raise CaptchaRequired(
                "CAPTCHA is required after location search; human completion is required and automation stopped"
            )
        return body, final_url

    def post_raw(self, url: str, fields: Dict[str, str]) -> tuple[str, str]:
        elapsed = time.monotonic() - self._last_request_at
        if elapsed < self.request_delay:
            time.sleep(self.request_delay - elapsed)
        request = Request(
            url,
            data=urlencode(fields).encode("utf-8"),
            method="POST",
            headers={
                "User-Agent": USER_AGENT,
                "Accept": "text/html,application/xhtml+xml",
                "Content-Type": "application/x-www-form-urlencoded",
            },
        )
        try:
            with self.opener.open(request, timeout=30) as response:
                body = response.read().decode(
                    response.headers.get_content_charset() or "utf-8", "replace"
                )
                final_url = response.geturl()
                status = response.status
                content_type = response.headers.get("Content-Type")
            self._last_request_at = time.monotonic()
        except Exception as exc:
            raise DiscoveryError("Request failed for %s: %s" % (url, exc)) from exc
        log_response_diagnostics(url, status, final_url, content_type, body)
        if status != 200:
            raise DiscoveryError("Unexpected HTTP status %s for %s" % (status, url))
        if session_expired(body):
            raise DiscoveryError("MahaTenders session expired; human intervention is required")
        return body, final_url

    def parse_listing_response(
        self, html: str, final_url: str, search_taluka: str
    ) -> tuple[List[Dict[str, str]], str, Optional[str]]:
        rows = parse_tables(html)
        listings = parse_listing_rows(rows, final_url)
        if session_expired(html):
            raise DiscoveryError("MahaTenders session expired; human intervention is required")
        if not listings and blocked_page(html, False):
            raise BlockedError("Location search appears blocked for %s" % search_taluka)
        if not listings and no_tenders_found_message(html):
            return [], final_url, find_next_url(rows, final_url)
        if not listings:
            raise DiscoveryError("No parseable tender rows found for location %s" % search_taluka)
        return listings, final_url, find_next_url(rows, final_url)

    def iter_location_pages(
        self, search: LocationSearch
    ) -> Iterable[tuple[ListingPage, List[Dict[str, str]]]]:
        listings, final_url, next_url = self.submit_location_search(search)
        page_number = 1
        seen_fingerprints: set[str] = set()
        while True:
            fingerprint = hashlib.sha256(
                "|".join(item["tender_id"] for item in listings).encode("utf-8")
            ).hexdigest()
            if fingerprint in seen_fingerprints:
                raise DiscoveryError(
                    "Repeated location-search page detected for %s at page %s"
                    % (search.taluka, page_number)
                )
            seen_fingerprints.add(fingerprint)
            yield ListingPage(
                "Location: " + search.taluka,
                page_number,
                final_url,
                len(listings),
                fingerprint,
                next_url,
                now(),
            ), listings
            if not next_url or next_url == final_url:
                return
            html, final_url = self.fetch(next_url)
            listings, final_url, next_url = self.parse_listing_response(
                html, final_url, search.taluka
            )
            page_number += 1

    def discover_organisations(self) -> tuple[List[Organisation], str]:
        url = urljoin(self.base_url, ORGANISATION_PATH)
        html, final_url = self.fetch(url)
        organisations = parse_organisation_rows(parse_tables(html), final_url)
        if not organisations:
            if blocked_page(html, False):
                raise BlockedError("Organisation page appears blocked; CAPTCHA/authentication bypass is not attempted")
            raise DiscoveryError("No parseable organisation rows found")
        return organisations, final_url

    def discover_organisation(self, name: str) -> tuple[Organisation, str]:
        organisations, final_url = self.discover_organisations()
        for organisation in organisations:
            if organisation.name == name:
                return organisation, final_url
        raise DiscoveryError("Organisation not found in current organisation table: %s" % name)

    def listing_page(self, organisation: Organisation, url: str, page_number: int) -> ListingPage:
        html, final_url = self.fetch(url)
        rows = parse_tables(html)
        listings = parse_listing_rows(rows, final_url)
        if not listings and blocked_page(html, False):
            raise BlockedError(
                "Listing page appears blocked for %s; CAPTCHA/authentication bypass is not attempted"
                % organisation.name
            )
        if not listings:
            raise DiscoveryError("No parseable tender rows found for %s" % organisation.name)
        fingerprint = hashlib.sha256(
            "|".join(item["tender_id"] for item in listings).encode("utf-8")
        ).hexdigest()
        return ListingPage(
            organisation=organisation.name,
            page_number=page_number,
            url=final_url,
            tender_count=len(listings),
            fingerprint=fingerprint,
            next_url=find_next_url(rows, final_url),
            observed_at=now(),
        )

    def listing_rows(self, url: str) -> tuple[List[Dict[str, str]], str, Optional[str]]:
        html, final_url = self.fetch(url)
        rows = parse_tables(html)
        listings = parse_listing_rows(rows, final_url)
        if not listings and blocked_page(html, False):
            raise BlockedError("Listing page appears blocked; CAPTCHA/authentication bypass is not attempted")
        if not listings:
            raise DiscoveryError("No parseable tender rows found")
        return listings, final_url, find_next_url(rows, final_url)

    def iter_listing_pages(
        self, organisation: Organisation
    ) -> Iterable[tuple[ListingPage, List[Dict[str, str]]]]:
        url = organisation.count_url
        seen_pages: set[str] = set()
        page_number = 1
        while True:
            listings, final_url, next_url = self.listing_rows(url)
            fingerprint = hashlib.sha256(
                "|".join(item["tender_id"] for item in listings).encode("utf-8")
            ).hexdigest()
            if fingerprint in seen_pages:
                raise DiscoveryError(
                    "Repeated listing page detected for %s at page %s" % (organisation.name, page_number)
                )
            seen_pages.add(fingerprint)
            page = ListingPage(
                organisation.name,
                page_number,
                final_url,
                len(listings),
                fingerprint,
                next_url,
                now(),
            )
            yield page, listings
            if not next_url or next_url == final_url:
                return
            if next_url in seen_pages:
                raise DiscoveryError(
                    "Repeated listing URL detected for %s at page %s" % (organisation.name, page_number)
                )
            url = next_url
            page_number += 1

    def tender_detail(self, listing: Dict[str, str], listing_url: str) -> Tender:
        html, detail_url = self.fetch(listing["detail_url"])
        sections = parse_detail_sections(html)
        labels = sections["core"]
        if not labels and blocked_page(html, False):
            raise BlockedError("Tender detail appears blocked; CAPTCHA/authentication bypass is not attempted")
        tender_id = labels.get("Tender ID") or listing["tender_id"]
        if tender_id != listing["tender_id"]:
            raise DiscoveryError("Tender ID mismatch between listing and detail page")
        raw_location = labels.get("Location")
        location = location_fields(
            raw_location,
            city_village=labels.get("City/Village") or labels.get("City / Village"),
            taluka=labels.get("Taluka"),
            district=labels.get("District"),
        )
        location_evidence = ", ".join(
            value for value in (
                labels.get("Location"),
                labels.get("City/Village"),
                labels.get("City / Village"),
                labels.get("Taluka"),
                labels.get("District"),
            ) if value
        )
        scope = classify_location(location_evidence or raw_location)
        sanitized_html = sanitize_evidence_value("__detail_html_sanitized__", html)
        labels_json = sanitize_evidence_value(
            "__detail_labels_json__",
            json.dumps(labels, ensure_ascii=False, sort_keys=True),
        )
        sections_json = sanitize_evidence_value(
            "__detail_sections_json__",
            json.dumps(sections, ensure_ascii=False, sort_keys=True),
        )
        return Tender(
            tender_id=tender_id,
            reference_number=labels.get("Tender Reference Number"),
            title=labels.get("Title") or listing["title_ref"],
            organisation_chain=labels.get("Organisation Chain") or listing["organisation_chain"],
            published_at=labels.get("Published Date") or listing["published_at"],
            closing_at=labels.get("Bid Submission End Date") or listing["closing_at"],
            opening_at=labels.get("Bid Opening Date") or listing["opening_at"],
            estimated_value=labels.get("Tender Value in ₹"),
            product_category=labels.get("Product Category"),
            location_raw=labels.get("Location"),
            location_city_village=location["city_village"],
            location_taluka=location["taluka"],
            location_district=location["district"],
            location_state=location["state"],
            location_provenance=str(location["provenance"]),
            location_confidence=float(location["confidence"]),
            scope_status=str(scope["scope_status"]),
            scope_district=scope["scope_district"],
            scope_taluka=scope["scope_taluka"],
            scope_provenance=str(scope["scope_provenance"]),
            source_listing_url=listing_url,
            source_detail_url=detail_url,
            observed_at=now(),
            detail_html_sanitized=sanitized_html,
            detail_labels_json=labels_json,
            detail_sections_json=sections_json,
        )


class DiscoveryStore:
    def __init__(self, database: Path, schema: str = "main") -> None:
        self.database = database
        self.schema = schema
        self.storage_mode = os.environ.get("MAHATENDERS_STORAGE", "sqlite").strip().lower()
        if self.storage_mode not in {"sqlite", "postgres"}:
            raise ValueError("MAHATENDERS_STORAGE must be sqlite or postgres")
        self._postgres_manager = None
        self._postgres_repository = None
        if self.storage_mode == "postgres":
            try:
                from .db import DatabaseManager
                from .postgres_repositories import (
                    LocationExtractionRepository,
                    MainExtractionRepository,
                )
            except ImportError:
                from db import DatabaseManager
                from postgres_repositories import (
                    LocationExtractionRepository,
                    MainExtractionRepository,
                )
            self._postgres_manager = DatabaseManager.from_env()
            if schema == "main":
                self._postgres_repository = MainExtractionRepository(self._postgres_manager)
            elif schema == "location_ui":
                self._postgres_repository = LocationExtractionRepository(self._postgres_manager)
            else:
                raise ValueError("schema must be main or location_ui")
            self.connection = None
            return
        if schema != "main":
            if schema != "location_ui":
                raise ValueError("schema must be main or location_ui")
        self.database.parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(database)
        self.connection.execute("PRAGMA foreign_keys = ON")
        self.connection.executescript(Path(__file__).with_name("schema.sql").read_text(encoding="utf-8"))
        self._ensure_scope_columns()

    def _ensure_scope_columns(self) -> None:
        columns = {
            row[1] for row in self.connection.execute("PRAGMA table_info(tenders)")
        }
        additions = {
            "scope_status": "TEXT NOT NULL DEFAULT 'UNKNOWN'",
            "scope_district": "TEXT",
            "scope_taluka": "TEXT",
            "scope_provenance": "TEXT NOT NULL DEFAULT 'scope.unclassified'",
        }
        for name, definition in additions.items():
            if name not in columns:
                self.connection.execute("ALTER TABLE tenders ADD COLUMN %s %s" % (name, definition))
        rows = self.connection.execute(
            "SELECT id, location_raw FROM tenders"
        ).fetchall()
        for tender_row_id, raw_location in rows:
            scope = classify_location(raw_location)
            self.connection.execute(
                """UPDATE tenders
                   SET scope_status=?, scope_district=?, scope_taluka=?, scope_provenance=?
                   WHERE id=?""",
                (
                    scope["scope_status"], scope["scope_district"], scope["scope_taluka"],
                    scope["scope_provenance"], tender_row_id,
                ),
            )
        self.connection.commit()

    def close(self) -> None:
        if self.storage_mode == "postgres":
            if self._postgres_manager is not None:
                self._postgres_manager.close()
            return
        self.connection.close()

    def start_run(self, max_organisations: int, max_pages: int, max_details: int) -> int:
        if self.storage_mode == "postgres":
            return self._postgres_repository.start_run(
                max_organisations, max_pages, max_details
            )
        cursor = self.connection.execute(
            """INSERT INTO extraction_runs
               (started_at, max_organisations, max_pages_per_organisation,
                max_details_per_organisation, status)
               VALUES (?, ?, ?, ?, ?)""",
            (now(), max_organisations, max_pages, max_details, "RUNNING"),
        )
        self.connection.commit()
        return int(cursor.lastrowid)

    def finish_run(self, run_id: int, summary: Dict[str, object], status: str) -> None:
        if self.storage_mode == "postgres":
            self._postgres_repository.finish_run(run_id, summary, status)
            return
        self.connection.execute(
            """UPDATE extraction_runs
               SET finished_at=?, status=?, summary_json=?
               WHERE id=?""",
            (now(), status, json.dumps(summary, ensure_ascii=False), run_id),
        )
        self.connection.commit()

    def save_organisation(self, organisation: Organisation, run_id: int) -> None:
        if self.storage_mode == "postgres":
            self._postgres_repository.save_organisation(organisation, run_id)
            return
        self.connection.execute(
            """INSERT INTO organisations (name, tender_count, source_url, count_url, observed_at)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(name) DO UPDATE SET
                 tender_count=excluded.tender_count,
                 source_url=excluded.source_url,
                 count_url=excluded.count_url,
                 observed_at=excluded.observed_at""",
            (organisation.name, organisation.tender_count, organisation.source_url,
             organisation.count_url, now()),
        )
        self.connection.execute(
            """INSERT OR IGNORE INTO run_organisations (run_id, organisation_name, status)
               VALUES (?, ?, ?)""",
            (run_id, organisation.name, "DISCOVERED"),
        )
        self.connection.commit()

    def update_organisation_status(self, run_id: int, name: str, status: str) -> None:
        if self.storage_mode == "postgres":
            self._postgres_repository.update_organisation_status(run_id, name, status)
            return
        self.connection.execute(
            "UPDATE run_organisations SET status=? WHERE run_id=? AND organisation_name=?",
            (status, run_id, name),
        )
        self.connection.commit()

    def save_page(self, run_id: int, page: ListingPage) -> None:
        if self.storage_mode == "postgres":
            self._postgres_repository.save_page(run_id, page)
            return
        self.connection.execute(
            """INSERT INTO listing_pages
               (run_id, organisation_name, page_number, source_url, tender_count,
                page_fingerprint, next_url, observed_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (run_id, page.organisation, page.page_number, page.url, page.tender_count,
             page.fingerprint, page.next_url, page.observed_at),
        )
        self.connection.commit()

    def save_tender(self, tender: Tender) -> None:
        if self.storage_mode == "postgres":
            self._postgres_repository.save_tender(tender)
            return
        values = asdict(tender)
        self.connection.execute(
            """INSERT INTO tenders
               (tender_id, reference_number, title, organisation_chain, published_at,
                closing_at, opening_at, estimated_value, product_category, location_raw,
                location_city_village, location_taluka, location_district, location_state,
                location_provenance, location_confidence, scope_status, scope_district,
                scope_taluka, scope_provenance, source_listing_url, source_detail_url,
                observed_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(tender_id) DO UPDATE SET
                 reference_number=excluded.reference_number,
                 title=excluded.title,
                 organisation_chain=excluded.organisation_chain,
                 published_at=excluded.published_at,
                 closing_at=excluded.closing_at,
                 opening_at=excluded.opening_at,
                 estimated_value=excluded.estimated_value,
                 product_category=excluded.product_category,
                 location_raw=excluded.location_raw,
                 location_city_village=excluded.location_city_village,
                 location_taluka=excluded.location_taluka,
                 location_district=excluded.location_district,
                 location_state=excluded.location_state,
                 location_provenance=excluded.location_provenance,
                 location_confidence=excluded.location_confidence,
                 scope_status=excluded.scope_status,
                 scope_district=excluded.scope_district,
                 scope_taluka=excluded.scope_taluka,
                 scope_provenance=excluded.scope_provenance,
                 source_listing_url=excluded.source_listing_url,
                 source_detail_url=excluded.source_detail_url,
                 observed_at=excluded.observed_at""",
            tuple(values[field] for field in (
                "tender_id", "reference_number", "title", "organisation_chain",
                "published_at", "closing_at", "opening_at", "estimated_value",
                "product_category", "location_raw", "location_city_village",
                "location_taluka", "location_district", "location_state",
                "location_provenance", "location_confidence", "scope_status",
                "scope_district", "scope_taluka", "scope_provenance",
                "source_listing_url",
                "source_detail_url", "observed_at",
            )),
        )
        evidence_source = safe_url_for_log(tender.source_detail_url)
        for field in ("Location", "Tender Value in ₹", "Organisation Chain"):
            raw_value = {
                "Location": tender.location_raw,
                "Tender Value in ₹": tender.estimated_value,
                "Organisation Chain": tender.organisation_chain,
            }[field]
            raw_value = sanitize_evidence_value(field, raw_value)
            self.connection.execute(
                """INSERT INTO source_evidence
                   (tender_id, field_name, raw_value, source_page, extraction_method, observed_at)
                   SELECT ?, ?, ?, ?, ?, ?
                   WHERE NOT EXISTS (
                     SELECT 1 FROM source_evidence
                     WHERE tender_id=? AND field_name=? AND raw_value IS ?
                       AND source_page=? AND extraction_method=?
                   )""",
                (
                    tender.tender_id, field, raw_value, evidence_source,
                    "detail.label", tender.observed_at,
                    tender.tender_id, field, raw_value, evidence_source, "detail.label",
                ),
            )
        for field_name, raw_value, method in (
            ("__detail_html_sanitized__", tender.detail_html_sanitized, "detail.html.sanitized"),
            ("__detail_labels_json__", tender.detail_labels_json, "detail.labels.json"),
            ("__detail_sections_json__", tender.detail_sections_json, "detail.sections.json"),
            (
                "__classification__",
                json.dumps(
                    {
                        "scope_status": tender.scope_status,
                        "scope_district": tender.scope_district,
                        "scope_taluka": tender.scope_taluka,
                        "scope_provenance": tender.scope_provenance,
                    },
                    ensure_ascii=False,
                    sort_keys=True,
                ),
                "detail.classification",
            ),
        ):
            if raw_value is None:
                continue
            raw_value = sanitize_evidence_value(field_name, raw_value)
            self.connection.execute(
                """INSERT INTO source_evidence
                   (tender_id, field_name, raw_value, source_page, extraction_method, observed_at)
                   SELECT ?, ?, ?, ?, ?, ?
                   WHERE NOT EXISTS (
                     SELECT 1 FROM source_evidence
                     WHERE tender_id=? AND field_name=? AND raw_value IS ?
                       AND source_page=? AND extraction_method=?
                   )""",
                (
                    tender.tender_id, field_name, raw_value, evidence_source, method, tender.observed_at,
                    tender.tender_id, field_name, raw_value, evidence_source, method,
                ),
            )
        self.connection.commit()

    def save_tender_occurrence(
        self, tender_id: str, search_taluka: str, source_listing_url: str, page_number: int
    ) -> None:
        if self.storage_mode == "postgres":
            self._postgres_repository.save_tender_occurrence(
                tender_id, search_taluka, source_listing_url, page_number
            )
            return
        self.connection.execute(
            """INSERT OR IGNORE INTO tender_occurrences
               (tender_id, search_taluka, source_listing_url, page_number, observed_at)
               VALUES (?, ?, ?, ?, ?)""",
            (tender_id, search_taluka, source_listing_url, page_number, now()),
        )
        self.connection.commit()

    def save_error(
        self, run_id: int, organisation: Optional[str], stage: str, message: str, started_at: str
    ) -> None:
        if self.storage_mode == "postgres":
            self._postgres_repository.save_error(
                run_id, organisation, stage, message, started_at
            )
            return
        self.connection.execute(
            """INSERT INTO extraction_errors
               (run_id, organisation_name, stage, message, started_at, finished_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (run_id, organisation, stage, message, started_at, now()),
        )
        self.connection.commit()


def save_results(organisation: Organisation, tender: Tender, database: Path, output_json: Path) -> None:
    """Backward-compatible single-record save used by the original prototype."""
    store = DiscoveryStore(database)
    run_id = store.start_run(1, 1, 1)
    try:
        store.save_organisation(organisation, run_id)
        store.update_organisation_status(run_id, organisation.name, "COMPLETED")
        store.save_tender(tender)
        summary = {
            "organisations_discovered": 1,
            "organisations_processed": 1,
            "listing_pages_processed": 1,
            "unique_tenders_retrieved": 1,
            "tender_details_retrieved": 1,
        }
        store.finish_run(run_id, summary, "COMPLETED")
    finally:
        store.close()
    output_json.parent.mkdir(parents=True, exist_ok=True)
    output_json.write_text(
        json.dumps({"organisation": asdict(organisation), "tender": asdict(tender)}, indent=2, ensure_ascii=False)
        + "\n",
        encoding="utf-8",
    )


def run_discovery(
    client: MahaTendersClient,
    database: Path,
    output_json: Path,
) -> Dict[str, object]:
    store = DiscoveryStore(database)
    run_id = store.start_run(0, 0, 0)
    started = time.perf_counter()
    summary: Dict[str, object] = {
        "run_id": run_id,
        "status": "RUNNING",
        "started_at": now(),
        "limits": {
            "max_organisations": None,
            "max_pages_per_organisation": None,
            "max_details_per_organisation": None,
            "request_delay_seconds": client.request_delay,
        },
        "organisations_discovered": 0,
        "organisations_processed": 0,
        "listing_pages_processed": 0,
        "unique_tenders_retrieved": 0,
        "tender_details_retrieved": 0,
        "in_scope_tenders_retrieved": 0,
        "out_of_scope_tenders_excluded": 0,
        "unknown_location_tenders_excluded": 0,
        "duplicate_tenders_prevented": 0,
        "districts_represented": [],
        "arvi_tenders_verified": 0,
        "wardha_tenders_verified": 0,
        "amravati_tenders_verified": 0,
        "errors": [],
        "organisation_results": [],
        "tenders": [],
    }
    try:
        organisations, _ = client.discover_organisations()
        selected = organisations
        summary["organisations_discovered"] = len(organisations)
        for organisation in selected:
            store.save_organisation(organisation, run_id)
        all_tender_ids: set[str] = set()
        districts: set[str] = set()
        stop_requested = False
        for organisation in selected:
            organisation_started = now()
            result: Dict[str, object] = {
                "name": organisation.name,
                "portal_tender_count": organisation.tender_count,
                "status": "PROCESSING",
                "pages": 0,
                "listing_rows": 0,
                "details_attempted": 0,
                "details_succeeded": 0,
                "errors": [],
                "processing_started_at": organisation_started,
            }
            try:
                listings_for_details: List[tuple[Dict[str, str], str]] = []
                for page, listings in client.iter_listing_pages(organisation):
                    store.save_page(run_id, page)
                    result["pages"] = int(result["pages"]) + 1
                    result["listing_rows"] = int(result["listing_rows"]) + len(listings)
                    summary["listing_pages_processed"] = int(summary["listing_pages_processed"]) + 1
                    for listing in listings:
                        if listing["tender_id"] in all_tender_ids:
                            summary["duplicate_tenders_prevented"] = int(summary["duplicate_tenders_prevented"]) + 1
                            continue
                        all_tender_ids.add(listing["tender_id"])
                        listings_for_details.append((listing, page.url))
                for listing, listing_url in listings_for_details:
                    result["details_attempted"] = int(result["details_attempted"]) + 1
                    try:
                        tender = client.tender_detail(listing, listing_url)
                        result["details_succeeded"] = int(result["details_succeeded"]) + 1
                        summary["tender_details_retrieved"] = int(summary["tender_details_retrieved"]) + 1
                        store.save_tender(tender)
                        summary["unique_tenders_retrieved"] = int(summary["unique_tenders_retrieved"]) + 1
                        summary["tenders"].append(asdict(tender))
                        if tender.scope_status == "IN_SCOPE":
                            summary["in_scope_tenders_retrieved"] = int(summary["in_scope_tenders_retrieved"]) + 1
                            if tender.scope_district:
                                districts.add(tender.scope_district)
                            if tender.scope_district == "Wardha":
                                summary["wardha_tenders_verified"] = int(summary["wardha_tenders_verified"]) + 1
                            if tender.scope_district == "Amravati":
                                summary["amravati_tenders_verified"] = int(summary["amravati_tenders_verified"]) + 1
                        elif tender.scope_status == "UNKNOWN":
                            summary["unknown_location_tenders_excluded"] = int(
                                summary["unknown_location_tenders_excluded"]
                            ) + 1
                        else:
                            summary["out_of_scope_tenders_excluded"] = int(
                                summary["out_of_scope_tenders_excluded"]
                            ) + 1
                    except DiscoveryError as exc:
                        message = str(exc)
                        result["errors"].append({"stage": "detail", "message": message})
                        store.save_error(run_id, organisation.name, "detail", message, now())
                        if isinstance(exc, BlockedError):
                            result["status"] = "BLOCKED"
                            stop_requested = True
                            break
                if result["status"] == "PROCESSING":
                    result["status"] = "COMPLETED"
                store.update_organisation_status(run_id, organisation.name, str(result["status"]))
                summary["organisations_processed"] = int(summary["organisations_processed"]) + 1
            except DiscoveryError as exc:
                message = str(exc)
                result["status"] = "BLOCKED" if isinstance(exc, BlockedError) else "FAILED"
                result["errors"].append({"stage": "listing", "message": message})
                store.save_error(run_id, organisation.name, "listing", message, now())
                store.update_organisation_status(run_id, organisation.name, str(result["status"]))
                summary["organisations_processed"] = int(summary["organisations_processed"]) + 1
            result["processing_finished_at"] = now()
            summary["organisation_results"].append(result)
            if stop_requested:
                break
        summary["districts_represented"] = sorted(districts)
        summary["finished_at"] = now()
        summary["processing_seconds"] = round(time.perf_counter() - started, 3)
        summary["status"] = "BLOCKED" if stop_requested else "COMPLETED"
        store.finish_run(run_id, summary, str(summary["status"]))
    except DiscoveryError as exc:
        summary["errors"].append({"stage": "organisation_discovery", "message": str(exc)})
        summary["finished_at"] = now()
        summary["processing_seconds"] = round(time.perf_counter() - started, 3)
        store.finish_run(run_id, summary, "FAILED")
        raise
    finally:
        store.close()
    output_json.parent.mkdir(parents=True, exist_ok=True)
    output_json.write_text(json.dumps(summary, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return summary


def run_location_discovery(
    client: MahaTendersClient,
    database: Path,
    output_json: Path,
    max_pages_per_taluka: Optional[int] = None,
    taluka: Optional[str] = None,
) -> Dict[str, object]:
    location_url = urljoin(client.base_url, "/nicgep/app")
    searches = (
        [location_search_for(taluka, location_url)]
        if taluka
        else configured_location_searches(location_url)
    )
    store = DiscoveryStore(database, schema="location_ui")
    run_id = store.start_run(0, max_pages_per_taluka or 0, 0)
    summary: Dict[str, object] = {
        "run_id": run_id,
        "mode": "location",
        "status": "RUNNING",
        "limits": {
            "talukas": len(searches),
            "max_pages_per_taluka": max_pages_per_taluka,
            "request_delay_seconds": client.request_delay,
        },
        "talukas_searched": [],
        "search_requests": 0,
        "listing_pages_processed": 0,
        "tender_ids_discovered": 0,
        "unique_tender_ids_discovered": 0,
        "tender_details_attempted": 0,
        "unique_tenders_retrieved": 0,
        "tender_details_retrieved": 0,
        "tender_details_failed": 0,
        "in_scope_tenders_retrieved": 0,
        "unknown_location_tenders_excluded": 0,
        "out_of_scope_tenders_excluded": 0,
        "duplicate_tenders_prevented": 0,
        "errors": [],
        "taluka_results": [],
    }
    seen_tender_ids: set[str] = set()
    started = time.perf_counter()
    blocked = False
    failed = False
    try:
        for search in searches:
            result: Dict[str, object] = {
                "taluka": search.taluka,
                "district": search.district,
                "search_requests": 1,
                "pages_processed": 0,
                "tender_ids_discovered": 0,
                "details_attempted": 0,
                "details_succeeded": 0,
                "details_failed": 0,
                "status": "PROCESSING",
                "errors": [],
            }
            summary["search_requests"] = int(summary["search_requests"]) + 1
            summary["talukas_searched"].append(search.taluka)
            try:
                for page, listings in client.iter_location_pages(search):
                    if max_pages_per_taluka is not None and int(result["pages_processed"]) >= max_pages_per_taluka:
                        break
                    store.save_page(run_id, page)
                    result["pages_processed"] = int(result["pages_processed"]) + 1
                    result["tender_ids_discovered"] = int(result["tender_ids_discovered"]) + len(listings)
                    summary["listing_pages_processed"] = int(summary["listing_pages_processed"]) + 1
                    summary["tender_ids_discovered"] = int(summary["tender_ids_discovered"]) + len(listings)
                    for listing in listings:
                        if listing["tender_id"] in seen_tender_ids:
                            summary["duplicate_tenders_prevented"] = int(summary["duplicate_tenders_prevented"]) + 1
                            continue
                        seen_tender_ids.add(listing["tender_id"])
                        summary["unique_tender_ids_discovered"] = (
                            int(summary["unique_tender_ids_discovered"]) + 1
                        )
                        result["details_attempted"] = int(result["details_attempted"]) + 1
                        summary["tender_details_attempted"] = (
                            int(summary["tender_details_attempted"]) + 1
                        )
                        try:
                            tender = client.tender_detail(listing, page.url)
                            result["details_succeeded"] = int(result["details_succeeded"]) + 1
                            summary["tender_details_retrieved"] = int(summary["tender_details_retrieved"]) + 1
                            summary["unique_tenders_retrieved"] = int(summary["unique_tenders_retrieved"]) + 1
                            store.save_tender(tender)
                            store.save_tender_occurrence(
                                listing["tender_id"], search.taluka, page.url, page.page_number
                            )
                            if tender.scope_status == "IN_SCOPE":
                                summary["in_scope_tenders_retrieved"] = int(summary["in_scope_tenders_retrieved"]) + 1
                            elif tender.scope_status == "UNKNOWN":
                                summary["unknown_location_tenders_excluded"] = int(summary["unknown_location_tenders_excluded"]) + 1
                            else:
                                summary["out_of_scope_tenders_excluded"] = int(summary["out_of_scope_tenders_excluded"]) + 1
                        except Exception as exc:
                            failed = True
                            result["details_failed"] = int(result.get("details_failed", 0)) + 1
                            summary["tender_details_failed"] = (
                                int(summary["tender_details_failed"]) + 1
                            )
                            result["errors"].append({"stage": "detail", "message": str(exc)})
                            store.save_error(run_id, search.taluka, "detail", str(exc), now())
                            if isinstance(exc, (BlockedError, CaptchaRequired)):
                                blocked = True
                                break
                    if blocked:
                        break
                result["status"] = "BLOCKED" if blocked else "COMPLETED"
            except DiscoveryError as exc:
                failed = True
                result["status"] = "BLOCKED" if isinstance(exc, (BlockedError, CaptchaRequired)) else "FAILED"
                result["errors"].append({"stage": "search", "message": str(exc)})
                store.save_error(run_id, search.taluka, "search", str(exc), now())
                blocked = blocked or result["status"] == "BLOCKED"
            if (
                int(result["pages_processed"]) > 0
                and int(result["tender_ids_discovered"]) == 0
            ):
                result["message"] = "No tenders found for this taluka."
            result["finished_at"] = now()
            summary["taluka_results"].append(result)
            if blocked:
                break
        summary["status"] = "BLOCKED" if blocked else ("FAILED" if failed else "COMPLETED")
        if (
            summary["status"] == "COMPLETED"
            and int(summary["tender_ids_discovered"]) == 0
        ):
            summary["message"] = "No tenders found for this taluka."
        summary["finished_at"] = now()
        summary["processing_seconds"] = round(time.perf_counter() - started, 3)
        store.finish_run(run_id, summary, str(summary["status"]))
    finally:
        store.close()
    output_json.parent.mkdir(parents=True, exist_ok=True)
    output_json.write_text(json.dumps(summary, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return summary


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--organisation", help="Process only this exact organisation name")
    parser.add_argument("--database", type=Path, default=DEFAULT_DATABASE)
    parser.add_argument("--json", dest="output_json", type=Path, default=DEFAULT_JSON)
    parser.add_argument("--location-search", action="store_true")
    parser.add_argument("--max-pages-per-taluka", type=int)
    parser.add_argument("--taluka", help="Run one canonical taluka or supported alias")
    parser.add_argument("--verbose", action="store_true", help="Log redacted HTTP response diagnostics")
    parser.add_argument(
        "--human-captcha",
        action="store_true",
        help="Open a local CAPTCHA viewer and prompt for manual entry",
    )
    args = parser.parse_args()
    if args.verbose:
        logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    client = MahaTendersClient()
    if args.human_captcha:
        client.captcha_handler = client.request_human_captcha
    try:
        if args.location_search and args.organisation:
            parser.error("--location-search cannot be combined with --organisation")
        if args.location_search:
            if args.max_pages_per_taluka is not None and args.max_pages_per_taluka < 1:
                parser.error("--max-pages-per-taluka must be positive")

            print(json.dumps(run_location_discovery(
                client, args.database, args.output_json,
                args.max_pages_per_taluka, args.taluka,
            ), indent=2, ensure_ascii=False))
        elif args.organisation:
            organisation, _ = client.discover_organisation(args.organisation)
            listing, listing_url, _ = client.listing_rows(organisation.count_url)
            tender = client.tender_detail(listing[0], listing_url)
            save_results(organisation, tender, args.database, args.output_json)
            print(json.dumps({"organisation": asdict(organisation), "tender": asdict(tender)}, indent=2, ensure_ascii=False))
        else:
            print(json.dumps(run_discovery(client, args.database, args.output_json), indent=2, ensure_ascii=False))
    except DiscoveryError as exc:
        print("ERROR: %s" % exc, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
