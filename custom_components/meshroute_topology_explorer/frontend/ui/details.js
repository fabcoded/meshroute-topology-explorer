// SPDX-License-Identifier: MIT
// What the Details tab shows for one device (spec 9.2), gathered from the Network as plain data: parent and its
// availability, children, relay load, readings in both directions with reporter and rating, its own routing entries,
// its findings, and its paths in the node view as text lines, so every value the map draws at a hop also exists as
// text (spec 9.3); in the stages "all" and "heard" its theoretical paths per other device (spec 5.7) with how each hop
// is taken. No DOM; details-tab.js renders it. Tested in Node: node --test tests/
import { nodePaths, unknownEnd } from "../model/node-paths.js";
import { lqiText } from "./format.js";
import { unknownGlyph } from "../graph/links.js";

const byRating = (a, b) => ((b.rating ?? -1) - (a.rating ?? -1)) || ((b.lqi ?? -1) - (a.lqi ?? -1))
  || a.device.label.localeCompare(b.device.label);

/** The reception at a hop as the map writes it after "RX:": the LQI at the hearer, Parent or Route where only a parent
 *  link or a route implies the hop, "?" where nothing does. */
export function hopValue(hop, t) {
  if (hop.state === "implied") return t(hop.source === "parent" ? "lane.parent" : "lane.route");
  if (hop.state === "measured" || hop.lqi === 0) return lqiText(hop.lqi, t);
  return unknownGlyph(hop.reason);
}

/** Why a hop shows "–": the reverse reading (the sender hears the hearer with N), the hearer's table (full, nearly
 *  full, with space) and, where the table has room, that the link is probably one-sided or aged. null for any other
 *  hop, "?" included (no table to ask: nothing to name). name(id) gives a device's label. */
export function hopBasis(hop, t, name) {
  if (hop.state !== "unknown" || unknownGlyph(hop.reason) !== "–") return null;
  const r = String(hop.reason);
  const size = (/\(([^),]*)/.exec(r) || [])[1] || "";
  const key = /^table full/.test(r) ? "full" : /^table nearly full/.test(r) ? "nearly" : /^table has space/.test(r) ? "space" : "capacity";
  const parts = [];
  if (typeof hop.backLqi === "number") parts.push(t("details.basis_heard", { sender: name(hop.sender), hearer: name(hop.hearer), lqi: hop.backLqi }));
  parts.push(t(`details.basis_${key}`, { hearer: name(hop.hearer), size }));
  const text = `${t("details.basis")} ${parts.join("; ")}`;
  return key === "space" ? `${text}. ${t("details.basis_one_sided")}` : text;
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
  const steps = path.ids.length ? [{ name: name(path.ids[0]), rx: null, how: null },
    ...path.hops.map((hop) => ({ name: name(hop.hearer), rx: hopValue(hop, t), how: hop.how || null,
      noEntry: hop.noEntry || null, basis: hopBasis(hop, t, name) }))] : [];
  let tail = null;
  if (!path.complete) {
    if (unknownEnd(path) || !steps.length) {
      // A theoretical walk says why it stopped (spec 5.7); the walks of 5.1 stop only where a table or entry is missing.
      tail = path.reason && path.reason !== "unavailable"
        ? `${t("details.path_unknown")} (${stopText(path.reason, t)})` : t("details.path_unknown");
    }
    else steps[steps.length - 1] = { name: t("details.path_unavailable", { name: name(path.to) }), rx: null };
  }
  return { prefix, steps, tail };
}

/** Words for how a theoretical hop is taken (spec 5.7): table, neighbour, route discovery (computed), parent, child. */
export function howText(how, t) {
  return t(`details.how_${how}`);
}

/** Why a theoretical path stopped (model/theoretical.js reasons), in words. */
export function stopText(reason, t) {
  return t(`details.stop_${String(reason || "unknown").replace(/ /g, "_")}`);
}

/** The theoretical paths of a node view per other device (spec 5.7, 9.2): [{ id, out, in }] with out the path from
 *  the device and in the path back, sorted by the hop count of the way there, then of the way back, then by name (natural order: Router 2 before Router 10);
 *  incomplete ways last. Paths without `how` on their hops (up, down, the coordinator's routes) are not theoretical. */
export function theoryRows(paths, name) {
  const rows = new Map();
  for (const p of paths) {
    if ((p.kind !== "out" && p.kind !== "in") || !p.hops.some((h) => h.how)) continue;
    const id = p.kind === "out" ? p.to : p.from;
    if (!rows.has(id)) rows.set(id, { id, out: null, in: null });
    rows.get(id)[p.kind] = p;
  }
  const count = (p) => (p && p.complete ? p.hops.length : Infinity);
  return [...rows.values()].sort((a, b) => count(a.out) - count(b.out) || count(a.in) - count(b.in)
    || name(a.id).localeCompare(name(b.id), undefined, { numeric: true }));
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
  const paths = nodePaths(network, id, nodeView, { sourceRoute });
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
    paths,
    theory: theoryRows(paths, (x) => (byId.get(x) || { label: x }).label),
  };
}
