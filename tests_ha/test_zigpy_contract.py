# SPDX-License-Identifier: MIT
"""Contract with the real zigpy (pinned in requirements-ha-latest.txt to what the pinned ZHA requires): what
zha_scan.py assumes of `zigpy.topology.Topology` (listeners, event names, `_scan_task`) still holds. A scan runs for
real against a minimal application; only the radio requests are replaced. Quality plan S5."""

from unittest.mock import MagicMock

import zigpy.config
from zigpy.device import Device
from zigpy.topology import Topology

from custom_components.meshroute_topology_explorer import zha_scan


async def test_zha_scan_helpers_follow_a_real_zigpy_scan():
    router = MagicMock(spec=Device, ieee="00:11:22:33:44:55:66:77")
    router.node_desc = MagicMock(is_router=True)
    app = MagicMock(devices={router.ieee: router}, config={zigpy.config.CONF_TOPO_SKIP_COORDINATOR: False})
    topology = Topology(app)

    async def no_table(device):
        return []  # the radio request; everything around it is zigpy's own code
    topology._scan_neighbors = topology._scan_routes = no_table
    assert zha_scan.scan_state(topology) == ("idle", None)  # attribute exists, no scan yet

    seen = []
    detach = zha_scan.attach(topology, lambda: seen.append(zha_scan.scan_state(topology)[0]))
    await topology.scan()
    assert seen == ["running", "running"]  # neighbors_updated and routes_updated, both fired inside the scan task
    assert zha_scan.scan_state(topology)[0] == "idle"  # a finished task is idle
    detach()
    await topology.scan()
    assert len(seen) == 2 and not topology._listeners  # detached: no further events
