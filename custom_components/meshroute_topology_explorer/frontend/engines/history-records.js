// SPDX-License-Identifier: MIT
// Reception history, network independent (spec 10.2, 5.8): decodes the answer of `meshroute_topology_explorer/history/records`
// into snapshots in time order, and cuts the value series of one lane out of them (both networks: LQI, and RSSI where
// the record has it; Thread has no walk, so these series are all a Thread pair gets). Pure functions. npm test
//
// Times are epoch seconds, as the records give them.

/** The ranges of the pair window, in seconds. */
export const RANGES = Object.freeze({ "48h": 48 * 3600, "7d": 7 * 86400, "30d": 30 * 86400, "90d": 90 * 86400 });
/** Half width of a lane window centred on a record ("from a pill click"), and the length of "the last 48 h". */
export const LANE_HALF_WINDOW = 48 * 3600;

const NO_TABLE = Object.freeze({ e: [], r: [], l: [] });

/** Snapshots in time order from `{ k, records }`: [{ t, table, index, empty }]. `table` = { e: [[receiver, sender,
 *  lqi, rssi|null]], r: [[holder, destination, next hop, status]], l: [[device, [relays]]] } with keys resolved; a
 *  time-only record shares the previous snapshot's table object (same identity = unchanged, so caches can key on it).
 *  A `{k}` line among the records extends the key table (the file form). A row naming an unknown key is dropped; a
 *  time-only record before any full one has an empty table (`empty: true`). */
export function decodeRecords(response) {
  const keys = Array.isArray(response && response.k) ? [...response.k] : [];
  const list = Array.isArray(response && response.records) ? response.records : [];
  const snapshots = [];
  let table = NO_TABLE;
  let empty = true;
  const key = (i) => (Number.isInteger(i) && i >= 0 && i < keys.length ? keys[i] : null);
  for (const rec of list) {
    if (!rec || typeof rec !== "object") continue;
    if (Array.isArray(rec.k)) { keys.push(...rec.k); continue; }
    if (!Number.isFinite(rec.t)) continue;
    if (Array.isArray(rec.e)) {
      const e = [];
      for (const x of rec.e) {
        const [rx, tx] = [key(x[0]), key(x[1])];
        if (rx !== null && tx !== null) e.push([rx, tx, Number.isFinite(x[2]) ? x[2] : null, Number.isFinite(x[3]) ? x[3] : null]);
      }
      const r = [];
      for (const x of Array.isArray(rec.r) ? rec.r : []) {
        const [h, d, n] = [key(x[0]), key(x[1]), key(x[2])];
        if (h !== null && d !== null && n !== null) r.push([h, d, n, String(x[3])]);
      }
      const l = [];
      for (const x of Array.isArray(rec.l) ? rec.l : []) {
        const relays = (Array.isArray(x[1]) ? x[1] : []).map(key);
        if (key(x[0]) !== null && !relays.includes(null)) l.push([key(x[0]), relays]);
      }
      table = { e, r, l };
      empty = false;
    }
    snapshots.push({ t: rec.t, table, index: 0, empty });
  }
  if (snapshots.some((s, i) => i && s.t < snapshots[i - 1].t)) snapshots.sort((x, y) => x.t - y.t); // stable
  snapshots.forEach((s, i) => { s.index = i; });
  return snapshots;
}

const byPair = new WeakMap(); // table -> Map "receiver|sender" -> [lqi, rssi]

/** The value the receiver's table holds for the sender in a table: [lqi, rssi|null] or null. Indexed once per table. */
export function entryOf(table, receiver, sender) {
  let m = byPair.get(table);
  if (!m) {
    m = new Map();
    for (const [rx, tx, lqi, rssi] of table.e) m.set(`${rx}|${tx}`, [lqi, rssi]);
    byPair.set(table, m);
  }
  return m.get(`${receiver}|${sender}`) || null;
}

/** Points of one direction: [t, lqi(, rssi)] for a record with the entry, [t, null] for one without (a gap). */
function points(snapshots, receiver, sender) {
  return snapshots.map((s) => {
    const v = entryOf(s.table, receiver, sender);
    if (!v || s.empty) return [s.t, null];
    return v[1] === null ? [s.t, v[0]] : [s.t, v[0], v[1]];
  });
}

/** Both directions of one lane over a window of the snapshots (`snapshots` as decodeRecords gives them):
 *  { a, b, from, to, aHearsB, bHearsA, firstSeen, context }. `aHearsB` is a's own table value for b (a is the
 *  receiver), `bHearsA` the reverse, each [t, lqi(, rssi)] or [t, null] where a record lacks the entry, one point per
 *  record in the window. Window: { center } = centred +-48 h (pill click; `half` overrides the half width) or
 *  { last } = the last 48 h before the newest record (lane row; a number of seconds overrides), or { from, to }.
 *  `firstSeen` = { aHearsB, bHearsA }: the time of the first record in all of `snapshots` that has the entry (null if
 *  none): when the lane first appears. `context` is passed through: the route and hop the lane was opened from (see
 *  hopContext in zigbee/history.js), null from a lane row. */
export function laneSeries(snapshots, a, b, window = { last: true }, context = null) {
  const end = snapshots.length ? snapshots[snapshots.length - 1].t : 0;
  let from; let to;
  if (Number.isFinite(window.center)) { const h = window.half ?? LANE_HALF_WINDOW; from = window.center - h; to = window.center + h; }
  else if (Number.isFinite(window.from)) { from = window.from; to = window.to ?? end; }
  else { to = end; from = end - (Number.isFinite(window.last) ? window.last : LANE_HALF_WINDOW); }
  const inside = snapshots.filter((s) => s.t >= from && s.t <= to);
  const first = (rx, tx) => { const s = snapshots.find((x) => !x.empty && entryOf(x.table, rx, tx)); return s ? s.t : null; };
  return { a, b, from, to, aHearsB: points(inside, a, b), bHearsA: points(inside, b, a),
    firstSeen: { aHearsB: first(a, b), bHearsA: first(b, a) }, context };
}
