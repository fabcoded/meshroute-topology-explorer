# SPDX-License-Identifier: MIT
"""Contract with the real Matter client (#11; pinned in requirements-ha-latest.txt and requirements-ha-min.txt to what
the pinned Home Assistant's Matter manifest requires): what thread_tables.py assumes of Home Assistant's get_matter
and of matter_server's MatterClient and MatterNode still holds. The nodes are built the way the client builds them
from the server's node list (MatterNode(dataclass_from_dict(MatterNodeData, ...)), client.py) and updated the way it
applies an attribute_updated event (MatterNode.update_attribute); no Matter server runs and nothing is sent."""

from types import SimpleNamespace

from homeassistant.config_entries import ConfigEntryState
from matter_server.client.client import MatterClient
from matter_server.client.models.node import MatterNode
from matter_server.common.helpers.util import dataclass_from_dict
from matter_server.common.models import MatterNodeData

from custom_components.meshroute_topology_explorer import thread_tables
from custom_components.meshroute_topology_explorer.const import DOMAIN

from .compat import MockConfigEntry

EXT = 0xAABBCCDD00000001  # above 2**53: must reach the panel as text


def route(ext, rloc16, router_id, next_hop, cost, lqi_in, lqi_out, linked):
    """A RouteTableStruct as the server sends it: TLV tags as keys (0 ExtAddress ... 9 LinkEstablished)."""
    return {"0": ext, "1": rloc16, "2": router_id, "3": next_hop, "4": cost, "5": lqi_in, "6": lqi_out, "7": 17,
            "8": True, "9": linked}


def neighbour(ext, rloc16, lqi, average, last, child):
    """A NeighborTableStruct as the server sends it (0 ExtAddress ... 13 IsChild); average RSSI may be null."""
    return {"0": ext, "1": 30, "2": rloc16, "3": 100, "4": 7, "5": lqi, "6": average, "7": last, "8": 0, "9": 0,
            "10": True, "11": True, "12": True, "13": child}


def node(node_id, attributes):
    return MatterNode(dataclass_from_dict(MatterNodeData, {
        "node_id": node_id, "date_commissioned": "2026-11-01T10:00:00", "last_interview": "2026-11-01T10:00:00",
        "interview_version": 6, "available": True, "attributes": attributes}))


async def test_11_thread_tables_from_the_real_client_model(hass, hass_ws_client, entry):
    leader = node(14, {"0/53/1": 6, "0/53/63": EXT, "0/53/7": [neighbour(EXT + 4, 0xF000, 2, -86, -88, False)],
                       "0/53/8": [route(EXT, 0x7000, 28, 63, 0, 0, 0, False),
                                  route(EXT + 4, 0xF000, 60, 10, 1, 2, 2, True)]})
    sensor = node(16, {"0/53/1": 2, "0/53/8": [route(EXT, 0x7000, 28, 0, 0, 3, 2, True)]})
    wifi = node(20, {"0/49/65532": 1})  # a Wi-Fi node: no ThreadNetworkDiagnostics, left out
    client = MatterClient("ws://matter-server.invalid/ws", None)  # never connected
    client._nodes = {n.node_id: n for n in (leader, sensor, wifi)}  # what start_listening fills from the node list
    matter = MockConfigEntry(domain="matter", state=ConfigEntryState.LOADED)
    matter.add_to_hass(hass)
    matter.runtime_data = SimpleNamespace(adapter=SimpleNamespace(matter_client=client))  # helpers.get_matter reads this
    hass.config.components.add("matter")
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()

    ws = await hass_ws_client(hass)
    await ws.send_json_auto_id({"type": f"{DOMAIN}/thread_tables"})
    answer = await ws.receive_json()
    assert answer["success"], answer
    by_id = {n["node_id"]: n for n in answer["result"]["nodes"]}
    assert sorted(by_id) == [14, 16]
    first = by_id[14]
    assert (first["routing_role"], first["ext_address"], first["rloc16"]) == (6, "aabbccdd00000001", None)
    own, link = first["route_table"]
    assert (own["extAddress"], own["nextHop"], own["pathCost"], own["linkEstablished"]) == ("aabbccdd00000001", 63, 0, False)
    assert (link["routerId"], link["nextHop"], link["pathCost"], link["LQIIn"], link["LQIOut"]) == (60, 10, 1, 2, 2)
    heard = first["neighbor_table"][0]
    assert (heard["extAddress"], heard["lqi"], heard["averageRssi"], heard["lastRssi"], heard["isChild"]) == \
        ("aabbccdd00000005", 2, -86, -88, False)
    assert by_id[16]["neighbor_table"] is None  # not reported: null, not the cluster's default []
    since = first["unchanged_since"]
    assert isinstance(since, float)

    # An attribute_updated event as the client applies it: the parsed cluster changes, node_data.attributes does not.
    leader.update_attribute("0/53/7", [neighbour(EXT + 4, 0xF000, 3, None, -70, False)])
    assert leader.node_data.attributes["0/53/7"][0]["5"] == 2
    await ws.send_json_auto_id({"type": f"{DOMAIN}/thread_tables"})
    updated = {n["node_id"]: n for n in (await ws.receive_json())["result"]["nodes"]}[14]
    assert (updated["neighbor_table"][0]["lqi"], updated["neighbor_table"][0]["averageRssi"]) == (3, None)
    assert updated["unchanged_since"] >= since
    assert thread_tables.fingerprint(updated) != thread_tables.fingerprint(first)
    matter.mock_state(hass, ConfigEntryState.NOT_LOADED)  # nothing to unload at teardown
