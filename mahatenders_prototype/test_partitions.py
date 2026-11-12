from __future__ import annotations

import unittest

from partitions import (
    CONFIRMED_PORTAL_CAPABILITIES,
    PortalCapabilities,
    UnsupportedPortalFilterError,
    build_partition,
    generate_partitions,
)
from scope import DISTRICT_TALUKAS, canonical_taluka, configured_talukas, district_for_taluka


class PartitionTests(unittest.TestCase):
    def test_exactly_22_configured_talukas(self):
        self.assertEqual(len(configured_talukas()), 22)
        self.assertEqual(len(generate_partitions()), 22)

    def test_district_to_taluka_mapping_is_preserved(self):
        partitions = generate_partitions()
        for partition in partitions:
            self.assertIn(partition.taluka, DISTRICT_TALUKAS[partition.district])
            self.assertEqual(district_for_taluka(partition.taluka), partition.district)

    def test_no_out_of_scope_districts_are_generated(self):
        self.assertEqual(
            {partition.district for partition in generate_partitions()},
            {"Wardha", "Amravati"},
        )

    def test_alias_normalization(self):
        self.assertEqual(canonical_taluka("Selu"), "Seloo")
        self.assertEqual(canonical_taluka("Karanja Ghadge"), "Karanja")
        self.assertEqual(canonical_taluka("Tiwsa"), "Teosa")
        self.assertEqual(build_partition("Wardha", "Selu").taluka, "Seloo")
        with self.assertRaises(ValueError):
            build_partition("Nashik", "Nashik")

    def test_partition_fields_and_database_unknown_status(self):
        partition = generate_partitions()[0]
        self.assertIsNone(partition.year)
        self.assertIsNone(partition.month)
        self.assertIsNone(partition.status_filter)
        self.assertEqual(partition.database_values()["status_filter"], "")
        self.assertIsNone(partition.database_values(legacy_status_filter=False)["status_filter"])

    def test_partition_ids_are_deterministic(self):
        first = generate_partitions()
        second = generate_partitions()
        self.assertEqual([item.partition_id for item in first], [item.partition_id for item in second])
        self.assertEqual(len({item.partition_id for item in first}), 22)

    def test_duplicate_generation_is_deduplicated(self):
        partitions = generate_partitions(
            years=["unknown", None],
            months=["unknown"],
            statuses=["unknown"],
        )
        self.assertEqual(len(partitions), 22)

    def test_unsupported_portal_filters_are_rejected(self):
        for kwargs in (
            {"years": [2024]},
            {"months": [1]},
            {"statuses": ["OPEN"]},
            {"date_ranges": [("2024-01-01", "2024-12-31")]},
        ):
            with self.assertRaises(UnsupportedPortalFilterError):
                generate_partitions(**kwargs)

    def test_supported_capabilities_generate_explicit_partition_modes(self):
        capabilities = PortalCapabilities(
            annual_search=True,
            monthly_search=True,
            status_search=True,
            date_range_search=True,
        )
        partitions = generate_partitions(
            capabilities=capabilities,
            years=[2024],
            months=[1],
            statuses=["OPEN"],
            date_ranges=[("2024-01-01", "2024-01-31")],
        )
        modes = {partition.search_mode for partition in partitions}
        self.assertEqual(modes, {"location_unfiltered", "annual", "monthly", "status", "date_range"})
        self.assertEqual(len(partitions), 22 * 5)

    def test_confirmed_capabilities_do_not_claim_history_filters(self):
        self.assertTrue(CONFIRMED_PORTAL_CAPABILITIES.location_search)
        self.assertTrue(CONFIRMED_PORTAL_CAPABILITIES.pagination)
        self.assertFalse(CONFIRMED_PORTAL_CAPABILITIES.annual_search)
        self.assertFalse(CONFIRMED_PORTAL_CAPABILITIES.monthly_search)
        self.assertFalse(CONFIRMED_PORTAL_CAPABILITIES.status_search)
        self.assertFalse(CONFIRMED_PORTAL_CAPABILITIES.archived_search)


if __name__ == "__main__":
    unittest.main()
