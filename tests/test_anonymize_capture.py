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


# Thread through Matter (spec 3.2): invented values only.
EXT_A, EXT_B, EXT_BR = "02000000000000A1", "02000000000000a2", "02000000000000B3"
TOPOLOGY = {
    "collected_at": 1793563979505,
    "nodes": [
        {"id": "7", "kind": "matter", "network_type": "thread", "node_id": 7, "role": "leader", "available": True,
         "ext_address": EXT_A, "rloc16": 1024, "ext_pan_id": "02000000000000ee", "network_name": "home-thread-x",
         "vendor_name": None, "model_name": None, "last_seen": None, "ha_device_id": "regmatter7", "secret_extra": "x"},
        {"id": "9", "kind": "matter", "network_type": "thread", "node_id": 9, "role": "sleepy_end_device",
         "available": True, "ext_address": EXT_B, "ext_pan_id": "02000000000000ee", "network_name": "home-thread-x",
         "ha_device_id": "regmatter9"},
        {"id": "br_" + EXT_BR, "kind": "border_router", "network_type": "thread", "node_id": None, "role": "router",
         "available": None, "ext_address": EXT_BR.lower(), "ext_pan_id": "02000000000000ee",
         "network_name": "home-thread-x", "vendor_name": "Home Assistant", "model_name": "OpenThread Border Router",
         "host_name": "my-house-otbr", "last_seen": 1793562635070, "ha_device_id": None},
    ],
    "connections": [
        {"source": "7", "target": "9", "network": "thread", "strength": "strong",
         "source_to_target": {"strength": "medium", "lqi": 2, "rssi": -85, "extra": 1},
         "target_to_source": {"strength": "strong", "lqi": 3, "rssi": -75}, "via_route_table": None, "path_cost": 0},
        {"source": "7", "target": "br_" + EXT_BR, "network": "thread", "strength": "strong",
         "source_to_target": {"strength": "strong", "lqi": 3, "rssi": -70}, "target_to_source": None,
         "via_route_table": None, "path_cost": 1},
    ],
}
THREAD_CAPTURE = {"responses": {
    "matter/network_topology": TOPOLOGY,
    "config/device_registry/list": [
        {"id": "regmatter7", "identifiers": [["matter", "deviceid_X-7"]], "area_id": "kitchen", "name": "Kitchen lamp",
         "name_by_user": "Lamp over the table"},
        {"id": "regother", "identifiers": [["hue", "y"]], "area_id": None, "name": "Other", "name_by_user": None},
    ],
    "config/area_registry/list": [{"area_id": "kitchen", "name": "Kitchen"}],
}}


class AnonymizeThreadTest(unittest.TestCase):
    def setUp(self):
        self.out = anon.anonymize(THREAD_CAPTURE)
        self.text = json.dumps(self.out).lower()
        self.topo = self.out["responses"]["matter/network_topology"]

    def test_no_identifying_value_survives(self):
        for value in (EXT_A, EXT_B, EXT_BR, "02000000000000ee", "home-thread-x", "my-house-otbr", "regmatter7",
                      "kitchen", "lamp over the table", "deviceid_x-7", "1793563979505"):
            self.assertNotIn(value.lower(), self.text, value)

    def test_links_still_resolve_and_values_are_kept(self):
        ids = [n["id"] for n in self.topo["nodes"]]
        for c in self.topo["connections"]:
            self.assertIn(c["source"], ids)
            self.assertIn(c["target"], ids)
        self.assertTrue(ids[2].startswith("br_"))
        self.assertEqual(self.topo["nodes"][2]["ext_address"].upper(), ids[2][3:])
        self.assertEqual(self.topo["connections"][0]["source_to_target"], {"strength": "medium", "lqi": 2, "rssi": -85})
        self.assertIsNone(self.topo["connections"][1]["target_to_source"], "an absent direction stays null")
        self.assertEqual(self.topo["nodes"][0]["role"], "leader")
        self.assertEqual(self.topo["nodes"][0]["rloc16"], 1024)
        self.assertEqual(self.topo["nodes"][2]["model_name"], "OpenThread Border Router")
        self.assertNotIn("secret_extra", self.topo["nodes"][0])

    def test_times_shift_to_the_anchor_with_gaps_kept(self):
        self.assertEqual(self.topo["collected_at"], 1767268800000)
        self.assertEqual(self.topo["collected_at"] - self.topo["nodes"][2]["last_seen"], 1793563979505 - 1793562635070)

    def test_registry_keeps_matter_nodes_with_neutral_names(self):
        registry = self.out["responses"]["config/device_registry/list"]
        self.assertEqual(len(registry), 1)
        self.assertEqual(registry[0]["name"], "Matter node 7")
        self.assertNotIn("name_by_user", registry[0])
        self.assertEqual(registry[0]["id"], self.topo["nodes"][0]["ha_device_id"])

    def test_committed_matter_sample_passes_the_allow_list_unchanged(self):
        path = Path(__file__).resolve().parent / "fixtures" / "matter-sample.json"
        fixture = json.loads(path.read_text(encoding="utf-8"))
        self.assertEqual(anon.allow_list(fixture["responses"]), fixture["responses"])


if __name__ == "__main__":
    unittest.main()
