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

/** One path in parts (board M4): prefix ("there", "back", "back, assumed (source route)", "to X", "from X"), the
 *  steps in the direction of travel, each { name, rx } with rx the reception at that device (null for the first),
 *  and tail ("path unknown") where the walk stopped short of its goal. A goal that is unavailable is named so.
 *  name(id) gives a device's label. */
export function pathParts(path, t, name) {
  const prefix = path.kind === "out" ? t("details.path_out", { name: name(path.to) })
    : path.kind === "in" ? t("details.path_in", { name: name(path.from) })
      : path.kind === "up" ? t("details.path_up")
        : t(path.assumed ? "details.path_down_assumed" : "details.path_down");
  const steps = path.ids.length ? [{ name: name(path.ids[0]), rx: null },
    ...path.hops.map((hop) => ({ name: name(hop.hearer), rx: hopValue(hop, t) }))] : [];
  let tail = null;
  if (!path.complete) {
    if (unknownEnd(path) || !steps.length) tail = t("details.path_unknown");
    else steps[steps.length - 1] = { name: t("details.path_unavailable", { name: name(path.to) }), rx: null };
  }
  return { prefix, steps, tail };
}

/** One path as a line of text: "there: Sensor → Router 17 · RX 103 → Coordinator · RX 51"; an incomplete path ends
 *  in "path unknown", or names its unavailable goal. */
export function pathLine(path, t, name) {
  const { prefix, steps, tail } = pathParts(path, t, name);
  const items = steps.map((s) => (s.rx === null ? s.name : `${s.name} \u00B7 ${t("details.rx")} ${s.rx}`));
  if (tail) items.push(tail);
  return `${prefix}: ${items.join(" \u2192 ")}`;
}

/** Details of device `id`, or null if the network does not have it. Reading rows: { device (the other end), lqi,
 *  rating, pool, poolMedian, reporter (whose scale the rating is on) }. paths: the device's paths in the node view
 *  `nodeView` ("coordinator" or "all", model/node-paths.js), with the source-route stage `sourceRoute` ("off" or
 *  "assume", model/source-routes.js). */
export function detailsOf(network, id, nodeView, { sourceRoute = "off" } = {}) {
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
    routingEntries: network.routes.filter((r) => r.owner === id).length,
    paths: nodePaths(network, id, nodeView, { sourceRoute }),
  };
}
