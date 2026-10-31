# SPDX-License-Identifier: MIT
"""The derived fixtures are exactly what tools/make_derived_fixtures.py writes.  python3 -m unittest discover -s tests"""

import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))
import make_derived_fixtures as gen  # noqa: E402

FIXTURES = Path(__file__).resolve().parent / "fixtures"


class DerivedFixturesTest(unittest.TestCase):
    def setUp(self):
        self.sample = json.loads((FIXTURES / "zha-sample.json").read_text(encoding="utf-8"))

    def test_committed_files_match_the_generator(self):
        ranked = gen.rank_routers(self.sample["responses"]["zha/devices"])
        every_router = {d["ieee"] for d in self.sample["responses"]["zha/devices"] if d["device_type"] == "Router"}
        expected = {"minus1": set(ranked[:1]), "minus3": set(ranked[:3]), "coordinator-only": every_router}
        for name, removed in expected.items():
            fixture = json.loads((FIXTURES / f"zha-sample-{name}.json").read_text(encoding="utf-8"))
            self.assertEqual(fixture["derived"]["removed_tables"], sorted(removed), name)
            for device in fixture["responses"]["zha/devices"]:
                if device["ieee"] in removed:
                    self.assertEqual((device["neighbors"], device["routes"]), ([], []))

    def test_everything_else_is_untouched(self):
        fixture = json.loads((FIXTURES / "zha-sample-minus3.json").read_text(encoding="utf-8"))
        removed = set(fixture["derived"]["removed_tables"])
        for a, b in zip(self.sample["responses"]["zha/devices"], fixture["responses"]["zha/devices"]):
            if a["ieee"] not in removed:
                self.assertEqual(a, b)

    def test_coordinator_keeps_its_table(self):
        fixture = json.loads((FIXTURES / "zha-sample-coordinator-only.json").read_text(encoding="utf-8"))
        coordinator = next(d for d in fixture["responses"]["zha/devices"] if d["device_type"] == "Coordinator")
        self.assertTrue(coordinator["neighbors"] and coordinator["routes"])


if __name__ == "__main__":
    unittest.main()
