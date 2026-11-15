// SPDX-License-Identifier: MIT
// What the path history needs of Thread (spec 5.8, 9.5, board M36): the window's text for a lane value (RSSI over link
// quality, both written out), which devices have no history, and the History button's partner (#24). Pure. npm test
const MINUS = "−";

/** Pill text of a lane value [lqi, rssi] as the records hold it: "−75 dBm" over "LQI 3"; no RSSI leaves the first line out. */
export function entryText(entry) {
  if (!entry) return "?";
  const [lqi, rssi] = entry;
  const lines = [];
  if (typeof rssi === "number") lines.push(`${rssi < 0 ? MINUS : ""}${Math.abs(rssi)} dBm`);
  lines.push(typeof lqi === "number" ? `LQI ${lqi}` : "LQI ?");
  return lines.join("\n");
}

/** A border router only Home Assistant's Thread integration lists (#20) has no reading the history records. */
export const historyless = (device) => device.inTopology === false;

/** The partner of the "History to gateway" button of device `id` (#24, owner 2026-11-15): the border router of its
 *  route where the way there is complete (routes.js defaultRoute, the one the route card names); without such a route
 *  the map's only border router (also counting one only Home Assistant lists); else none, as the button must mean
 *  one connection. None for a border router itself, and never a partner without a history. */
export function gatewayPartner(network, id) {
  const self = network.devices.find((d) => d.id === id);
  if (!self || self.role === "border router") return null;
  const route = network.routing ? network.routing.defaultRoute(id) : null;
  const all = network.devices.filter((d) => d.role === "border router");
  const partner = route && route.there.complete ? all.find((d) => d.id === route.to)
    : all.length === 1 ? all[0] : null;
  return partner && !historyless(partner) ? partner.id : null;
}
