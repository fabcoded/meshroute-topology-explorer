# SPDX-License-Identifier: MIT
"""Reception history: day files (append, dedupe, retention, damaged lines), the sources through a fake websocket
registry (fixture-shaped answers, not-supported paths), the recorder and the read commands.
python3 -m unittest discover -s tests"""

import asyncio
import json
import sys
import tempfile
import unittest
from datetime import UTC, datetime
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).parent))
import ha_stubs

FIXTURES = Path(__file__).parent / "fixtures"
DAY = datetime(2026, 11, 1, 12, 0, tzinfo=UTC).timestamp()
H = 3600


def load_history():
    return ha_stubs.load(".history").HistoryFiles


class FilesTest(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch.dict(sys.modules)
        patcher.start()
        self.addCleanup(patcher.stop)
        ha_stubs.install()
        root = str(Path(__file__).resolve().parent.parent)
        sys.path.insert(0, root)
        self.addCleanup(sys.path.remove, root)
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.files = load_history()(Path(self.tmp.name) / "h")

    @staticmethod
    def put(files, network, t, entries, **extra):
        """Append; a plain dict is the neighbour part of a snapshot."""
        snapshot = entries if isinstance(entries, tuple) else ha_stubs.load(".history").Snapshot(entries, **extra)
        return files.append(network, t, snapshot)

    def lines(self, name):
        return [json.loads(x) for x in (self.files.folder / name).read_text().splitlines()]

    def test_day_file_format_with_key_table_and_dedupe(self):
        a = {("r", "s"): (131, None), ("s", "r"): (64, None)}
        self.assertTrue(self.put(self.files, "zha1", DAY, a))
        self.assertFalse(self.put(self.files, "zha1", DAY + 3 * H, a))  # unchanged: time only
        self.assertTrue(self.put(self.files, "zha1", DAY + 6 * H, {**a, ("r", "t"): (2, -80)}))
        name = "zha1.2026-11-01.jsonl"
        got = self.lines(name)
        self.assertEqual(got[0], {"k": ["r", "s"]})
        self.assertEqual(got[1], {"t": int(DAY), "e": [[0, 1, 131], [1, 0, 64]]})
        self.assertEqual(got[2], {"t": int(DAY + 3 * H)})
        self.assertEqual(got[3], {"k": ["t"]})  # only the new key; no rewrite of the table
        self.assertEqual(got[4]["e"][1], [0, 2, 2, -80])
        self.assertEqual(self.files.info()["records"], 3)

    def test_routes_and_relays_are_part_of_the_record_and_of_the_dedupe(self):
        n = {("r", "s"): (1, None)}
        routes, relays = (("r", "s", "t", "Active"), ("r", "0x2B82", "s", "Active")), (("s", ("t", "0x0077")), ("t", ()))
        self.assertTrue(self.put(self.files, "n", DAY, n, routes=routes, relays=relays))
        self.assertFalse(self.put(self.files, "n", DAY + H, n, routes=routes, relays=relays))
        self.assertTrue(self.put(self.files, "n", DAY + 2 * H, n, routes=routes[:1], relays=relays))  # a route went
        got = self.lines("n.2026-11-01.jsonl")
        self.assertEqual(got[0], {"k": ["r", "s", "t", "0x2B82", "0x0077"]})
        self.assertEqual(got[1]["r"], [[0, 1, 2, "Active"], [0, 3, 1, "Active"]])
        self.assertEqual(got[1]["l"], [[1, [2, 4]], [2, []]])
        self.assertNotIn("e", got[2])
        self.assertEqual(len(got[3]["r"]), 1)

    def test_parent_links_format_dedupe_and_a_child_moving(self):
        n = {("p1", "c"): (50, None)}
        self.assertTrue(self.put(self.files, "n", DAY, n, parents=(("c", "p1"),)))
        self.assertFalse(self.put(self.files, "n", DAY + H, n, parents=(("c", "p1"),)))
        self.assertTrue(self.put(self.files, "n", DAY + 2 * H, n, parents=(("c", "p2"),)))  # same table, new parent
        got = self.lines("n.2026-11-01.jsonl")
        self.assertEqual(got[0], {"k": ["p1", "c"]})
        self.assertEqual(got[1]["p"], [[1, 0]])
        self.assertEqual(got[3], {"k": ["p2"]})
        self.assertEqual(got[4]["p"], [[1, 2]])
        out = self.files.records("n", DAY, DAY + 3 * H)
        self.assertEqual([r.get("p") for r in out["records"]], [[[1, 0]], None, [[1, 2]]])
        self.assertEqual(out["k"][2], "p2")
        self.assertNotIn("p", self.lines("n.2026-11-01.jsonl")[0])

    def test_records_range_with_one_key_table_across_days(self):
        n = {("r", "s"): (1, None)}
        self.put(self.files, "n", DAY, n)
        self.put(self.files, "n", DAY + H, n)  # time only
        self.put(self.files, "n", DAY + 24 * H, {("r", "x"): (2, None)}, routes=(("r", "x", "s", "Active"),))
        out = self.files.records("n", DAY, DAY + 30 * H)
        self.assertEqual(out["k"], ["r", "s", "x"])
        self.assertEqual(out["records"], [{"t": int(DAY), "e": [[0, 1, 1]]}, {"t": int(DAY + H)},
                                          {"t": int(DAY + 24 * H), "e": [[0, 2, 2]], "r": [[0, 2, 1, "Active"]]}])
        later = self.files.records("n", DAY + H, DAY + 2 * H)  # the first record of a range is full
        self.assertEqual(later["records"], [{"t": int(DAY + H), "e": [[0, 1, 1]]}])
        self.assertEqual(self.files.records("other", 0, DAY * 2), {"k": [], "records": []})

    def test_first_record_of_a_day_is_full_even_if_equal(self):
        a = {("r", "s"): (5, None)}
        self.put(self.files, "n", DAY, a)
        self.put(self.files, "n", DAY + 24 * H, a)
        second = self.lines("n.2026-11-02.jsonl")
        self.assertEqual(second[0], {"k": ["r", "s"]})
        self.assertIn("e", second[1])

    def test_restart_does_not_repeat_a_full_record(self):
        a = {("r", "s"): (5, None)}
        self.put(self.files, "n", DAY, a)
        fresh = load_history()(self.files.folder)  # new process: nothing in memory
        self.assertFalse(self.put(fresh, "n", DAY + H, a))
        self.assertEqual(self.lines("n.2026-11-01.jsonl")[-1], {"t": int(DAY + H)})

    def test_series_both_directions_and_since(self):
        self.put(self.files, "n", DAY, {("r", "s"): (131, None), ("s", "r"): (60, None)})
        self.put(self.files, "n", DAY + 3 * H, {("r", "s"): (131, None), ("s", "r"): (60, None)})
        self.put(self.files, "n", DAY + 24 * H, {("r", "s"): (64, None)})
        self.assertEqual(self.files.series("n", "r", "s", DAY),
                         [[int(DAY), 131], [int(DAY + 3 * H), 131], [int(DAY + 24 * H), 64]])
        self.assertEqual(self.files.series("n", "s", "r", DAY + H), [[int(DAY + 3 * H), 60]])
        self.assertEqual(self.files.series("n", "r", "x", DAY), [])  # unknown lane: no points, no error
        self.assertEqual(self.files.series("other", "r", "s", DAY), [])

    def test_series_carries_rssi_and_null_lqi(self):
        self.put(self.files, "n", DAY, {("r", "s"): (None, -71)})
        self.assertEqual(self.files.series("n", "r", "s", 0), [[int(DAY), None, -71]])

    def test_retention_deletes_day_files_only(self):
        for d in range(5):
            self.put(self.files, "n", DAY + d * 24 * H, {("r", "s"): (d, None)})
        self.assertEqual(self.files.prune(DAY + 4 * 24 * H, keep_days=2), 2)  # 11-01 and 11-02 are gone
        names = sorted(p.name for p in self.files.folder.iterdir())
        self.assertEqual(names, ["n.2026-11-03.jsonl", "n.2026-11-04.jsonl", "n.2026-11-05.jsonl"])
        (self.files.folder / "notes.txt").write_text("x")  # not ours: never touched
        self.files.prune(DAY + 400 * 24 * H, keep_days=1)
        self.assertTrue((self.files.folder / "notes.txt").exists())

    def test_a_damaged_line_costs_one_record(self):
        self.put(self.files, "n", DAY, {("r", "s"): (1, None)})
        self.put(self.files, "n", DAY + H, {("r", "s"): (2, None)})
        path = self.files.folder / "n.2026-11-01.jsonl"
        path.write_text(path.read_text() + '{"t": 17, "e": [[0,\n')  # a damaged line, newline-terminated
        self.assertEqual(self.files.info()["records"], 2)
        self.assertEqual(len(self.files.series("n", "r", "s", 0)), 2)

    def test_a_torn_last_line_without_newline_costs_only_its_own_record(self):
        self.put(self.files, "n", DAY, {("r", "s"): (1, None)})
        path = self.files.folder / "n.2026-11-01.jsonl"
        with path.open("ab") as handle:
            handle.write(b'{"t":99,"e":[[0,1,')  # power loss mid-write: no trailing newline
        fresh = load_history()(self.files.folder)
        self.put(fresh, "n", DAY + H, {("r", "s"): (2, None)})
        self.assertEqual(self.files.series("n", "r", "s", 0), [[int(DAY), 1], [int(DAY + H), 2]])
        self.assertEqual(self.files.info()["records"], 2)

    def test_a_failed_write_leaves_no_phantom_keys(self):
        self.put(self.files, "n", DAY, {("r", "s"): (1, None)})
        real_open = Path.open

        def failing(self_, mode="r", *a, **k):
            if "a" in mode:
                raise OSError("disk full")
            return real_open(self_, mode, *a, **k)

        with mock.patch.object(Path, "open", failing), self.assertRaises(OSError):
            self.put(self.files, "n", DAY + H, {("r", "new"): (7, None)})
        self.put(self.files, "n", DAY + 2 * H, {("r", "new"): (7, None)})  # the key table is written now, not skipped
        self.assertEqual(self.files.series("n", "r", "new", 0), [[int(DAY + 2 * H), 7]])
        self.assertEqual(self.lines("n.2026-11-01.jsonl")[-2], {"k": ["new"]})

    def test_a_deleted_day_file_starts_with_an_empty_key_table(self):
        self.put(self.files, "n", DAY, {("r", "s"): (1, None)})
        (self.files.folder / "n.2026-11-01.jsonl").unlink()
        self.put(self.files, "n", DAY + H, {("r", "s"): (1, None)})
        self.assertEqual(self.lines("n.2026-11-01.jsonl")[0], {"k": ["r", "s"]})

    def test_info_and_delete_all(self):
        self.assertEqual(self.files.info(), {"records": 0, "first": None, "last": None, "bytes": 0})
        self.put(self.files, "n", DAY, {("r", "s"): (1, None)})
        self.put(self.files, "m", DAY + H, {("r", "s"): (1, None)})
        info = self.files.info()
        self.assertEqual((info["records"], info["first"], info["last"]), (2, DAY, DAY + H))
        self.assertGreater(info["bytes"], 0)
        self.files.delete_all()
        self.assertFalse(self.files.folder.exists())
        self.assertEqual(self.files.info()["records"], 0)

    def test_network_ids_with_colons_stay_distinct_files(self):
        self.put(self.files, "a:b", DAY, {("r", "s"): (1, None)})
        self.put(self.files, "a_b", DAY, {("r", "s"): (2, None)})
        self.assertEqual(self.files.series("a:b", "r", "s", 0), [[int(DAY), 1]])
        self.assertEqual(self.files.series("a_b", "r", "s", 0), [[int(DAY), 2]])

    def test_size_per_record_for_the_owners_network_is_small(self):
        """47 devices, 649 entries: the board M34 estimate is about 7 KB per record with an index table."""
        keys = [f"00:12:4b:00:00:00:00:{i:02x}" for i in range(47)]
        entries = {(keys[i % 47], keys[(i * 7 + 1 + i // 47) % 47]): (i % 255, None) for i in range(649)}
        entries = {k: v for k, v in entries.items() if k[0] != k[1]}
        self.put(self.files, "n", DAY, entries)
        self.assertLess(self.files.info()["bytes"], 12_000)


class SourcesTest(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch.dict(sys.modules)
        patcher.start()
        self.addCleanup(patcher.stop)
        ha_stubs.install()
        root = str(Path(__file__).resolve().parent.parent)
        sys.path.insert(0, root)
        self.addCleanup(sys.path.remove, root)
        self.src = ha_stubs.load(".sources")
        # zigpy_routes.read_routes is the internal zigpy reader; tests give it a fixed answer.
        self.relays = mock.Mock(return_value={"radio": "zigpy_znp", "devices": []})
        patch = mock.patch.object(self.src, "read_routes", self.relays)
        patch.start()
        self.addCleanup(patch.stop)
        self.zha = json.loads((FIXTURES / "zha-sample.json").read_text())["responses"]["zha/devices"]
        self.matter = json.loads((FIXTURES / "matter-sample.json").read_text())["responses"]["matter/network_topology"]

    def hass(self, registry):
        hass = ha_stubs.FakeHass(components={"zha", "matter"})
        hass.data["websocket_api"] = registry
        hass.zha_entries = [mock.Mock(entry_id="zha-entry")]
        return hass

    @staticmethod
    def handler(result=None, error=None, calls=None):
        """Like an async_response handler: returns at once, the answer arrives through the connection later."""
        def handle(hass, connection, msg):
            if calls is not None:
                calls.append(msg)
            loop = asyncio.get_running_loop()
            loop.call_soon(connection.send_error, msg["id"], "boom", "x") if error else \
                loop.call_soon(connection.send_result, msg["id"], result)
        return handle

    def test_parse_zha_reads_every_available_table_entry(self):
        entries = self.src.parse_zha(self.zha).neighbours
        listed = sum(len(d["neighbors"]) for d in self.zha if d.get("available") is not False and d.get("neighbors"))
        self.assertGreater(len(entries), 100)
        self.assertLessEqual(len(entries), listed)
        (receiver, _sender), (lqi, rssi) = next(iter(entries.items()))
        self.assertRegex(receiver, r"^([0-9a-f]{2}:){7}[0-9a-f]{2}$")
        self.assertIsInstance(lqi, int)
        self.assertIsNone(rssi)

    def test_zha_routes_resolve_addresses_to_devices(self):
        a, b = "aa:bb:cc:dd:00:00:00:02", "aa:bb:cc:dd:00:00:00:03"
        devices = [
            {"ieee": "aa:bb:cc:dd:00:00:00:01", "nwk": 0, "available": True, "routes": []},
            {"ieee": a, "nwk": 0x1111, "available": True, "routes": [
                {"dest_nwk": "0x2222", "next_hop": "0x1111", "route_status": "Active"},  # next hop = itself, resolved
                {"dest_nwk": "0x9999", "next_hop": "0x2222", "route_status": "Discovery_Underway"},  # unknown dest
                {"dest_nwk": "bad", "next_hop": "0x2222", "route_status": "Active"}]},
            {"ieee": b, "nwk": 0x2222, "available": True, "routes": None}]
        got = self.src.parse_zha(devices).routes
        self.assertEqual(got, ((a, "0x9999", b, "Discovery_Underway"), (a, b, a, "Active")))
        devices[2]["nwk"] = 0x1111  # two devices with one address: neither can be named
        self.assertEqual(self.src.parse_zha(devices).routes[0], (a, "0x2222", "0x1111", "Active"))

    def test_zha_parent_links_are_those_of_end_devices(self):
        r, c, other, router = (f"aa:bb:cc:dd:00:00:00:0{i}" for i in (1, 2, 3, 4))
        devices = [
            {"ieee": r, "available": True, "neighbors": [
                {"ieee": c, "lqi": "9", "relationship": "Child", "device_type": "EndDevice"},
                {"ieee": router, "lqi": "9", "relationship": "Child", "device_type": "Router"},  # a router's join parent
                {"ieee": other, "lqi": "9", "relationship": "Sibling", "device_type": "Router"}]},
            {"ieee": c, "available": True, "neighbors": [
                {"ieee": other, "lqi": "9", "relationship": "Parent", "device_type": "Router"}]},  # not used
            {"ieee": other, "available": False, "neighbors": [
                {"ieee": c, "lqi": "9", "relationship": "Child", "device_type": "EndDevice"}]}]  # stale table
        self.assertEqual(self.src.parse_zha(devices).parents, ((c, r),))
        fixture = self.src.parse_zha(self.zha).parents
        self.assertTrue(fixture)
        self.assertTrue(all(len(p) == 2 and p[0] != p[1] for p in fixture))

    def test_zha_routes_of_the_fixture(self):
        routes = self.src.parse_zha(self.zha).routes
        self.assertTrue(routes)
        self.assertTrue(all(len(r) == 4 and r[3] for r in routes))

    def test_collect_adds_the_route_records_or_reports_why_not(self):
        a, b = "aa:bb:cc:dd:00:00:00:02", "aa:bb:cc:dd:00:00:00:03"
        self.relays.return_value = {"radio": "x", "devices": [
            {"ieee": a, "nwk": 1, "relays": [{"nwk": 2, "ieee": b}, {"nwk": 0x77, "ieee": None}]},
            {"ieee": b, "nwk": 2, "relays": []}, {"ieee": "bad", "nwk": 3, "relays": []}]}
        hass = self.hass({"zha/devices": (self.handler(self.zha), None)})
        hass.config.components = {"zha"}
        got = asyncio.run(self.src.collect(hass))
        networks, problems = got.networks, got.problems
        self.assertEqual(networks["zha-entry"].relays, ((a, (b, "0x0077")), (b, ())))
        self.assertEqual(problems, [])
        self.relays.side_effect = self.src.NotSupported("internals_changed", "gone")
        got = asyncio.run(self.src.collect(hass))
        networks, problems = got.networks, got.problems
        self.assertEqual(networks["zha-entry"].relays, ())  # the rest of the record is still taken
        self.assertIn("route records", problems[0])
        self.relays.side_effect = RuntimeError
        self.assertIn("RuntimeError", asyncio.run(self.src.collect(hass))[1][0])

    def test_parse_zha_rules(self):
        me, a, b = "aa:bb:cc:dd:00:00:00:01", "aa:bb:cc:dd:00:00:00:02", "aa:bb:cc:dd:00:00:00:03"
        devices = [
            {"ieee": me, "available": True, "neighbors": [
                {"ieee": a, "lqi": "10"}, {"ieee": a, "lqi": "200"}, {"ieee": b, "lqi": "x"},
                {"ieee": me, "lqi": "5"}, {"ieee": "nonsense", "lqi": "5"}]},
            {"ieee": a, "available": False, "neighbors": [{"ieee": me, "lqi": "9"}]},  # stale table
            {"ieee": b, "neighbors": None}]
        self.assertEqual(self.src.parse_zha(devices).neighbours, {(me, a): (200, None)})
        with self.assertRaises(self.src.SourceError):
            self.src.parse_zha({"not": "a list"})

    def test_parse_thread_follows_the_panels_keys_and_directions(self):
        network, snapshot, collected = self.src.parse_thread(self.matter)
        self.assertEqual(collected, 1767268800.0)  # the snapshot's own time, milliseconds in the answer
        entries = snapshot.neighbours
        self.assertEqual(network, "thread-aabbccddeeff0001")
        # connection 14 -> 16: source_to_target {lqi 2, rssi -85} is "14 hears 16"
        self.assertEqual(entries[("aa:bb:cc:dd:00:00:00:01", "aa:bb:cc:dd:00:00:00:03")], (2, -85))
        self.assertEqual(entries[("aa:bb:cc:dd:00:00:00:03", "aa:bb:cc:dd:00:00:00:01")], (3, -75))

    def test_parse_thread_values_out_of_range_are_unknown(self):
        topo = {"nodes": [{"id": "1", "network_type": "thread", "ext_pan_id": "aa", "ext_address": "0011223344556677"},
                          {"id": "2", "network_type": "thread", "ext_pan_id": "aa", "available": False}],
                "connections": [{"network": "thread", "source": "1", "target": "2",
                                 "source_to_target": {"lqi": 9, "rssi": 127}, "target_to_source": {"lqi": 1}}]}
        _network, snapshot, collected = self.src.parse_thread(topo)
        self.assertIsNone(collected)
        entries = snapshot.neighbours
        # source_to_target has nothing valid; the unavailable node's table is stale -> no entry at all
        self.assertEqual(entries, {})
        self.assertIsNone(self.src.parse_thread({"nodes": [], "connections": []}))

    def test_parse_thread_mirrors_the_panels_filters(self):
        node = lambda i, pan="aa", addr=None, **kw: {"id": i, "network_type": "thread", "ext_pan_id": pan,  # noqa: E731
                                                     "ext_address": addr, **kw}
        conn = lambda a, b, ab=None, ba=None: {"network": "thread", "source": a, "target": b,  # noqa: E731
                                              "source_to_target": ab, "target_to_source": ba}
        topo = {"nodes": [node("1", addr="0011223344556677"), node("2"), node("3", pan=None), node("4", pan="bb"),
                          node("1", addr="9999999999999999"), node("5", kind="wifi_ap")],
                "connections": [conn("1", "2", {"lqi": 3}, {"lqi": 1, "strength": "unknown"}),
                                conn("2", "1", {"lqi": 2}, {"lqi": 2}),  # duplicate pair: first wins
                                conn("1", "3", {"lqi": 0}, {"lqi": 0, "rssi": -90}),
                                conn("1", "4", {"lqi": 3}, {"lqi": 3})]}  # other PAN: ignored
        network, snapshot, collected = self.src.parse_thread(topo)
        self.assertIsNone(collected)
        self.assertEqual(network, "thread-aa")
        k1 = "00:11:22:33:44:55:66:77"
        self.assertEqual(snapshot.neighbours, {
            (k1, "thread:2"): (3, None),  # 2 -> 1 "unknown" strength: no value
            ("thread:3", k1): (0, -90)})  # lqi 0 with a valid RSSI is measured; lqi 0 alone is not
        self.assertEqual(self.src.parse_thread({"nodes": [node("1", pan=None)]})[0], "thread-unknown")

    def test_a_read_that_has_not_answered_is_not_started_again(self):
        calls = []
        hass = self.hass({"matter/network_topology": (lambda h, c, m: calls.append(m), None)})  # never answers
        hass.config.components = {"matter"}
        with mock.patch.object(self.src, "CALL_TIMEOUT", 0.05):
            async def twice():  # one loop: closing the loop would cancel the pending read
                return await self.src.collect(hass), await self.src.collect(hass)

            first, second = asyncio.run(twice())
        self.assertIn("did not answer", first[1][0])
        self.assertIn("previous read", second[1][0])
        self.assertEqual(len(calls), 1)

    def test_collect_calls_exactly_the_two_commands_with_refresh_false(self):
        calls = []
        hass = self.hass({"zha/devices": (self.handler(self.zha, calls=calls), None),
                          "matter/network_topology": (self.handler(self.matter, calls=calls), None),
                          "zha/topology/update": (self.handler({}, calls=calls), None)})
        got = asyncio.run(self.src.collect(hass))
        networks, problems = got.networks, got.problems
        self.assertEqual(sorted(networks), ["thread-aabbccddeeff0001", "zha-entry"])
        self.assertEqual(problems, [])
        self.assertEqual([(c["type"], c.get("refresh")) for c in calls],
                         [("zha/devices", None), ("matter/network_topology", False)])

    def test_call_command_refuses_anything_not_allowed(self):
        hass = self.hass({"zha/topology/update": (self.handler({}), None)})
        with self.assertRaises(self.src.SourceError):
            asyncio.run(self.src.call_command(hass, "zha/topology/update"))

    def test_not_supported_paths_are_problems_not_exceptions(self):
        cases = {
            "missing": {},
            "wrong layout": {"zha/devices": self.handler([]), "matter/network_topology": (1, 2, 3)},
            "not callable": {"zha/devices": ("x", None), "matter/network_topology": ("y", None)},
            "error answer": {"zha/devices": (self.handler(error=True), None),
                             "matter/network_topology": (self.handler(error=True), None)},
            "raises": {"zha/devices": (mock.Mock(side_effect=RuntimeError), None),
                       "matter/network_topology": (mock.Mock(side_effect=KeyError), None)}}
        for name, registry in cases.items():
            got = asyncio.run(self.src.collect(self.hass(registry)))
            self.assertEqual(got.networks, {}, name)
            self.assertEqual(len(got.problems), 2, name)
        hass = self.hass(None)  # no registry at all
        self.assertEqual(asyncio.run(self.src.collect(hass))[0], {})

    def test_timeout_is_a_problem(self):
        hass = self.hass({"zha/devices": (lambda *a: None, None)})  # never answers
        hass.config.components = {"zha"}
        with mock.patch.object(self.src, "CALL_TIMEOUT", 0.05):
            got = asyncio.run(self.src.collect(hass))
        networks, problems = got.networks, got.problems
        self.assertEqual(networks, {})
        self.assertIn("did not answer", problems[0])

    def test_sources_that_are_not_loaded_are_skipped_silently(self):
        hass = self.hass({})
        hass.config.components = set()
        got = asyncio.run(self.src.collect(hass))
        self.assertEqual((got.networks, got.problems), ({}, []))


class RecorderTest(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch.dict(sys.modules)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.rec = ha_stubs.install()
        root = str(Path(__file__).resolve().parent.parent)
        sys.path.insert(0, root)
        self.addCleanup(sys.path.remove, root)
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.hass = ha_stubs.FakeHass(components={"zha"}, config_dir=self.tmp.name)
        self.hass.zha_entries = [mock.Mock(entry_id="zha-entry")]
        self.comp = ha_stubs.load()
        self.recorder = ha_stubs.load(".recorder")
        patch = mock.patch.object(ha_stubs.load(".sources"), "read_routes",
                                  return_value={"radio": "x", "devices": []})
        patch.start()
        self.addCleanup(patch.stop)
        ha_stubs.run(self.comp.async_setup_entry(self.hass, ha_stubs.FakeEntry()))
        self.zha = json.loads((FIXTURES / "zha-sample.json").read_text())["responses"]["zha/devices"]
        self.n = 0

    def registry(self, answer):
        def handle(hass, connection, msg):
            asyncio.get_running_loop().call_soon(connection.send_result, msg["id"], answer)
        self.hass.data["websocket_api"] = {"zha/devices": (handle, None)}

    def record(self, now, keep=30):
        history = self.recorder.get_history(self.hass)
        history.clock = lambda: now  # the gap between records counts on this clock
        ha_stubs.run(history.record(keep, now))

    def command(self, name, admin=True, **fields):
        self.n += 1
        handler, schema = self.rec.commands[f"meshroute_topology_explorer/history/{name}"]
        conn = ha_stubs.FakeConnection(admin=admin)
        ha_stubs.run(handler(self.hass, conn, schema({"id": self.n, **fields})))
        return conn.results, conn.errors

    def test_record_dedupes_prunes_and_reports_in_info(self):
        self.registry(self.zha)
        self.record(DAY)
        self.record(DAY + 3 * H)
        info = self.command("info")[0][0][1]
        self.assertEqual((info["records"], info["first"], info["last"], info["last_error"]), (2, DAY, DAY + 3 * H, None))
        files = list((Path(self.tmp.name) / ".storage" / "meshroute_topology_explorer_history").iterdir())
        self.assertEqual(len(files), 1)
        self.assertEqual(len(files[0].read_text().splitlines()), 3)  # key table, full record, time-only record
        self.record(DAY + 40 * 24 * H, keep=30)  # old day file expires with the next record
        self.assertEqual(self.command("info")[0][0][1]["records"], 1)

    def test_failed_read_writes_nothing_and_is_reported(self):
        self.hass.data["websocket_api"] = {}
        self.record(DAY)
        info = self.command("info")[0][0][1]
        self.assertEqual(info["records"], 0)
        self.assertIn("zha", info["last_error"])

    def test_empty_tables_are_not_recorded(self):
        self.registry([{"ieee": "aa:bb:cc:dd:00:00:00:01", "available": True, "neighbors": []}])
        self.record(DAY)
        self.assertEqual(self.command("info")[0][0][1]["records"], 0)

    def test_series_command_both_directions_and_validation(self):
        a, b = "aa:bb:cc:dd:00:00:00:01", "aa:bb:cc:dd:00:00:00:02"
        self.registry([{"ieee": a, "available": True, "neighbors": [{"ieee": b, "lqi": "131"}]},
                       {"ieee": b, "available": True, "neighbors": [{"ieee": a, "lqi": "64"}]}])
        self.record(DAY)
        results, errors = self.command("series", network="zha-entry", sender=a.upper(), receiver=b, since=0)
        self.assertEqual(errors, [])
        # b's table says it hears a with 64; a's table says it hears b with 131
        self.assertEqual(results[0][1], {"sender_to_receiver": [[int(DAY), 64]],
                                         "receiver_to_sender": [[int(DAY), 131]]})
        for bad in ({"network": "", "sender": a, "receiver": b, "since": 0},
                    {"network": "n", "sender": a, "receiver": b, "since": -1},
                    {"network": "n", "sender": a, "receiver": b, "since": "0"},
                    {"network": "n", "sender": 5, "receiver": b, "since": 0}):
            self.assertEqual(self.command("series", **bad)[1][0][1], "invalid_format", bad)

    def test_records_command(self):
        a, b = "aa:bb:cc:dd:00:00:00:01", "aa:bb:cc:dd:00:00:00:02"
        self.registry([{"ieee": a, "nwk": 0, "available": True, "neighbors": [{"ieee": b, "lqi": "7"}],
                        "routes": [{"dest_nwk": "0x0005", "next_hop": "0x0007", "route_status": "Active"}]}])
        self.record(DAY)
        results, _ = self.command("records", network="zha-entry", since=0, until=DAY + 1)
        self.assertEqual(results[0][1], {"k": [a, b, "0x0005", "0x0007"], "records": [
            {"t": int(DAY), "e": [[0, 1, 7]], "r": [[0, 2, 3, "Active"]]}]})
        self.assertEqual(self.command("records", network="zha-entry", since=0)[1], [])  # until defaults to now
        self.assertEqual(self.command("records", network="zha-entry", since="0")[1][0][1], "invalid_format")
        self.assertEqual(self.command("records", admin=False, network="n", since=0)[1][0][1], "unauthorized")

    def test_a_delete_during_a_read_wins(self):
        """A record collected before 'delete the history' is not written after it."""
        history = self.recorder.get_history(self.hass)
        gate = asyncio.Event()

        def slow(hass, connection, msg):
            async def later():
                await gate.wait()
                connection.send_result(msg["id"], self.zha)
            asyncio.get_running_loop().create_task(later())

        self.hass.data["websocket_api"] = {"zha/devices": (slow, None)}

        async def scenario():
            task = asyncio.create_task(history.record(30, DAY))
            await asyncio.sleep(0.01)
            await history.delete_all()
            gate.set()
            await task

        ha_stubs.run(scenario())
        self.assertEqual(history.files.info()["records"], 0)

    def test_expiry_runs_even_when_the_source_fails_and_an_error_is_logged_once(self):
        self.registry(self.zha)
        self.record(DAY)
        history = self.recorder.get_history(self.hass)
        with mock.patch.object(self.recorder, "collect", side_effect=RuntimeError("boom")), \
                self.assertRaises(RuntimeError):
            self.record(DAY + 40 * 24 * H, keep=30)
        self.assertEqual(history.files.info()["records"], 0)  # the old file expired anyway

    def test_read_commands_are_admin_only(self):
        self.assertEqual(self.command("info", admin=False)[1][0][1], "unauthorized")
        self.assertEqual(self.command("series", admin=False, network="n", sender="a", receiver="b", since=0)[1][0][1],
                         "unauthorized")


if __name__ == "__main__":
    unittest.main()
