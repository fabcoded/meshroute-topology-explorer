// SPDX-License-Identifier: MIT
// A synthetic answer of meshroute_topology_explorer/zigpy_routes for the sample (brief a4w), shaped like
// custom_components/meshroute_topology_explorer/zigpy_routes.py read_routes: { radio, devices: [{ ieee, nwk, relays:
// [{ nwk, ieee }] }] }. A route record is the way a frame took up to the coordinator, so every available device with a
// complete up path gets its up path's relays (from the device towards the coordinator, as zigpy lists them). Two of
// the devices the coordinator reaches by source route get a broken record, so the gate is visible: the first (by IEEE
// address) with a relay has that relay unnamed (zigpy did not know the address), the next one an outdated address of
// its own (a rejoin). Used by tests/model-source-routes.test.mjs and the dev page (sourceroute=zigpy).
import { buildNetwork, upPath } from "../custom_components/meshroute_topology_explorer/frontend/model/index.js";
import { assumedDownPaths } from "../custom_components/meshroute_topology_explorer/frontend/model/source-routes.js";

export function fakeZigpyRoutes(rawDevices) {
  const network = buildNetwork(rawDevices);
  const byId = new Map(network.devices.map((d) => [d.id, d]));
  const devices = [];
  for (const d of network.devices) {
    if (d.role === "coordinator" || !d.available || d.nwk === null) continue;
    const up = upPath(network, d.id);
    if (!up.complete) continue;
    devices.push({ ieee: d.id, nwk: d.nwk, relays: up.ids.slice(1, -1).map((id) => ({ nwk: byId.get(id).nwk, ieee: id })) });
  }
  const sourceRouted = [...assumedDownPaths(network).keys()].sort();
  const record = (id) => devices.find((x) => x.ieee === id);
  const unnamed = sourceRouted.find((id) => record(id).relays.length > 0);
  if (unnamed) record(unnamed).relays[0].ieee = null;
  const moved = sourceRouted.find((id) => id !== unnamed);
  if (moved) record(moved).nwk = (record(moved).nwk + 1) & 0xffff;
  return { radio: "zigpy_znp", devices, broken: { unnamed: unnamed || null, moved: moved || null } };
}
