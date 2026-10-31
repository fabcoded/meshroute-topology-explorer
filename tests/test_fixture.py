# SPDX-License-Identifier: MIT
"""Checks on the committed fixture: only synthetic addresses, links resolve.  python3 -m unittest discover -s tests"""

import json
import re
import unittest
from pathlib import Path

FIXTURES = sorted((Path(__file__).resolve().parent / "fixtures").glob("*.json"))
FIXTURE = Path(__file__).resolve().parent / "fixtures" / "zha-sample.json"
EUI64 = re.compile(r"\b[0-9a-f]{2}(?::[0-9a-f]{2}){7}\b")
HEX64 = re.compile(r"\b(?:0x)?([0-9a-f]{16})\b")


class FixtureTest(unittest.TestCase):
    def setUp(self):
        self.text = FIXTURE.read_text(encoding="utf-8")
        self.devices = json.loads(self.text)["responses"]["zha/devices"]

    def test_every_address_in_every_fixture_is_synthetic(self):
        # anonymize_capture.py writes aa:bb:cc:dd:…; anything else would be a real address that slipped through
        for path in FIXTURES:
            text = path.read_text(encoding="utf-8").lower()
            self.assertTrue(all(eui.startswith("aa:bb:cc:dd:") for eui in EUI64.findall(text)), path.name)
            self.assertTrue(all(h.startswith("aabbccdd") for h in HEX64.findall(text)), path.name)

    def test_neighbours_point_at_known_devices(self):
        known = {d["ieee"] for d in self.devices}
        for device in self.devices:
            for entry in device.get("neighbors") or []:
                self.assertIn(entry["ieee"], known)

    def test_shape(self):
        types = [d["device_type"] for d in self.devices]
        self.assertEqual(types.count("Coordinator"), 1)
        self.assertGreater(types.count("Router"), 10)


if __name__ == "__main__":
    unittest.main()
