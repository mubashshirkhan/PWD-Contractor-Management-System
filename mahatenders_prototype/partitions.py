from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from typing import Iterable, Optional, Sequence

from scope import DISTRICT_TALUKAS, canonical_district, canonical_taluka, district_for_taluka


UNKNOWN_FILTER_VALUES = frozenset({"", "all", "unknown", "none", "null"})


class UnsupportedPortalFilterError(ValueError):
    """Raised when a requested partition filter lacks portal evidence."""


@dataclass(frozen=True)
class PortalCapabilities:
    location_search: bool = True
    pagination: bool = True
    annual_search: bool = False
    monthly_search: bool = False
    status_search: bool = False
    date_range_search: bool = False
    archived_search: bool = False


CONFIRMED_PORTAL_CAPABILITIES = PortalCapabilities()


def _normalized_filter(value: object) -> Optional[str]:
    if value is None:
        return None
    normalized = str(value).strip().casefold()
    return None if normalized in UNKNOWN_FILTER_VALUES else normalized


def _normalized_year(value: object) -> Optional[int]:
    normalized = _normalized_filter(value)
    if normalized is None:
        return None
    try:
        year = int(normalized)
    except (TypeError, ValueError) as exc:
        raise ValueError("year must be an integer or unknown") from exc
    if year < 1:
        raise ValueError("year must be positive")
    return year


def _normalized_month(value: object) -> Optional[int]:
    normalized = _normalized_filter(value)
    if normalized is None:
        return None
    try:
        month = int(normalized)
    except (TypeError, ValueError) as exc:
        raise ValueError("month must be an integer or unknown") from exc
    if month < 1 or month > 12:
        raise ValueError("month must be between 1 and 12")
    return month


@dataclass(frozen=True)
class SearchPartition:
    district: str
    taluka: str
    year: Optional[int]
    month: Optional[int]
    status_filter: Optional[str]
    search_mode: str
    date_from: Optional[str] = None
    date_to: Optional[str] = None

    @property
    def query_signature(self) -> str:
        payload = {
            "date_from": self.date_from,
            "date_to": self.date_to,
            "district": self.district,
            "month": self.month,
            "search_mode": self.search_mode,
            "status_filter": self.status_filter,
            "taluka": self.taluka,
            "year": self.year,
        }
        encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
        return hashlib.sha256(encoded).hexdigest()

    @property
    def partition_id(self) -> str:
        return "partition-" + self.query_signature

    def database_values(self, legacy_status_filter: bool = True) -> dict[str, object]:
        status_filter: Optional[str] = self.status_filter
        if legacy_status_filter and status_filter is None:
            status_filter = ""
        return {
            "district": self.district,
            "taluka": self.taluka,
            "year": self.year,
            "month": self.month,
            "status_filter": status_filter,
            "search_mode": self.search_mode,
            "date_from": self.date_from,
            "date_to": self.date_to,
            "portal_query_signature": self.query_signature,
        }


def _validate_location(district: str, taluka: str) -> tuple[str, str]:
    canonical_district_name = canonical_district(district)
    canonical_taluka_name = canonical_taluka(taluka)
    if not canonical_district_name or not canonical_taluka_name:
        raise ValueError("district and taluka must be in the configured scope")
    if district_for_taluka(canonical_taluka_name) != canonical_district_name:
        raise ValueError("taluka does not belong to district")
    return canonical_district_name, canonical_taluka_name


def _require_capability(capabilities: PortalCapabilities, attribute: str, label: str) -> None:
    if not getattr(capabilities, attribute):
        raise UnsupportedPortalFilterError(
            "%s partitions are not generated without verified MahaTenders evidence" % label
        )


def _partition(
    district: str,
    taluka: str,
    search_mode: str,
    year: Optional[int] = None,
    month: Optional[int] = None,
    status_filter: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
) -> SearchPartition:
    return SearchPartition(
        district=district,
        taluka=taluka,
        year=year,
        month=month,
        status_filter=status_filter,
        search_mode=search_mode,
        date_from=date_from,
        date_to=date_to,
    )


def build_partition(
    district: str,
    taluka: str,
    search_mode: str = "location_unfiltered",
    year: object = None,
    month: object = None,
    status_filter: object = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
) -> SearchPartition:
    """Build one validated partition using canonical scope names."""
    district_name, taluka_name = _validate_location(district, taluka)
    return _partition(
        district_name,
        taluka_name,
        search_mode,
        year=_normalized_year(year),
        month=_normalized_month(month),
        status_filter=_normalized_filter(status_filter),
        date_from=date_from,
        date_to=date_to,
    )


def generate_partitions(
    *,
    capabilities: PortalCapabilities = CONFIRMED_PORTAL_CAPABILITIES,
    years: Optional[Sequence[object]] = None,
    months: Optional[Sequence[object]] = None,
    statuses: Optional[Sequence[object]] = None,
    date_ranges: Optional[Sequence[tuple[str, str]]] = None,
    include_unfiltered: bool = True,
) -> tuple[SearchPartition, ...]:
    """Generate deterministic partitions without claiming unsupported portal filters."""
    if not capabilities.location_search:
        raise UnsupportedPortalFilterError("location search has no verified portal evidence")
    if not capabilities.pagination:
        raise UnsupportedPortalFilterError("pagination has no verified portal evidence")

    normalized_years = tuple(_normalized_year(year) for year in (years or ()))
    normalized_months = tuple(_normalized_month(month) for month in (months or ()))
    normalized_statuses = tuple(
        _normalized_filter(status) for status in (statuses or ())
    )
    if any(year is not None for year in normalized_years):
        _require_capability(capabilities, "annual_search", "annual")
    if any(month is not None for month in normalized_months):
        _require_capability(capabilities, "monthly_search", "monthly")
    if any(status is not None for status in normalized_statuses):
        _require_capability(capabilities, "status_search", "status")
    if date_ranges:
        _require_capability(capabilities, "date_range_search", "date-range")

    generated: dict[str, SearchPartition] = {}
    for district, talukas in DISTRICT_TALUKAS.items():
        for taluka in talukas:
            if include_unfiltered:
                partition = _partition(district, taluka, "location_unfiltered")
                generated[partition.partition_id] = partition
            for year in normalized_years:
                if year is None:
                    continue
                partition = _partition(district, taluka, "annual", year=year)
                generated[partition.partition_id] = partition
                for month in normalized_months:
                    if month is None:
                        continue
                    partition = _partition(
                        district, taluka, "monthly", year=year, month=month
                    )
                    generated[partition.partition_id] = partition
            for status in normalized_statuses:
                if status is not None:
                    partition = _partition(
                        district, taluka, "status", status_filter=status
                    )
                    generated[partition.partition_id] = partition
            for date_from, date_to in date_ranges or ():
                partition = _partition(
                    district,
                    taluka,
                    "date_range",
                    date_from=date_from,
                    date_to=date_to,
                )
                generated[partition.partition_id] = partition
    return tuple(generated.values())


def partition_ids(partitions: Iterable[SearchPartition]) -> tuple[str, ...]:
    return tuple(partition.partition_id for partition in partitions)
