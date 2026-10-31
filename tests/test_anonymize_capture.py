# SPDX-License-Identifier: MIT
"""Tests for tools/anonymize_capture.py on a small synthetic capture.  python3 -m unittest discover -s tests"""

import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))
import anonymize_capture as anon  # noqa: E402

# Invented values only: locally administered EUI-64s (02:…), no real device, network or entry
IEEE_C, IEEE_R, IEEE_E = "02:00:00:00:00:00:00:01", "02:00:00:00:00:00:00:02", "02:00:00:00:00:00:00:03"
EPID = "02:00:00:00:00:00:ff:01"
ENTRY = "01JZZZZZZZZZZZZZZZZZZZZZZZ"
CAPTURE = {
    "hass_version": "2026.10.2",
    "language": "de",
    "responses": {
        "zha/devices": [
            {"ieee": IEEE_C, "nwk": 0, "device_type": "Coordinator", "name": "Texas Instruments CC2652", "user_given_name": None,
             "device_reg_id": "reg-c", "area_id": None, "last_seen": "2026-03-01T10:00:00", "entities": [],
             "neighbors": [{"ieee": IEEE_R, "nwk": "0x1001", "lqi": "120", "relationship": "Sibling", "extended_pan_id": EPID}],
             "routes": [{"dest_nwk": "0x1001", "next_hop": "0x1001", "route_status": "Active"}]},
            {"ieee": IEEE_R, "nwk": 4097, "device_type": "Router", "name": "Signify Netherlands B.V. LTG002", "user_given_name": "Garden path south 2",
             "device_reg_id": "reg-r", "area_id": "garden_south", "last_seen": "2026-03-01T09:50:00",
             "entities": [{"entity_id": "light.garden_path_south_2", "name": "Garden path south 2"}],
             "neighbors": [{"ieee": IEEE_E, "nwk": "0x1002", "lqi": "176", "relationship": "Child"}], "routes": []},
            {"ieee": IEEE_E, "nwk": 4098, "device_type": "EndDevice", "name": "IKEA of Sweden TRADFRI on/off switch",
             "user_given_name": "Workshop button", "device_reg_id": "reg-e", "area_id": "workshop", "last_seen": "2026-03-01T07:36:00",
             "entities": [], "neighbors": [], "routes": []},
        ],
        "config/device_registry/list": [
            {"id": "reg-r", "identifiers": [["zha", IEEE_R]], "area_id": "garden_south", "name": "LTG002", "name_by_user": "Garden path south 2"},
            {"id": "reg-sun", "identifiers": [["sun", "x"]], "area_id": None, "name": "Sun", "name_by_user": None},
        ],
        "config/area_registry/list": [{"area_id": "garden_south", "name": "Garden south"}, {"area_id": "workshop", "name": "Workshop"}],
        "config_entries/get": [{"entry_id": ENTRY, "domain": "zha", "title": "My stick", "state": "loaded"}],
    },
}


class AnonymizeTest(unittest.TestCase):
    def setUp(self):
        self.out = anon.anonymize(CAPTURE)
        self.text = json.dumps(self.out).lower()

    def test_no_identifying_value_survives(self):
        for value in (IEEE_C, IEEE_R, IEEE_E, EPID, "0200000000000002", "garden", "workshop", "reg-r", ENTRY, "my stick", "sun"):
            self.assertNotIn(value.lower(), self.text, value)

    def test_structure_for_tests_is_kept(self):
        devices = self.out["responses"]["zha/devices"]
        self.assertEqual([d["device_type"] for d in devices], ["Coordinator", "Router", "EndDevice"])
        self.assertEqual(devices[1]["user_given_name"], "Router 01")
        self.assertEqual(devices[2]["user_given_name"], "End device 01")
        self.assertEqual(devices[0]["neighbors"][0]["ieee"], devices[1]["ieee"])  # links still resolve
        self.assertEqual(devices[1]["neighbors"][0]["relationship"], "Child")
        self.assertEqual(devices[0]["routes"][0]["next_hop"], "0x1001")  # NWK addresses are network-local, kept
        self.assertEqual(devices[1]["entities"][0], {"entity_id": "light.router_01_1"})

    def test_registry_keeps_only_zha_devices_and_times_shift(self):
        self.assertEqual(len(self.out["responses"]["config/device_registry/list"]), 1)
        devices = self.out["responses"]["zha/devices"]
        self.assertEqual(devices[0]["last_seen"], "2026-01-01T12:00:00")
        self.assertEqual(devices[2]["last_seen"], "2026-01-01T09:36:00")  # 2 h 24 min before the newest, as before

    def test_short_names_and_bare_hex_are_caught(self):
        capture = json.loads(json.dumps(CAPTURE))
        capture["responses"]["config/area_registry/list"].append({"area_id": "wc", "name": "WC"})
        capture["responses"]["zha/devices"][2]["area_id"] = "wc"
        capture["responses"]["zha/devices"][1]["quirk_class"] = "seen as 0200000000000003 in a log line"
        with self.assertRaises(ValueError):  # the bare hex form of a replaced address is a leak, too
            anon.anonymize(capture)

    def test_time_zones_are_accepted(self):
        capture = json.loads(json.dumps(CAPTURE))
        capture["responses"]["zha/devices"][0]["last_seen"] = "2026-03-01T10:00:00+00:00"
        self.assertEqual(anon.anonymize(capture)["responses"]["zha/devices"][0]["last_seen"], "2026-01-01T12:00:00")

    def test_leak_check_refuses(self):
        capture = json.loads(json.dumps(CAPTURE))
        capture["responses"]["zha/devices"][2]["quirk_class"] = "Workshop button quirk"  # a name inside free text
        with self.assertRaises(ValueError):
            anon.anonymize(capture)


class AllowListTest(unittest.TestCase):
    def test_unknown_fields_are_dropped_at_every_level(self):
        capture = json.loads(json.dumps(CAPTURE))
        r = capture["responses"]
        r["zha/devices"][1]["owner_note"] = "Anna's flat"
        r["zha/devices"][1]["neighbors"][0]["vendor_secret"] = "x"
        r["zha/devices"][1]["entities"][0]["original_name"] = "Anna's lamp"
        r["zha/devices"][0]["routes"][0]["comment"] = "x"
        r["zha/devices"][0]["signature"] = {"endpoints": {"1": {"profile_id": "0x0104", "label": "Anna"}}, "note": "Anna"}
        r["config/device_registry/list"][0]["serial_number"] = "SN-4711"
        r["config/area_registry/list"][0]["aliases"] = ["Anna's room"]
        r["config_entries/get"][0]["data"] = {"device": "/dev/ttyUSB0"}
        r["config/entity_registry/list"] = [{"entity_id": "light.x", "original_name": "Anna"}]  # unknown response
        out = anon.anonymize(capture)
        text = json.dumps(out)
        for leaked in ("Anna", "SN-4711", "ttyUSB0", "vendor_secret", "owner_note", "original_name", "entity_registry"):
            self.assertNotIn(leaked, text)
        self.assertNotIn("config/entity_registry/list", out["responses"])
        self.assertEqual(out["responses"]["zha/devices"][0]["signature"], {"endpoints": {"1": {"profile_id": "0x0104"}}})

    def test_known_fields_are_kept_and_nested_dicts_in_plain_fields_are_dropped(self):
        capture = json.loads(json.dumps(CAPTURE))
        capture["responses"]["zha/devices"][0]["lqi"] = {"nested": "Anna"}  # a plain field must not carry an object
        out = anon.anonymize(capture)["responses"]["zha/devices"][0]
        self.assertIsNone(out["lqi"])
        self.assertEqual(out["neighbors"][0]["relationship"], "Sibling")
        self.assertEqual(out["routes"][0]["route_status"], "Active")

    def test_committed_sample_passes_the_allow_list_unchanged(self):
        sample = json.loads((Path(__file__).parent / "fixtures" / "zha-sample.json").read_text(encoding="utf-8"))
        self.assertEqual(anon.allow_list(sample["responses"]), sample["responses"])


if __name__ == "__main__":
    unittest.main()
