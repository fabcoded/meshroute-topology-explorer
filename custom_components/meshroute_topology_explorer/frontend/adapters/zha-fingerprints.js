// SPDX-License-Identifier: MIT
// Observations (spec 6): ZHA publishes no scan time, so the panel keeps a fingerprint per router over its sorted
// neighbour and routing tables (with LQI) and the time it first saw that fingerprint. This file is the pure part of
// the ZHA adapter's observations; zha-observations.js stores the result through the integration. "Unchanged since" thus means "observed unchanged since".

/** 64-bit hex hash from two 32-bit lanes: FNV-1a (prime 0x01000193) and a second lane with the same loop but the
 *  multiplier 0x85ebca6b (a MurmurHash3 mixing constant). Not cryptographic and not a standard hash: it only has to
 *  notice that a table changed. */
function hash(textValue) {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x9e3779b9;
  for (let i = 0; i < textValue.length; i += 1) {
    const c = textValue.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x85ebca6b) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

/** Fingerprint per device that has a usable table: { id: hex }. Entries are sorted and use parsed numbers, so the
 *  order ZHA lists them in and the spelling of addresses ("0x0D" / "0X0d") do not change it. */
export function fingerprints(network) {
  const neighbours = new Map();
  const routes = new Map();
  const push = (map, key, line) => { if (!map.has(key)) map.set(key, []); map.get(key).push(line); };
  for (const r of network.readings) push(neighbours, r.reporter, `${r.subject}|${r.lqi}|${r.relationship}`);
  for (const r of network.routes) if (!r.stale) push(routes, r.owner, `${r.destination}|${r.nextHop}|${r.status}`);
  const out = {};
  for (const d of network.devices) {
    if (!d.hasTable) continue;
    const n = (neighbours.get(d.id) || []).sort().join(";");
    const rt = (routes.get(d.id) || []).sort().join(";");
    out[d.id] = hash(`n:${n}\nr:${rt}`);
  }
  return out;
}

/** Compare current fingerprints with a store { id: { fingerprint, firstSeen } }. Does not modify the store: returns
 *  { store, changed } where `store` has a new entry (firstSeen = `now`) for every id whose fingerprint is new or
 *  differs, and `changed` lists those ids. Entries for ids not in `current` are kept. */
export function updateObservations(store, current, now) {
  const next = { ...(store || {}) };
  const changed = [];
  for (const id of Object.keys(current).sort()) {
    if (!next[id] || next[id].fingerprint !== current[id]) {
      next[id] = { fingerprint: current[id], firstSeen: now };
      changed.push(id);
    }
  }
  return { store: next, changed };
}

/** The newest change observed: the latest `firstSeen` among `ids` (default: all), or null. ISO strings of one
 *  format compare correctly as text. */
export function newestChange(store, ids) {
  let newest = null;
  for (const id of ids || Object.keys(store || {})) {
    const t = store && store[id] && store[id].firstSeen;
    if (t && (newest === null || t > newest)) newest = t;
  }
  return newest;
}
