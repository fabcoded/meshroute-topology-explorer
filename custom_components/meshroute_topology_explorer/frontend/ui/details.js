// SPDX-License-Identifier: MIT
// What the Details tab shows for one device (spec 9.2), gathered from the Network as plain data: parent and its
// availability, children, relay load, readings in both directions with reporter and rating, its own routing entries,
// its findings, and its paths in the node view as text lines, so every value the map draws at a hop also exists as
// text (spec 9.3). No DOM; details-tab.js renders it. Tested in Node: node --test tests/
import { nodePaths, unknownEnd } from "../model/node-paths.js";
import { lqiText } from "./format.js";

const byRating = (a, b) => ((b.rating ?? -1) - (a.rating ?? -1)) || ((b.lqi ?? -1) - (a.lqi ?? -1))
  || a.device.label.localeCompare(b.device.label);

/** The reception at a hop as the map writes it after "RX:": the LQI at the hearer, Parent or Route where only a parent
 *  link or a route implies the hop, "?" where nothing does. */
export function hopValue(hop, t) {
  if (hop.state === "implied") return t(hop.source === "parent" ? "lane.parent" : "lane.route");
  if (hop.state === "measured" || hop.lqi === 0) return lqiText(hop.lqi, t);
  return "?";
}

/** One path as a line of text: "To the coordinator: Sensor → Router 17 (RX 103) → Coordinator (RX 51)"; an
 *  incomplete path ends in "path unknown", or names its unavailable goal. name(id) gives a device's label. */
export function pathLine(path, t, name) {
  const parts = path.ids.length ? [name(path.ids[0]), ...path.hops.map((hop) =>
    t("details.path_hop", { name: name(hop.hearer), value: hopValue(hop, t) }))] : [];
  if (!path.complete) {
    if (unknownEnd(path) || !parts.length) parts.push(t("details.path_unknown"));
    else parts[parts.length - 1] = t("details.path_unavailable", { name: name(path.to) });
  }
  const text = parts.join(" \u2192 ");
  if (path.kind === "out") return t("details.path_out", { name: name(path.to), path: text });
  if (path.kind === "in") return t("details.path_in", { name: name(path.from), path: text });
  return t(path.kind === "up" ? "details.path_up" : "details.path_down", { path: text });
}

/** Details of device `id`, or null if the network does not have it. Reading rows: { device (the other end), lqi,
 *  rating, pool, poolMedian, reporter (whose scale the rating is on) }. paths: the device's paths in the node view
 *  `nodeView` ("coordinator" or "all", model/node-paths.js). */
export function detailsOf(network, id, nodeView) {
  const byId = new Map(network.devices.map((d) => [d.id, d]));
  const device = byId.get(id);
  if (!device) return null;
  const row = (r, other) => ({ device: byId.get(other), reporter: byId.get(r.reporter), lqi: r.lqi, rating: r.rating,
    pool: r.pool, poolMedian: r.poolMedian, relationship: r.relationship });
  const heardBy = network.readings.filter((r) => r.subject === id && byId.has(r.reporter))
    .map((r) => row(r, r.reporter)).sort(byRating);
  const hears = network.readings.filter((r) => r.reporter === id && byId.has(r.subject))
    .map((r) => row(r, r.subject)).sort(byRating);
  const routes = network.routes.filter((r) => r.owner === id && byId.has(r.destination) && byId.has(r.nextHop))
    .map((r) => ({ destination: byId.get(r.destination), nextHop: byId.get(r.nextHop), status: r.status,
      direct: r.direct, stale: r.stale }))
    .sort((a, b) => a.destination.label.localeCompare(b.destination.label));
  const parent = device.parent ? byId.get(device.parent) || null : null;
  return {
    device,
    parent,
    parentLqi: device.parentLqi,
    parentFromStaleTable: device.parentFromStaleTable,
    possiblyStaleParents: (device.possiblyStaleParents || []).map((p) => byId.get(p)).filter(Boolean),
    children: device.children.map((c) => byId.get(c)).filter(Boolean)
      .sort((a, b) => a.label.localeCompare(b.label)),
    relayLoad: device.relayLoad,
    reception: device.rating,
    heardBy,
    hears,
    routes,
    findings: network.findings.filter((f) => f.device === id),
    paths: nodePaths(network, id, nodeView),
  };
}
