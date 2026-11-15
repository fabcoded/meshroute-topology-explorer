# SPDX-License-Identifier: MIT
"""meshroute_topology_explorer/thread_border_agents (#21): border agents from Home Assistant's mDNS cache, read only,
with fakes for Home Assistant's zeroconf helper and zeroconf's record cache (the real cache and records:
tests_ha/test_zeroconf_contract.py).

Cases: extended address, extended PAN id and partition id from the TXT data (RFC 6763 section 6 strings, written by
hand below), nothing else of a record in the answer; a partition id absent, of a wrong length, 0 and 0xFFFFFFFF; a
record without an 8-byte extended address or extended PAN id left out; the age from the record's creation time, null
where it is no number; expired records skipped; TXT data with keys in another case, a repeated key, a string without
'=' and one cut short; zeroconf not loaded (and then no instance asked for, which would create one), changed
internals, an unexpected error, a non-admin; nothing but the two cache lookups is touched.
python3 -m unittest discover -s tests
"""

import pathlib
import sys
import types
import unittest
from unittest import mock

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import ha_stubs

COMMAND = "meshroute_topology_explorer/thread_border_agents"
TYPE = "_meshcop._udp.local."


def txt(*pairs):
    """TXT data as RFC 6763 6.1 writes it: per string one length byte, then "key=value" (or the bytes as given)."""
    out = b""
    for pair in pairs:
        data = pair if isinstance(pair, bytes) else pair[0] + b"=" + pair[1]
        out += bytes([len(data)]) + data
    return out


class Record:
    """A cached record: what the command may read (alias, text, created, is_expired) and nothing else."""

    def __init__(self, created=1_000_000.0, ttl=4500, **fields):
        self.created, self.ttl = created, ttl
        self.__dict__.update(fields)

    def is_expired(self, now):
        return isinstance(self.created, float) and self.created + self.ttl * 1000 <= now


class Cache:
    """zeroconf's DNSCache as far as the command may use it; every lookup is logged."""

    def __init__(self):
        self.pointers, self.texts, self.log = [], {}, []

    def async_all_by_details(self, name, type_, class_):
        self.log.append(("all", name, type_, class_))
        return list(self.pointers) if (name, type_, class_) == (TYPE, 12, 1) else []

    def get_by_details(self, name, type_, class_):
        self.log.append(("get", name, type_, class_))
        return self.texts.get(name) if (type_, class_) == (16, 1) else None


class Strict:
    """Any attribute but the ones given is a call the command must never make (a query, a browser, a send)."""

    def __init__(self, **allowed):
        self.__dict__.update(allowed)

    def __getattr__(self, name):
        raise AssertionError(f"the command touched {name}")


XA, XA2, XP = bytes.fromhex("aabbccdd00000110"), bytes.fromhex("AABBCCDD00000111"), bytes.fromhex("aabbccddeeff0101")


class BorderAgentsTest(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch.dict(sys.modules)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.rec = ha_stubs.install()
        root = str(pathlib.Path(__file__).resolve().parent.parent)
        sys.path.insert(0, root)
        self.addCleanup(sys.path.remove, root)
        self.comp = ha_stubs.load()
        self.hass = ha_stubs.FakeHass(components={"zeroconf"})
        ha_stubs.run(self.comp.async_setup_entry(self.hass, ha_stubs.FakeEntry()))
        self.addCleanup(lambda: [task.close() for task in self.hass.tasks])
        self.cache = Cache()
        self.asked = []
        self.instance = Strict(zeroconf=Strict(cache=self.cache))

        def get_instance(hass):
            self.asked.append(hass)
            return self.instance

        sys.modules["homeassistant.components.zeroconf"] = types.ModuleType("homeassistant.components.zeroconf")
        sys.modules["homeassistant.components.zeroconf"].async_get_async_zeroconf = get_instance
        sys.modules["zeroconf"] = types.ModuleType("zeroconf")
        sys.modules["zeroconf"].current_time_millis = lambda: 1_090_000.0  # 90 s after the default creation time

    def add(self, name, text, **record):
        self.cache.pointers.append(Record(alias=f"{name}.{TYPE}"))
        self.cache.texts[f"{name}.{TYPE}"] = Record(text=text, **record)

    def call(self, admin=True):
        handler, schema = self.rec.commands[COMMAND]
        conn = ha_stubs.FakeConnection(admin=admin)
        ha_stubs.run(handler(self.hass, conn, schema({"id": 1, "type": COMMAND})))
        return conn.results, conn.errors

    def agents(self):
        results, errors = self.call()
        self.assertEqual(errors, [])
        return results[0][1]["agents"]

    def test_21_extended_address_pan_id_partition_and_age_and_nothing_else(self):
        self.add("Garage", txt((b"rv", b"1"), (b"id", b"\x01" * 16), (b"nn", b"home"), (b"xp", XP), (b"tv", b"1.4.0"),
                               (b"xa", XA), (b"sb", b"\x00\x00\x06\x31"), (b"pt", b"\x89\xab\xcd\xef"),
                               (b"omr", b"\x40\xfd" + b"\x00" * 7), (b"dn", b"DefaultDomain")))
        self.add("Attic", txt((b"xa", XA2), (b"xp", XP), (b"pt", b"\x00\x00\x01\x00")), created=1_030_000.0)
        results, errors = self.call()
        self.assertEqual(errors, [])
        answer = results[0][1]
        self.assertEqual(set(answer), {"agents", "read_at"})
        self.assertIsInstance(answer["read_at"], float)
        self.assertEqual(answer["agents"], [
            {"ext_address": "aabbccdd00000110", "ext_pan_id": "aabbccddeeff0101", "partition_id": 0x89ABCDEF, "age": 90.0},
            {"ext_address": "aabbccdd00000111", "ext_pan_id": "aabbccddeeff0101", "partition_id": 256, "age": 60.0}])

    def test_21_partition_id_absent_or_of_a_wrong_length_is_null_0_and_the_maximum_are_values(self):
        for name, pt, expected in (("none", None, None), ("three", b"\x01\x02\x03", None),
                                   ("five", b"\x00\x00\x00\x01\x00", None), ("empty", b"", None),
                                   ("zero", b"\x00\x00\x00\x00", 0), ("max", b"\xff\xff\xff\xff", 4294967295)):
            with self.subTest(name):
                self.cache.pointers.clear()
                self.add(name, txt((b"xa", XA), (b"xp", XP), *([(b"pt", pt)] if pt is not None else [])))
                self.assertEqual(self.agents()[0]["partition_id"], expected)

    def test_21_no_8_byte_extended_address_or_pan_id_leaves_the_record_out(self):
        self.add("no_xa", txt((b"xp", XP), (b"pt", b"\x00\x00\x00\x01")))
        self.add("short_xa", txt((b"xa", XA[:7]), (b"xp", XP), (b"pt", b"\x00\x00\x00\x01")))
        self.add("long_xp", txt((b"xa", XA), (b"xp", XP + b"\x00"), (b"pt", b"\x00\x00\x00\x01")))
        self.add("no_xp", txt((b"xa", XA)))
        self.assertEqual(self.agents(), [])

    def test_21_age_from_the_creation_time_null_where_it_is_no_number(self):
        self.add("a", txt((b"xa", XA), (b"xp", XP)), created=1_089_950.0)
        self.add("b", txt((b"xa", XA2), (b"xp", XP)), created=None, ttl=10**9)
        self.add("c", txt((b"xa", bytes(8)), (b"xp", XP)), created=True, ttl=10**9)
        self.add("d", txt((b"xa", b"\x11" * 8), (b"xp", XP)), created=1_100_000.0)  # after now: no age
        ages = {a["ext_address"]: a["age"] for a in self.agents()}
        self.assertEqual(ages, {"aabbccdd00000110": 0.1, "aabbccdd00000111": None, "0000000000000000": None,
                                "1111111111111111": None})

    def test_21_expired_pointer_or_txt_record_and_a_missing_txt_record_are_skipped(self):
        self.add("old_txt", txt((b"xa", XA), (b"xp", XP)), created=1_000_000.0, ttl=90)  # expires exactly now
        self.add("old_ptr", txt((b"xa", XA2), (b"xp", XP)))
        self.cache.pointers[-1].ttl = 1
        self.cache.pointers.append(Record(alias=f"gone.{TYPE}"))
        self.add("live", txt((b"xa", bytes(8)), (b"xp", XP)), created=1_000_000.0, ttl=91)
        self.assertEqual([a["ext_address"] for a in self.agents()], ["0000000000000000"])

    def test_21_txt_data_keys_in_any_case_first_wins_no_value_and_cut_short(self):
        # "pt" without "=" is the key's first occurrence (no value), so the later "pt=..." is ignored (RFC 6763 6.4).
        self.add("x", txt((b"XA", XA), (b"xa", XA2), (b"Xp", XP), b"pt", (b"pt", b"\x00\x00\x00\x07")))
        self.assertEqual(self.agents(), [{"ext_address": "aabbccdd00000110", "ext_pan_id": "aabbccddeeff0101",
                                          "partition_id": None, "age": 90.0}])
        agents = ha_stubs.load(".thread_border_agents")
        self.assertEqual(agents.txt_values(b""), {})
        self.assertEqual(agents.txt_values(b"\x00\x03a=b\x03==x\x03b=c"), {b"a": b"b", b"b": b"c"},
                         "an empty string and an empty key are skipped")
        self.assertEqual(agents.txt_values(b"\x03a=b\x09pt=\x00"), {b"a": b"b"}, "a string cut short is ignored")
        self.assertEqual(agents.txt_values(txt((b"Pt", b"\x00\x00\x00\x01"))), {b"pt": b"\x00\x00\x00\x01"})
        # A binary value may hold "=" (0x3D): only the first "=" separates key and value.
        self.cache.pointers.clear()
        self.add("eq", txt((b"xa", XA), (b"xp", XP), (b"pt", b"\x00=\x00\x01")))
        self.assertEqual(self.agents()[0]["partition_id"], 0x003D0001)

    def test_21_two_records_of_one_border_agent_both_go_out_newest_first(self):
        self.add("Garage", txt((b"xa", XA), (b"xp", XP), (b"pt", b"\x00\x00\x00\x01")), created=1_000_000.0)
        self.add("Garage (2)", txt((b"xa", XA), (b"xp", XP), (b"pt", b"\x00\x00\x00\x02")), created=1_080_000.0)
        self.assertEqual([(a["partition_id"], a["age"]) for a in self.agents()], [(2, 10.0), (1, 90.0)])

    def test_21_only_the_two_cache_lookups_are_used(self):
        self.add("Garage", txt((b"xa", XA), (b"xp", XP)))
        self.agents()
        self.assertEqual(self.cache.log, [("all", TYPE, 12, 1), ("get", f"Garage.{TYPE}", 16, 1)])

    def test_21_reasons(self):
        self.hass.config.components.discard("zeroconf")
        self.assertEqual(self.call()[1][0][1:], ("not_supported", "zeroconf_not_loaded: zeroconf is not loaded"))
        self.assertEqual(self.asked, [], "no instance asked for: Home Assistant would create one")
        self.hass.config.components.add("zeroconf")
        self.instance = Strict(zeroconf=Strict(cache=None))
        self.assertTrue(self.call()[1][0][2].startswith("internals_changed:"))
        self.instance = Strict(zeroconf=Strict(cache=self.cache))
        self.cache.pointers.append(Record())  # a pointer without alias
        self.assertTrue(self.call()[1][0][2].startswith("internals_changed:"))
        self.cache.pointers[:] = [Record(alias=f"x.{TYPE}")]
        self.cache.texts[f"x.{TYPE}"] = Record(text=None)
        self.assertTrue(self.call()[1][0][2].startswith("internals_changed:"))
        del sys.modules["zeroconf"]
        sys.modules["zeroconf"] = None  # import fails
        self.assertTrue(self.call()[1][0][2].startswith("internals_changed:"))
        sys.modules["zeroconf"] = types.ModuleType("zeroconf")
        sys.modules["zeroconf"].current_time_millis = lambda: 1 / 0
        self.assertEqual(self.call()[1][0][1:], ("not_supported", "error: ZeroDivisionError"))
        _, errors = self.call(admin=False)
        self.assertEqual(errors[0][1], "unauthorized")


if __name__ == "__main__":
    unittest.main()
