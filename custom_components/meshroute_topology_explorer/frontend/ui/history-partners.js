// SPDX-License-Identifier: MIT
// Who a device's history window is opened with (spec 9.2, 9.5): the anchors (the role the engine names in its history
// caps, `anchorRole`: Zigbee the coordinator, Thread the border routers) and the neighbours by reception. Pure, no DOM. Runs in Node and the browser. npm test

/** How well a direction was received: a number to compare (the link quality, the signal strength as tie-break), or -1
 *  where it has no reading. Zigbee (0 to 255) and Thread (0 to 3) are never mixed: one network at a time. */
const strength = (dir) => (dir && dir.state === "measured" && typeof dir.lqi === "number"
  ? dir.lqi * 1000 + (typeof dir.rssi === "number" ? dir.rssi + 200 : 0) : -1);


/** The neighbours of device `id` (pairs with a reading in either direction) by reception, strongest first, ties by
 *  name: [{ id, score }] with score the better of the two directions. */
export function neighboursByReception(network, id) {
  const label = new Map(network.devices.map((d) => [d.id, d.label]));
  const out = [];
  for (const p of network.pairs || []) {
    if (p.a !== id && p.b !== id) continue;
    const other = p.a === id ? p.b : p.a;
    if (label.has(other)) out.push({ id: other, score: Math.max(strength(p.ab), strength(p.ba)) });
  }
  return out.sort((x, y) => y.score - x.score || label.get(x.id).localeCompare(label.get(y.id), undefined, { numeric: true }));
}

/** The anchors other than `id`: the coordinator (Zigbee) or the border routers (Thread), the one with the strongest link
 *  to `id` first (anchors without a link by name after them). */
export function anchorsFor(network, id, role) {
  const score = new Map(neighboursByReception(network, id).map((n) => [n.id, n.score]));
  return network.devices.filter((d) => d.id !== id && d.role === role)
    .sort((x, y) => (score.get(y.id) ?? -2) - (score.get(x.id) ?? -2) || x.label.localeCompare(y.label, undefined, { numeric: true }))
    .map((d) => d.id);
}

/** The partner of the History button (owner 2026-11-05): the coordinator / the strongest border router; for an anchor
 *  itself its strongest neighbour by reception. null where there is none (nothing to open a window with). An anchor
 *  the engine calls historyless (its history caps, #20) is never the default; the partner menu still lists it. */
export function defaultPartner(network, id, role, historyless = () => false) {
  const self = network.devices.find((d) => d.id === id);
  if (!self) return null;
  if (self.role === role) {
    const n = neighboursByReception(network, id);
    return n.length ? n[0].id : null;
  }
  const byId = new Map(network.devices.map((d) => [d.id, d]));
  return anchorsFor(network, id, role).find((x) => !historyless(byId.get(x))) ?? null;
}

/** The partner menu of the window header (owner 2026-11-05): the anchors first, then the neighbours of `id` by
 *  reception, then (query given) a search over every device by name. Without a query the list is anchors plus the
 *  `limit` strongest neighbours. Returns [{ id, group: "anchor" | "neighbour" | "device" }] without `id` itself. */
export function partnerChoices(network, id, role, query = "", limit = 12) {
  const q = query.trim().toLowerCase();
  const byId = new Map(network.devices.map((d) => [d.id, d]));
  const anchors = anchorsFor(network, id, role).map((x) => ({ id: x, group: "anchor" }));
  const seen = new Set(anchors.map((x) => x.id));
  const neighbours = neighboursByReception(network, id).filter((n) => !seen.has(n.id)).map((n) => ({ id: n.id, group: "neighbour" }));
  if (!q) return [...anchors, ...neighbours.slice(0, limit)];
  const rest = network.devices.filter((d) => d.id !== id && !seen.has(d.id) && !neighbours.some((n) => n.id === d.id))
    .sort((x, y) => x.label.localeCompare(y.label, undefined, { numeric: true })).map((d) => ({ id: d.id, group: "device" }));
  return [...anchors, ...neighbours, ...rest].filter((c) => byId.get(c.id).label.toLowerCase().includes(q));
}
