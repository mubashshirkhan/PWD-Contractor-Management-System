from __future__ import annotations

import re
from typing import Dict, Optional


DISTRICT_TALUKAS: Dict[str, tuple[str, ...]] = {
    "Wardha": (
        "Wardha",
        "Seloo",
        "Deoli",
        "Hinganghat",
        "Samudrapur",
        "Karanja",
        "Arvi",
        "Ashti",
    ),
    "Amravati": (
        "Amravati",
        "Bhatkuli",
        "Nandgaon Khandeshwar",
        "Daryapur",
        "Anjangaon Surji",
        "Achalpur",
        "Chandurbazar",
        "Chikhaldara",
        "Dharni",
        "Morshi",
        "Warud",
        "Chandur Railway",
        "Teosa",
        "Dhamangaon Railway",
    ),
}

TALUKA_ALIASES = {
    "selu": "Seloo",
    "karanja ghadge": "Karanja",
    "tiwsa": "Teosa",
}


def configured_talukas() -> tuple[str, ...]:
    return tuple(taluka for talukas in DISTRICT_TALUKAS.values() for taluka in talukas)


def normalize_location(value: Optional[str]) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (value or "").casefold()).strip()


def scope_configuration() -> dict[str, object]:
    return {
        "districts": {
            district: {
                "talukas": list(talukas),
                "aliases": {
                    alias: canonical
                    for alias, canonical in TALUKA_ALIASES.items()
                    if any(canonical == taluka for taluka in talukas)
                },
            }
            for district, talukas in DISTRICT_TALUKAS.items()
        },
        "matching": "explicit tender location fields only; organisation names are not used",
    }


def canonical_taluka(value: Optional[str]) -> Optional[str]:
    normalized = normalize_location(value)
    if not normalized:
        return None
    for district_talukas in DISTRICT_TALUKAS.values():
        for taluka in district_talukas:
            if normalize_location(taluka) == normalized:
                return taluka
    return TALUKA_ALIASES.get(normalized)


def canonical_district(value: Optional[str]) -> Optional[str]:
    normalized = normalize_location(value)
    for district in DISTRICT_TALUKAS:
        if normalize_location(district) == normalized:
            return district
    return None


def district_for_taluka(taluka: Optional[str]) -> Optional[str]:
    canonical = canonical_taluka(taluka)
    if not canonical:
        return None
    for district, talukas in DISTRICT_TALUKAS.items():
        if canonical in talukas:
            return district
    return None


def classify_location(raw_location: Optional[str]) -> dict[str, Optional[str]]:
    raw = (raw_location or "").strip()
    normalized = normalize_location(raw)
    if not normalized:
        return {
            "scope_status": "UNKNOWN",
            "scope_district": None,
            "scope_taluka": None,
            "scope_provenance": "location.missing",
        }

    all_talukas = {normalize_location(taluka_name): (district_name, taluka_name)
                   for district_name, talukas in DISTRICT_TALUKAS.items()
                   for taluka_name in talukas}
    for alias, canonical in TALUKA_ALIASES.items():
        owner = next(
            (district_name for district_name, talukas in DISTRICT_TALUKAS.items() if canonical in talukas),
            None,
        )
        if owner:
            all_talukas[normalize_location(alias)] = (owner, canonical)
    district_matches = []
    taluka: Optional[str] = None
    for candidate in DISTRICT_TALUKAS:
        district_normalized = normalize_location(candidate)
        if re.search(r"\b%s\b" % re.escape(district_normalized), normalized):
            district_matches.append(candidate)
    if len(district_matches) > 1:
        return {
            "scope_status": "UNKNOWN",
            "scope_district": None,
            "scope_taluka": None,
            "scope_provenance": "location.raw_conflicting_districts",
        }
    district = district_matches[0] if district_matches else None
    taluka_matches = []
    for candidate, (owner, canonical) in all_talukas.items():
        if district and canonical == district and normalized != candidate:
            continue
        match = re.search(r"\b%s\b" % re.escape(candidate), normalized)
        if match:
            taluka_matches.append((match.start(), -len(candidate), owner, canonical, candidate))
    unique_talukas = {(owner, canonical) for _, _, owner, canonical, _ in taluka_matches}
    if len(unique_talukas) > 1:
        return {
            "scope_status": "UNKNOWN",
            "scope_district": None,
            "scope_taluka": None,
            "scope_provenance": "location.raw_conflicting_talukas",
        }
    if unique_talukas:
        taluka_owner, taluka = next(iter(unique_talukas))
        if district and district != taluka_owner:
            return {
                "scope_status": "UNKNOWN",
                "scope_district": None,
                "scope_taluka": None,
                "scope_provenance": "location.raw_conflicting_district_taluka",
            }
        provenance = "location.raw_explicit;district.scope_config"
        alias_used = any(
            candidate in TALUKA_ALIASES
            for _, _, owner, canonical, candidate in taluka_matches
            if owner == taluka_owner and canonical == taluka
        )
        provenance += ";taluka.scope_alias" if alias_used else ";taluka.scope_config"
        return {
            "scope_status": "IN_SCOPE",
            "scope_district": taluka_owner,
            "scope_taluka": taluka,
            "scope_provenance": provenance,
        }
    if district in DISTRICT_TALUKAS and not taluka:
        return {
            "scope_status": "IN_SCOPE",
            "scope_district": district,
            "scope_taluka": None,
            "scope_provenance": "location.raw_explicit;district.scope_config",
        }
    return {
        "scope_status": "OUT_OF_SCOPE",
        "scope_district": None,
        "scope_taluka": None,
        "scope_provenance": "location.raw_explicit;district.outside_config",
    }
