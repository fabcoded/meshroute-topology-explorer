// SPDX-License-Identifier: MIT
// How a Zigbee device hangs in the network, for its row in the Devices list (board M3). Pure. npm test
import { upPath } from "./paths.js";

/** How a device hangs in the network, for its row (board M3): the
 *  coordinator is the network; an end device is "via" its parent, or "direct" when the parent is the coordinator; a
 *  router is "direct" when its up path is the one hop to the coordinator. Otherwise null: a router's next hop is a
 *  route, not a bond, and an end device without a known parent says nothing here (Details explains). */
export function connectionOf(network, d, coordinatorId) {
  if (d.role === "coordinator") return { kind: "network" };
  if (d.role === "end device") {
    if (!d.parent) return null;
    if (d.parent === coordinatorId) return { kind: "direct" };
    const parent = network.devices.find((x) => x.id === d.parent);
    return parent ? { kind: "via", label: parent.label } : null;
  }
  if (d.role === "router" && coordinatorId) {
    const up = upPath(network, d.id);
    if (up.complete && up.ids.length === 2) return { kind: "direct" };
  }
  return null;
}

/** The engine's hook: the connection of `d`, the coordinator looked up in `network`. */
export function connection(network, d) {
  const coordinator = network.devices.find((x) => x.role === "coordinator");
  return connectionOf(network, d, coordinator ? coordinator.id : null);
}
