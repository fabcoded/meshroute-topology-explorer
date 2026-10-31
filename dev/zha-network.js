// SPDX-License-Identifier: MIT
// Development only, not shipped: turns a capture's `zha/devices` answer into the Network shape the graph core reads
// ({ source, id, devices: [{ id, role, label, available, rating, nwk }], readings: [{ reporter, subject, lqi }] }).
// The real adapter is a separate work package; this one exists for the demo page (dev/graph.html) and the tests.
// The rating is a simplified spec 5.4 (reporter pool only, no vendor pool) so the demo shows the fill colours.

const ROLE = { Coordinator: "coordinator", Router: "router", EndDevice: "end device" };

function parseNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const s = value.trim();
  if (/^0[xX][0-9a-fA-F]+$/.test(s)) return parseInt(s.slice(2), 16);
  return /^[0-9]+$/.test(s) ? parseInt(s, 10) : null;
}

/** Mid-rank percentile of v among values (0..1). */
function midRank(values, v) {
  let below = 0;
  let equal = 0;
  for (const x of values) { if (x < v) below++; else if (x === v) equal++; }
  return (below + equal / 2) / values.length;
}

export function zhaToNetwork(capture, id = "sample") {
  const responses = capture.responses || capture;
  const list = responses["zha/devices"] || [];
  const devices = list.map((d) => ({
    id: String(d.ieee).toLowerCase(),
    role: ROLE[d.device_type] || "unknown",
    label: d.user_given_name || d.name || String(d.ieee),
    available: Boolean(d.available),
    rating: null,
    nwk: parseNumber(d.nwk),
  }));
  const readings = [];
  for (const d of list) {
    for (const n of d.neighbors || []) {
      readings.push({ reporter: String(d.ieee).toLowerCase(), subject: String(n.ieee).toLowerCase(), lqi: parseNumber(n.lqi) });
    }
  }
  // Reception: best rating among readings in which the device is the subject (LQI 0 excluded); a reporter needs at
  // least 10 non-zero values for its readings to be rated.
  const pools = new Map();
  for (const r of readings) {
    if (!(r.lqi > 0)) continue;
    if (!pools.has(r.reporter)) pools.set(r.reporter, []);
    pools.get(r.reporter).push(r.lqi);
  }
  const best = new Map();
  for (const r of readings) {
    const pool = pools.get(r.reporter);
    if (!(r.lqi > 0) || !pool || pool.length < 10) continue;
    const rating = midRank(pool, r.lqi);
    if (!best.has(r.subject) || rating > best.get(r.subject)) best.set(r.subject, rating);
  }
  for (const d of devices) d.rating = best.has(d.id) ? best.get(d.id) : null;
  return { source: "zha", id, devices, readings };
}
