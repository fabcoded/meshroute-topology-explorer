# SPDX-License-Identifier: MIT
"""The four websocket commands: admin check, validation, size limit, store behaviour (stubbed Home Assistant).
python3 -m unittest discover -s tests"""

import json
import pathlib
import sys
import unittest
from unittest import mock

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import ha_stubs

PREFIX = "meshroute_topology_explorer"


class CommandsTest(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch.dict(sys.modules)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.rec = ha_stubs.install()
        root = str(pathlib.Path(__file__).resolve().parent.parent)
        sys.path.insert(0, root)
        self.addCleanup(sys.path.remove, root)
        self.comp = ha_stubs.load()
        self.hass = ha_stubs.FakeHass()
        self.entry = ha_stubs.FakeEntry()
        ha_stubs.run(self.comp.async_setup_entry(self.hass, self.entry))
        self.n = 0

    def call(self, command, admin=True, **fields):
        """Run one command; returns (results, errors) of the connection."""
        self.n += 1
        handler, schema = self.rec.commands[f"{PREFIX}/{command}"]
        msg = {"id": self.n, "type": f"{PREFIX}/{command}", **fields}
        conn = ha_stubs.FakeConnection(admin=admin)
        ha_stubs.run(handler(self.hass, conn, schema(msg)))
        return conn.results, conn.errors

    def test_admin_denied_for_all_commands(self):
        for command, fields in [("settings/get", {}), ("settings/set", {"settings": {}}),
                                ("observations/get", {}), ("observations/set", {"observations": {}})]:
            _, errors = self.call(command, admin=False, network="a", **fields)
            self.assertEqual(errors[0][1], "unauthorized", command)

    def test_bad_network_ids(self):
        for bad in ["", "x" * 65, "a b", "a/b", "ä", None, 5, ["a"]]:
            _, errors = self.call("settings/get", network=bad)
            self.assertEqual(errors[0][1], "invalid_format", repr(bad))
        results, _ = self.call("settings/get", network="A-z_0.9:" + "x" * 56)  # exactly 64
        self.assertEqual(results[0][1], {"settings": None})

    def test_non_object_payload(self):
        for bad in [[], "s", 1, None, True]:
            _, errors = self.call("settings/set", network="a", settings=bad)
            self.assertEqual(errors[0][1], "invalid_format", repr(bad))
        _, errors = self.call("observations/set", network="a")  # field missing
        self.assertEqual(errors[0][1], "invalid_format")

    def test_payload_orjson_cannot_write_is_rejected(self):
        deep = cur = {}
        for _ in range(300):  # beyond orjson's nesting limit of 254
            cur["n"] = {}
            cur = cur["n"]
        _, errors = self.call("settings/set", network="a", settings=deep)
        self.assertEqual(errors[0][1], "invalid_format")
        _, errors = self.call("observations/set", network="a", observations={"x": object()})
        self.assertEqual(errors[0][1], "invalid_format")
        # nothing was stored, so the next save of the whole file cannot be poisoned
        self.assertEqual(self.call("settings/get", network="a")[0][0][1], {"settings": None})

    def test_nesting_just_inside_the_limit_is_accepted(self):
        ok = cur = {}
        for _ in range(250):
            cur["n"] = {}
            cur = cur["n"]
        self.assertEqual(self.call("settings/set", network="a", settings=ok)[0][0][1], {})

    def test_nan_and_non_string_keys_are_accepted_as_orjson_writes_them(self):
        # orjson writes NaN as null and numbers as keys as strings; neither breaks the file.
        self.assertEqual(self.call("settings/set", network="a", settings={"x": float("nan"), 1: 2})[0][0][1], {})

    def test_too_large(self):
        limit = 256 * 1024
        overhead = len(json.dumps({"s": ""}, separators=(",", ":")))
        _, errors = self.call("settings/set", network="a", settings={"s": "x" * (limit - overhead + 1)})
        self.assertEqual(errors[0][1], "payload_too_large")
        results, errors = self.call("settings/set", network="a", settings={"s": "x" * (limit - overhead)})
        self.assertEqual((results[0][1], errors), ({}, []))
        # size is bytes, not characters
        _, errors = self.call("observations/set", network="a", observations={"s": "ä" * limit})
        self.assertEqual(errors[0][1], "payload_too_large")

    def test_get_before_set_is_null(self):
        self.assertEqual(self.call("settings/get", network="a")[0][0][1], {"settings": None})
        self.assertEqual(self.call("observations/get", network="a")[0][0][1], {"observations": None})

    def test_set_then_get_and_replace(self):
        self.assertEqual(self.call("settings/set", network="a", settings={"d": 1, "e": 2})[0][0][1], {})
        self.assertEqual(self.call("settings/get", network="a")[0][0][1], {"settings": {"d": 1, "e": 2}})
        self.call("settings/set", network="a", settings={"d": 3})  # replaces the whole object
        self.assertEqual(self.call("settings/get", network="a")[0][0][1], {"settings": {"d": 3}})

    def test_settings_and_observations_independent(self):
        self.call("settings/set", network="a", settings={"s": 1})
        self.assertEqual(self.call("observations/get", network="a")[0][0][1], {"observations": None})
        self.call("observations/set", network="a", observations={"o": 2})
        self.assertEqual(self.call("settings/get", network="a")[0][0][1], {"settings": {"s": 1}})
        self.assertEqual(self.call("observations/get", network="a")[0][0][1], {"observations": {"o": 2}})

    def test_networks_independent(self):
        self.call("settings/set", network="a", settings={"v": "a"})
        self.call("settings/set", network="b", settings={"v": "b"})
        self.assertEqual(self.call("settings/get", network="a")[0][0][1], {"settings": {"v": "a"}})
        self.assertEqual(self.call("settings/get", network="b")[0][0][1], {"settings": {"v": "b"}})

    def test_delayed_save_writes_whole_file(self):
        self.call("settings/set", network="a", settings={"s": 1})
        self.call("observations/set", network="b", observations={"o": 2})
        (store,) = ha_stubs.FakeStore.instances
        self.assertEqual((store.version, store.key), (1, PREFIX))
        self.assertEqual(len(store.delay_calls), 2)
        data_func, delay = store.delay_calls[-1]
        self.assertGreater(delay, 0)
        self.assertEqual(data_func(), {"networks": {"a": {"settings": {"s": 1}}, "b": {"observations": {"o": 2}}}})

    def test_reads_come_from_memory_after_first_load(self):
        ha_stubs.FakeStore.stored = {"networks": {"a": {"settings": {"old": 1}}}}
        self.assertEqual(self.call("settings/get", network="a")[0][0][1], {"settings": {"old": 1}})
        ha_stubs.FakeStore.stored = None  # the file "disappears"; memory still answers
        self.assertEqual(self.call("settings/get", network="a")[0][0][1], {"settings": {"old": 1}})

    def test_garbage_file_content_is_treated_as_empty(self):
        ha_stubs.FakeStore.stored = {"networks": "nonsense"}
        self.assertEqual(self.call("settings/get", network="a")[0][0][1], {"settings": None})

    def test_load_failure_gives_clean_error_and_never_saves_then_recovers(self):
        ha_stubs.FakeStore.load_error = RuntimeError("newer version")
        _, errors = self.call("settings/get", network="a")
        self.assertEqual(errors[0][1], "storage_unavailable")
        _, errors = self.call("settings/set", network="a", settings={})
        self.assertEqual(errors[0][1], "storage_unavailable")
        self.assertEqual(ha_stubs.FakeStore.instances[0].delay_calls, [])
        ha_stubs.FakeStore.load_error = None
        self.assertEqual(self.call("settings/get", network="a")[0][0][1], {"settings": None})

    def test_wrong_stored_types_count_as_unset(self):
        ha_stubs.FakeStore.stored = {"networks": {"a": "text", "b": {"settings": [1]}, "c": 5}}
        self.assertEqual(self.call("settings/get", network="a")[0][0][1], {"settings": None})
        self.assertEqual(self.call("settings/get", network="b")[0][0][1], {"settings": None})
        self.assertEqual(self.call("settings/set", network="c", settings={"s": 1})[0][0][1], {})
        self.assertEqual(self.call("settings/get", network="c")[0][0][1], {"settings": {"s": 1}})

    def test_remove_entry_deletes_file_and_memory(self):
        ha_stubs.FakeStore.stored = {"networks": {"a": {"settings": {"old": 1}}}}
        self.call("settings/set", network="a", settings={"s": 1})
        ha_stubs.run(self.comp.async_remove_entry(self.hass, None))
        self.assertTrue(ha_stubs.FakeStore.instances[0].removed)
        ha_stubs.FakeStore.stored = None  # file is gone; the next read must not serve the old memory
        self.assertEqual(self.call("settings/get", network="a")[0][0][1], {"settings": None})

    def test_commands_survive_unload(self):
        self.call("settings/set", network="a", settings={"s": 1})
        ha_stubs.run(self.comp.async_unload_entry(self.hass, self.entry))
        self.assertEqual(self.call("settings/get", network="a")[0][0][1], {"settings": {"s": 1}})
        self.assertEqual(len(ha_stubs.FakeStore.instances), 1)


if __name__ == "__main__":
    unittest.main()
