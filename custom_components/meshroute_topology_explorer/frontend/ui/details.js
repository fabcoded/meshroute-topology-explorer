// SPDX-License-Identifier: MIT
// What the Details tab shows for one device (spec 9.2), gathered from the Network as plain data: parent and its
// availability, children, relay load, readings in both directions with reporter and rating, its own routing entries
// and its findings. No DOM; details-tab.js renders it. Tested in Node: node --test tests/

const byRating = (a, b) => ((b.rating ?? -1) - (a.rating ?? -1)) || ((b.lqi ?? -1) - (a.lqi ?? -1))
  || a.device.label.localeCompare(b.device.label);

/** Details of device `id`, or null if the network does not have it. Reading rows: { device (the other end), lqi,
 *  rating, pool, poolMedian, reporter (whose scale the rating is on) }. */
export function detailsOf(network, id) {
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
  };
}
