# SPDX-License-Identifier: MIT
"""meshroute_topology_explorer/thread_tables (#11): the Matter client's Thread tables, read only, with fakes for
Home Assistant's Matter helper and the client's nodes (the real client model: tests_ha/test_matter_contract.py).

Cases: Matter missing, without a loaded entry, with changed internals; attributes not reported stay null (never an
empty table); extended addresses as 16 hex digits; nodes without Thread are left out; the read interval per table
(F5 tier C/D: unknown lower bound at first sight, last sight to now on a change, restarts, a changed fingerprint form,
a clock jump, writes only on change) and the 10-minute observer; read only. python3 -m unittest discover -s tests
"""

import dataclasses
import pathlib
import sys
import types
import unittest
from unittest import mock

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import ha_stubs

COMMAND = "meshroute_topology_explorer/thread_tables"


@dataclasses.dataclass
class Route:
    """Shaped like chip.clusters ThreadNetworkDiagnostics.Structs.RouteTableStruct (field names and order)."""

    extAddress: int = 0
    rloc16: int = 0
    routerId: int = 0
    nextHop: int = 0
    pathCost: int = 0
    LQIIn: int = 0
    LQIOut: int = 0
    age: int = 0
    allocated: bool = False
    linkEstablished: bool = False


@dataclasses.dataclass
class Neighbour:
    extAddress: int = 0
    age: int = 0
    rloc16: int = 0
    lqi: int = 0
    averageRssi: int | None = None
    lastRssi: int | None = None
    isChild: bool = False


class Cluster:
    """The client's cluster object: every attribute has a default, reported or not (routeTable defaults to [])."""

    def __init__(self, **values):
        self.routingRole, self.neighborTable, self.routeTable, self.extAddress, self.rloc16 = None, [], [], None, None
        self.__dict__.update(values)


class Endpoint:
    def __init__(self, reported):
        self.reported = set(reported)

    def has_attribute(self, cluster, attribute):
        return f"0/{cluster}/{attribute}" in self.reported


class Node:
    def __init__(self, node_id, cluster=None, reported=(), available=True):
        self.node_id, self.available, self._cluster = node_id, available, cluster
        self.endpoints = {0: Endpoint(reported)}

    def get_cluster(self, endpoint, cluster):
        return self._cluster if (endpoint, cluster) == (0, 53) else None

    def refresh_attribute(self, *args):  # a radio read the command must never make
        raise AssertionError("radio traffic")


ALL = ("0/53/1", "0/53/7", "0/53/8", "0/53/63", "0/53/64")
EXT = 0xAABBCCDD00000001  # beyond 2**53: as a JSON number JavaScript would round it


def router(node_id=14, lqi_in=3, **extra):
    routes = [Route(EXT, 0x7000, 28, 63, 0, 0, 0, 5, True, False),
              Route(EXT + 4, 0xF000, 60, 10, 1, lqi_in, 2, 200, True, True)]
    return Node(node_id, Cluster(routingRole=6, neighborTable=[Neighbour(EXT + 4, 9, 0xF000, lqi_in, -86, -84)],
                                 routeTable=routes, extAddress=EXT, **extra), reported=ALL[:4])


class ThreadTablesTest(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch.dict(sys.modules)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.rec = ha_stubs.install()
        root = str(pathlib.Path(__file__).resolve().parent.parent)
        sys.path.insert(0, root)
        self.addCleanup(sys.path.remove, root)
        self.comp = ha_stubs.load()
        self.tables = ha_stubs.load(".thread_tables")
        self.hass = ha_stubs.FakeHass(components={"matter"})
        ha_stubs.run(self.comp.async_setup_entry(self.hass, ha_stubs.FakeEntry()))
        self.nodes = [router()]
        self.client = types.SimpleNamespace(get_nodes=lambda: list(self.nodes))
        self.adapter = types.SimpleNamespace(matter_client=self.client)
        self.helper = types.ModuleType("homeassistant.components.matter.helpers")
        self.helper.get_matter = lambda hass: self.adapter
        sys.modules["homeassistant.components.matter"] = types.ModuleType("homeassistant.components.matter")
        sys.modules["homeassistant.components.matter.helpers"] = self.helper
        self.now = 1000.0
        self.tables.get_times(self.hass).clock = lambda: self.now
        self.addCleanup(lambda: [task.close() for task in self.hass.tasks])  # observations scheduled, not run

    def call(self, admin=True):
        handler, schema = self.rec.commands[COMMAND]
        conn = ha_stubs.FakeConnection(admin=admin)
        ha_stubs.run(handler(self.hass, conn, schema({"id": 1, "type": COMMAND})))
        return conn.results, conn.errors

    def answer(self):
        results, errors = self.call()
        self.assertEqual(errors, [])
        return results[0][1]

    def test_11_reads_the_parsed_cluster_with_hex_addresses(self):
        node = self.answer()["nodes"][0]
        self.assertEqual((node["node_id"], node["available"], node["routing_role"]), (14, True, 6))
        self.assertEqual(node["ext_address"], "aabbccdd00000001")
        own, link = node["route_table"]
        self.assertEqual(own["extAddress"], "aabbccdd00000001")
        self.assertEqual((own["nextHop"], own["pathCost"], own["linkEstablished"]), (63, 0, False))
        self.assertEqual((link["routerId"], link["LQIIn"], link["LQIOut"], link["linkEstablished"]), (60, 3, 2, True))
        self.assertEqual(node["neighbor_table"][0], {"extAddress": "aabbccdd00000005", "age": 9, "rloc16": 0xF000,
                                                     "lqi": 3, "averageRssi": -86, "lastRssi": -84, "isChild": False})

    def test_11_unreported_attributes_are_null_never_an_empty_table(self):
        self.nodes = [Node(15, Cluster(rloc16=0x2800), reported=("0/53/1",))]
        node = self.answer()["nodes"][0]
        self.assertIsNone(node["route_table"])
        self.assertIsNone(node["neighbor_table"])
        self.assertIsNone(node["rloc16"])  # set on the object, but not reported: the default is no value
        self.assertEqual(node["times"], {"neighbor_table": None, "route_table": None})

    def test_11_rloc16_where_reported_and_nodes_without_thread_left_out(self):
        self.nodes = [router(rloc16=0x7000), Node(20, None)]
        self.nodes[0].endpoints[0].reported.add("0/53/64")
        nodes = self.answer()["nodes"]
        self.assertEqual([n["node_id"] for n in nodes], [14])
        self.assertEqual(nodes[0]["rloc16"], 0x7000)

    def times(self, table="neighbor_table"):
        return self.answer()["nodes"][0]["times"][table]

    def test_11_read_interval_per_table_lo_unknown_first_then_last_seen_to_now(self):
        """F5 tier C/D: the first sight has no lower bound; a change lies between the last sight and now."""
        self.assertEqual(self.times(), {"lo": None, "hi": 1000.0})
        self.now = 4000.0
        self.assertEqual(self.times(), {"lo": None, "hi": 1000.0})  # unchanged: the interval stays
        self.now = 4600.0
        self.nodes = [router(lqi_in=2)]  # both tables read again by the server
        self.assertEqual(self.times(), {"lo": 4000.0, "hi": 4600.0})
        self.assertEqual(self.times("route_table"), {"lo": 4000.0, "hi": 4600.0})
        self.now = 5200.0
        node = router(lqi_in=2)
        node._cluster.routeTable[1].pathCost = 3  # only the route table changed
        self.nodes = [node]
        answer = self.answer()["nodes"][0]["times"]
        self.assertEqual(answer["neighbor_table"], {"lo": 4000.0, "hi": 4600.0})
        self.assertEqual(answer["route_table"], {"lo": 4600.0, "hi": 5200.0})

    def test_11_writes_on_change_and_last_seen_only_at_the_final_write(self):
        store = self.tables.get_times(self.hass)._store
        self.answer()
        self.assertEqual(len(store.saved), 1)  # new tables: written at once
        self.now = 1600.0
        self.answer()
        self.assertEqual(len(store.saved), 1)  # unchanged: no write, only the long delayed one
        data_func, delay = store.delay_calls[-1]
        self.assertEqual(delay, self.tables.SEEN_SAVE_DELAY)
        self.assertEqual(data_func()["nodes"]["14"]["neighbor_table"]["seen"], 1600.0)
        self.tables.get_times(self.hass).async_flush()  # the entry unloads: written soon
        self.assertEqual(store.delay_calls[-1][1], 0)

    def test_11_a_restart_keeps_the_bounds_and_spans_the_downtime(self):
        self.answer()
        self.now = 1600.0
        self.answer()
        final = self.tables.get_times(self.hass)._store.delay_calls[-1][0]()  # Home Assistant's final write
        self.hass.data.clear()
        ha_stubs.FakeStore.stored = final
        times = self.tables.get_times(self.hass)
        times.clock = lambda: 9600.0
        self.nodes = [router(lqi_in=2)]
        # Changed when first seen after the restart: read some time after the last sight before it, or later.
        self.assertEqual(self.times(), {"lo": 1600.0, "hi": 9600.0})
        self.hass.data.clear()
        ha_stubs.FakeStore.stored = final
        self.tables.get_times(self.hass).clock = lambda: 9000.0
        self.nodes = [router()]
        self.assertEqual(self.times(), {"lo": None, "hi": 1000.0})  # unchanged across the restart

    def test_11_lost_store_new_node_form_change_and_clock_jump(self):
        self.answer()
        # A new node: no lower bound.
        self.nodes = [router(), router(node_id=16)]
        self.now = 2000.0
        nodes = {n["node_id"]: n for n in self.answer()["nodes"]}
        self.assertEqual(nodes[16]["times"]["neighbor_table"], {"lo": None, "hi": 2000.0})
        self.assertEqual(nodes[14]["times"]["neighbor_table"], {"lo": None, "hi": 1000.0})
        # The fingerprint form changed since the file was written: from the old lower bound to now, never "now".
        self.hass.data.clear()
        ha_stubs.FakeStore.stored = {"nodes": {"14": {"neighbor_table": {"fp": "x", "v": 0, "lo": 500.0, "hi": 900.0,
                                                                         "seen": 950.0}}}}
        self.tables.get_times(self.hass).clock = lambda: 3000.0
        self.nodes = [router()]
        self.assertEqual(self.times(), {"lo": 500.0, "hi": 3000.0})
        # The clock went back below the last sight: the bound is worthless.
        self.hass.data.clear()
        ha_stubs.FakeStore.stored = {"nodes": {"14": {"neighbor_table": {"fp": "x", "v": self.tables.FP_VERSION,
                                                                         "lo": 100.0, "hi": 200.0, "seen": 8000.0}}}}
        self.tables.get_times(self.hass).clock = lambda: 3000.0
        self.assertEqual(self.times(), {"lo": None, "hi": 3000.0})
        # A broken file: start over, nothing known.
        self.hass.data.clear()
        ha_stubs.FakeStore.stored = {"nodes": ["not", "a", "dict"]}
        self.assertEqual(self.times()["lo"], None)

    def test_11_removed_nodes_are_forgotten_but_not_while_the_client_starts(self):
        self.answer()
        self.nodes = [router(node_id=16)]
        self.answer()
        self.assertEqual(sorted(self.tables.get_times(self.hass)._nodes), ["16"])
        self.nodes = []
        self.answer()
        self.assertEqual(sorted(self.tables.get_times(self.hass)._nodes), ["16"])

    def test_11_the_observer_runs_every_10_minutes_and_once_when_matter_is_loaded(self):
        observer = [i for i in self.rec.intervals if i[0] == self.tables.OBSERVE_PERIOD]
        self.assertEqual(len(observer), 1)
        self.assertEqual(self.tables.OBSERVE_PERIOD.total_seconds(), 600)
        # Matter was loaded at setup: the baseline observation is scheduled.
        self.assertEqual(len(self.hass.tasks), 1)
        ha_stubs.run(self.hass.tasks.pop())
        self.assertEqual(self.tables.get_times(self.hass).last_check, 1000.0)
        entry_changed = self.rec.signals[-1]
        entry_changed("updated", types.SimpleNamespace(domain="zha", state="loaded"))
        self.assertEqual(self.hass.tasks, [])
        entry_changed("updated", types.SimpleNamespace(domain="matter", state="loaded"))
        self.assertEqual(len(self.hass.tasks), 1)
        ha_stubs.run(self.hass.tasks.pop())
        self.now = 1600.0
        ha_stubs.run(observer[0][1](None))  # the 10-minute tick
        self.assertEqual(self.tables.get_times(self.hass).last_check, 1600.0)

    def test_11_reasons(self):
        self.hass.config.components.discard("matter")
        self.assertEqual(self.call()[1][0][1:], ("not_supported", "matter_not_loaded: Matter is not loaded"))
        self.hass.config.components.add("matter")

        def no_entry(hass):
            raise IndexError("list index out of range")
        self.helper.get_matter = no_entry
        self.assertTrue(self.call()[1][0][2].startswith("no_client:"))
        self.helper.get_matter = lambda hass: types.SimpleNamespace()
        self.assertTrue(self.call()[1][0][2].startswith("internals_changed:"))
        self.helper.get_matter = lambda hass: self.adapter
        self.nodes = [Node(14, Cluster(routeTable=["not a struct"]), reported=("0/53/8",))]
        self.assertTrue(self.call()[1][0][2].startswith("internals_changed:"))
        _, errors = self.call(admin=False)
        self.assertEqual(errors[0][1], "unauthorized")

    def test_11_observe_never_raises(self):
        self.hass.config.components.discard("matter")
        ha_stubs.run(self.tables.async_observe(self.hass))
        self.hass.config.components.add("matter")
        self.helper.get_matter = lambda hass: 1 / 0
        ha_stubs.run(self.tables.async_observe(self.hass))


if __name__ == "__main__":
    unittest.main()
