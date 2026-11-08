# SPDX-License-Identifier: MIT
"""meshroute_topology_explorer/thread_tables (#11): the Matter client's Thread tables, read only, with fakes for
Home Assistant's Matter helper and the client's nodes (the real client model: tests_ha/test_matter_contract.py).

Cases: Matter missing, without a loaded entry, with changed internals; attributes not reported stay null (never an
empty table); extended addresses as 16 hex digits; nodes without Thread are left out; "unchanged since" keeps the
first time for the same tables, restarts with new ones, survives a restart through the store, forgets removed nodes;
read only. python3 -m unittest discover -s tests
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
        self.assertIsNone(node["unchanged_since"])

    def test_11_rloc16_where_reported_and_nodes_without_thread_left_out(self):
        self.nodes = [router(rloc16=0x7000), Node(20, None)]
        self.nodes[0].endpoints[0].reported.add("0/53/64")
        nodes = self.answer()["nodes"]
        self.assertEqual([n["node_id"] for n in nodes], [14])
        self.assertEqual(nodes[0]["rloc16"], 0x7000)

    def test_11_unchanged_since_keeps_the_first_time_and_restarts_on_new_tables(self):
        first = self.answer()
        self.assertEqual((first["nodes"][0]["unchanged_since"], first["read_at"]), (1000.0, 1000.0))
        self.now = 5000.0
        self.assertEqual(self.answer()["nodes"][0]["unchanged_since"], 1000.0)
        self.nodes = [router(lqi_in=2)]  # the server read the tables again: other values
        self.assertEqual(self.answer()["nodes"][0]["unchanged_since"], 5000.0)

    def test_11_times_survive_a_restart_and_removed_nodes_are_forgotten(self):
        self.answer()
        store = self.tables.get_times(self.hass)._store
        data_func, _ = store.delay_calls[-1]
        saved = data_func()
        self.assertEqual(saved["nodes"]["14"]["first_seen"], 1000.0)
        # A new run: the store file holds what was saved.
        self.hass.data.clear()
        ha_stubs.FakeStore.stored = saved
        times = self.tables.get_times(self.hass)
        times.clock = lambda: 9000.0
        self.assertEqual(self.answer()["nodes"][0]["unchanged_since"], 1000.0)
        self.nodes = [router(node_id=16)]
        self.answer()
        data_func, _ = times._store.delay_calls[-1]
        self.assertEqual(sorted(data_func()["nodes"]), ["16"])
        self.nodes = []  # the client starting: no reason to forget node 16
        self.answer()
        data_func, _ = times._store.delay_calls[-1]
        self.assertEqual(sorted(data_func()["nodes"]), ["16"])

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
