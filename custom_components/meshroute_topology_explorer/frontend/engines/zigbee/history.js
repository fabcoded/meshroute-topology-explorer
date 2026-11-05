// SPDX-License-Identifier: MIT
// Path history of a device pair (spec 5.8): what the recorded reception history (10.2) says about the routes between
// two devices over time. Rebuilds a Network per snapshot from the live network input plus the snapshot's tables
// (buildNetwork, the engine itself), walks there and back with the engine's own tableWalk and pathHops, and groups
// equal routes into spans. Pure functions, no DOM. npm test
//
// Two paths to the same numbers: rebuildNetwork() is the full engine build (used for the map at one record and as the
// reference); the timeline uses a light build of the same facts (devices, routes, readings of the snapshot), the same
// walk, ratings only for the receivers on the walk, and pair evidence only for the hops. A test pins both to each other
// on every snapshot. Parents of end devices come from the record's `p` (prepare()).
import { buildNetwork } from "./model.js";
import { tableWalk } from "./paths.js";
import { pathHops } from "./node-paths.js";
import { computePairs } from "./pairs.js";
import { applyRatings } from "./ratings.js";
import { normalizeIeee, parseAddress } from "../../model/parse.js";
import { decodeRecords, entryOf, laneSeries } from "../history-records.js";

const ROLE_TYPE = { coordinator: "Coordinator", router: "Router", "end device": "EndDevice" };
const pct = (rating) => (typeof rating === "number" ? Math.max(0, Math.min(100, Math.round(rating * 100))) : null);

/** What the live input contributes to every snapshot: the live Network (roles, vendors, labels), the raw device
 *  entries, nwk by key (stale addresses are all the record leaves out), the ambiguous addresses and the live Child
 *  listings. `live` = { rawDevices, deviceRegistry, areaRegistry, configEntries } as the panel read them. */
export function liveContext(live) {
  const network = buildNetwork(live.rawDevices, live);
  const raw = new Map();
  for (const r of Array.isArray(live.rawDevices) ? live.rawDevices : []) {
    const id = r && normalizeIeee(r.ieee);
    if (id && !raw.has(id)) raw.set(id, r);
  }
  const nwk = new Map();
  const count = new Map();
  for (const [id, r] of raw) {
    const n = parseAddress(r.nwk);
    if (n !== null) { nwk.set(id, r.nwk); count.set(n, (count.get(n) || 0) + 1); }
  }
  const ambiguous = new Set([...raw.keys()].filter((id) => count.get(parseAddress(raw.get(id).nwk)) > 1));
  const childLive = new Set();
  for (const [id, r] of raw) {
    for (const n of Array.isArray(r.neighbors) ? r.neighbors : []) {
      const sub = n && normalizeIeee(n.ieee);
      if (sub && n.relationship === "Child") childLive.add(`${id}|${sub}`);
    }
  }
  return { network, raw, nwk, ambiguous, childLive, prepared: new WeakMap(), byId: new Map(network.devices.map((d) => [d.id, d])), live };
}

/** The snapshot with its end devices' parents: { table, parent } where `parent` maps child -> its one parent and `table`
 *  is the snapshot plus an empty listing [parent, child, null, null] where the parent's table has none (the engine takes
 *  a parent from the parent's "Child" listing). Parents come from the record's `p` (spec 10.2); a child with two
 *  (stale tables) takes the one that lists it with the better reading, then the lower key. Only a known end device with
 *  a router or coordinator parent counts. A record without any `p` (older files) falls back to the live "Child"
 *  listings, and for a child whose live parent is not in the snapshot to the strongest router listing it. Cached. */
function prepare(ctx, table) {
  let out = ctx.prepared.get(table);
  if (out) return out;
  const eligible = (child, parent) => {
    const [c, o] = [ctx.byId.get(child), ctx.byId.get(parent)];
    return c && c.role === "end device" && o && o.role !== "end device" && o.role !== "unknown";
  };
  const cands = new Map(); // child -> [[parent, lqi]]
  const add = (child, parent, lqi) => { if (!cands.has(child)) cands.set(child, []); cands.get(child).push([parent, lqi]); };
  const seen = new Map(table.e.map(([rx, tx, lqi]) => [`${rx}|${tx}`, lqi ?? -1]));
  if (table.p && table.p.length) {
    for (const [child, parent] of table.p) if (eligible(child, parent)) add(child, parent, seen.get(`${parent}|${child}`) ?? -2);
  } else {
    for (const [rx, tx, lqi] of table.e) if (eligible(tx, rx)) add(tx, rx, lqi ?? -1);
    for (const [child, list] of cands) {
      const known = list.filter(([parent]) => ctx.childLive.has(`${parent}|${child}`));
      cands.set(child, known.length ? known : list);
    }
  }
  const parent = new Map();
  const extra = [];
  for (const [child, list] of cands) {
    const best = [...list].sort((x, y) => (y[1] - x[1]) || (x[0] < y[0] ? -1 : 1))[0][0];
    parent.set(child, best);
    if (!seen.has(`${best}|${child}`)) extra.push([best, child, null, null]);
  }
  out = { table: extra.length ? { ...table, e: table.e.concat(extra) } : table, parent };
  ctx.prepared.set(table, out);
  return out;
}

/** Keys of a snapshot that are devices unknown to the live input (IEEE keys only; "0x2B82" text stays text). */
function placeholderKeys(ctx, table) {
  const found = new Set();
  const see = (k) => { if (!ctx.raw.has(k) && normalizeIeee(k)) found.add(k); };
  for (const [rx, tx] of table.e) { see(rx); see(tx); }
  for (const [h, d, n] of table.r) { see(h); see(d); see(n); }
  return [...found];
}

/** The full Network at one snapshot: the live input with every device's neighbour and routing tables replaced by the
 *  snapshot's. A device in the snapshot but not live is a placeholder (`placeholder: true`, role unknown, no address);
 *  a live device without tables in the snapshot has none ("table not read"); a device that holds tables in the
 *  snapshot counts as available. */
export function rebuildNetwork(ctx, original) {
  const { table, parent } = prepare(ctx, original);
  const holders = new Set();
  const nbrs = new Map();
  const rts = new Map();
  for (const [rx] of table.e) holders.add(rx);
  for (const [h] of table.r) holders.add(h);
  const used = new Set([...ctx.nwk.values()].map(parseAddress));
  const synthetic = new Map();
  let next = 0xfff0;
  for (const k of placeholderKeys(ctx, table)) { while (used.has(next)) next -= 1; used.add(next); synthetic.set(k, next); }
  const addr = (k) => ctx.nwk.get(k) ?? synthetic.get(k) ?? k;
  for (const [rx, tx, lqi] of table.e) {
    if (!nbrs.has(rx)) nbrs.set(rx, []);
    const sub = ctx.byId.get(tx);
    nbrs.get(rx).push({ ieee: tx, nwk: addr(tx), device_type: sub ? ROLE_TYPE[sub.role] : undefined, lqi,
      relationship: parent.get(tx) === rx ? "Child" : "Sibling" });
  }
  for (const [h, d, n, status] of table.r) {
    if (!rts.has(h)) rts.set(h, []);
    rts.get(h).push({ dest_nwk: addr(d), next_hop: addr(n), route_status: status });
  }
  const devices = [...ctx.raw.entries()].map(([id, r]) => ({ ...r, available: holders.has(id) ? true : r.available,
    neighbors: nbrs.get(id) || [], routes: rts.get(id) || [] }));
  for (const k of synthetic.keys()) {
    devices.push({ ieee: k, nwk: addr(k), name: k, available: true, neighbors: nbrs.get(k) || [], routes: rts.get(k) || [] });
  }
  const net = buildNetwork(devices, ctx.live);
  for (const d of net.devices) if (synthetic.has(d.id)) { d.nwk = null; d.placeholder = true; }
  return net;
}

/** The light facts of a snapshot for walks: devices (id, role, vendor, available, hasTable, parent), readings and
 *  usable routes, from the same rules as the engine's normalize (from-zha.js). */
function lightOf(ctx, original) {
  const { table, parent } = prepare(ctx, original);
  const holders = new Set();
  const listed = new Set();
  for (const [rx] of table.e) { holders.add(rx); }
  for (const [h] of table.r) listed.add(h);
  const devices = new Map();
  const add = (id, d) => devices.set(id, { id, role: d ? d.role : "unknown", vendor: d ? d.vendor : null,
    available: holders.has(id) || listed.has(id) ? true : d ? d.available : true, hasTable: holders.has(id),
    parent: null, children: [] });
  for (const d of ctx.network.devices) add(d.id, d);
  const known = (k) => devices.has(k) || (normalizeIeee(k) && (add(k, null), true));
  const readings = [];
  const byReporter = new Map();
  for (const [rx, tx, lqi] of table.e) {
    known(rx); known(tx);
    const rd = { reporter: rx, subject: tx, lqi, measured: lqi !== null && lqi > 0, rating: null };
    readings.push(rd);
    if (!byReporter.has(rx)) byReporter.set(rx, []);
    byReporter.get(rx).push(rd);
  }
  for (const [child, p] of parent) devices.get(child).parent = p;
  const routes = [];
  for (const [h, d, n, status] of table.r) {
    if (!devices.has(h) || ctx.ambiguous.has(d) || ctx.ambiguous.has(n) || !known(d) || !known(n)) continue;
    routes.push({ owner: h, destination: d, nextHop: n, status, direct: d === n, stale: false });
  }
  const routesOf = new Map();
  for (const r of routes) routesOf.set(r.owner, (routesOf.get(r.owner) || []).concat(r));
  const list = [...devices.values()];
  return { list, byId: devices, readings, routes, byReporter, routesOf, net: { devices: list, readings, routes } };
}

/** The part of the description both builds share: hops with RX, rank in percent (the panel's "rank N %"), the walk's
 *  reason when it stopped, and the weakest hop. */
function describeWalk(walk, evidence, table) {
  const hops = walk.hops.map((h, i) => {
    const e = evidence[i];
    const v = e.state === "measured" ? entryOf(table, h.hearer, h.sender) : null;
    return { sender: h.sender, hearer: h.hearer, how: h.how, state: e.state, lqi: e.state === "measured" ? e.lqi : null,
      rssi: v ? v[1] : null, source: e.source, rankPct: e.state === "measured" ? pct(e.rating) : null };
  });
  return { ids: walk.ids, complete: walk.complete, reason: walk.complete ? null : walk.reason, hops, weakest: weakestHop(hops) };
}

/** Index of the weakest hop by rank at its receiver, or null: a route of one hop has none (owner 2026-11-05: nothing to
 *  compare it with), hops without a rank (parent or route links without a
 *  reading, LQI 0, too few readings) are never the weakest; ties go to the first hop. Never by raw LQI (spec 5.8). */
export function weakestHop(hops) {
  if (hops.length < 2) return null;
  let at = null;
  hops.forEach((h, i) => { if (typeof h.rankPct === "number" && (at === null || h.rankPct < hops[at].rankPct)) at = i; });
  return at;
}

/** Walk `from` to `to` on a full Network (rebuildNetwork). */
export function walkOnNetwork(net, table, from, to) {
  const w = tableWalk(net, from, to);
  return describeWalk(w, pathHops(net, w.ids), table);
}

/** Walk on the light facts: ratings only for the receivers on the walk (and, where a receiver has fewer than ten
 *  readings, for its vendor's reporters), pair evidence only for the hops. */
function walkLight(light, table, from, to) {
  const w = tableWalk(light.net, from, to);
  const need = new Set(w.hops.map((h) => h.hearer));
  const subset = [];
  const vendors = new Set();
  for (const r of need) {
    const list = light.byReporter.get(r) || [];
    if (list.filter((x) => x.lqi > 0).length < 10) vendors.add(light.byId.get(r).vendor);
  }
  for (const [rep, list] of light.byReporter) {
    if (need.has(rep) || (vendors.size && vendors.has(light.byId.get(rep).vendor))) subset.push(...list);
  }
  applyRatings(light.list, subset);
  const pairKey = new Set(w.hops.flatMap((h) => [`${h.sender}|${h.hearer}`, `${h.hearer}|${h.sender}`]));
  const readings = w.hops.flatMap((h) => (light.byReporter.get(h.hearer) || []).concat(light.byReporter.get(h.sender) || []))
    .filter((r) => pairKey.has(`${r.reporter}|${r.subject}`));
  const routes = w.hops.flatMap((h) => (light.routesOf.get(h.hearer) || []).concat(light.routesOf.get(h.sender) || []))
    .filter((r) => pairKey.has(`${r.owner}|${r.nextHop}`));
  const evidence = pathHops({ pairs: computePairs({ devices: light.list, readings, routes }) }, w.ids);
  return describeWalk(w, evidence, table);
}

const sigOf = (w) => `${w.ids.join(">")}${w.complete ? "" : `!${w.reason}`}`;

/** Spans of consecutive records with identical there and back hop lists (ids and, for a stopped route, its reason):
 *  [{ from, to, count, firstIndex, lastIndex, there, back }]. `there`/`back` = the first record's walk (ids, complete,
 *  reason, hops) plus `ranks[i]` = { min, mean, max } of the rank at hop i over the span's records (null without
 *  ranks) and `weakest` = { sender, hearer, min, mean, max } of the hop with the lowest mean rank, or null. */
export function routeSpans(points) {
  const spans = [];
  for (const p of points) {
    const sig = `${sigOf(p.there)}/${sigOf(p.back)}`;
    let s = spans[spans.length - 1];
    if (!s || s.sig !== sig) { s = { sig, from: p.t, to: p.t, count: 0, firstIndex: p.index, lastIndex: p.index, there: p.there, back: p.back, samples: [] }; spans.push(s); }
    s.to = p.t; s.count += 1; s.lastIndex = p.index;
    s.samples.push(p);
  }
  return spans.map(({ sig, samples, ...s }) => {
    const side = (dir) => {
      const w = samples[0][dir];
      const ranks = w.hops.map((_, i) => {
        const v = samples.map((x) => x[dir].hops[i].rankPct).filter((x) => typeof x === "number");
        return v.length ? { min: Math.min(...v), mean: v.reduce((a, b) => a + b, 0) / v.length, max: Math.max(...v) } : null;
      });
      let at = null;
      if (w.hops.length >= 2) ranks.forEach((r, i) => { if (r && (at === null || r.mean < ranks[at].mean)) at = i; });
      return { ids: w.ids, complete: w.complete, reason: w.reason, hops: w.hops, ranks,
        weakest: at === null ? null : { sender: w.hops[at].sender, hearer: w.hops[at].hearer, ...ranks[at] } };
    };
    return { ...s, there: side("there"), back: side("back") };
  });
}

/** The route a lane was opened from, for laneSeries' `context`: the direction ("there" = a to b of the timeline),
 *  record time, hop index and count, the hop and the route's ids; `ghost` marks a route that is not the one shown now. */
export function hopContext(timeline, direction, point, hopIndex, ghost = false) {
  const w = point[direction];
  const hop = w.hops[hopIndex];
  return { pair: [timeline.a, timeline.b], direction, t: point.t, index: point.index, hopIndex, hopCount: w.hops.length,
    sender: hop.sender, hearer: hop.hearer, ids: w.ids, complete: w.complete, reason: w.reason, ghost };
}

/** The history of one network over one range, for the pair window. engine "zigbee" needs `live`
 *  ({ rawDevices, deviceRegistry, areaRegistry, configEntries }); "thread" needs nothing (it has no walks).
 *  - snapshots: decodeRecords' list.
 *  - timeline(a, b): { a, b, points: [{ t, index, there, back }], spans } (walks are null for Thread; Thread points are
 *    { t, index, aHearsB, bHearsA } = [lqi, rssi] or null).
 *  - walkAt(a, b, index): the full-engine walk there and back at a record: { t, there, back } (map and metro view).
 *  - networkAt(index): the full rebuilt Network at a record.
 *  - device(key): the live device for a hop node's symbol, or a placeholder.
 *  - lane(a, b, window, context): laneSeries over this history's snapshots. */
export function createHistory({ engine = "zigbee", response, live = null }) {
  const snapshots = decodeRecords(response);
  const ctx = engine === "zigbee" ? liveContext(live) : null;
  const lights = new WeakMap();
  const fulls = new WeakMap();
  const memo = new Map();
  const light = (t) => { let l = lights.get(t); if (!l) { l = lightOf(ctx, t); lights.set(t, l); } return l; };
  const networkAt = (index) => {
    const s = snapshots[index];
    if (!s || s.empty) return null;
    let n = fulls.get(s.table);
    if (!n) { n = rebuildNetwork(ctx, s.table); fulls.set(s.table, n); }
    return n;
  };
  const timeline = (a, b) => {
    const key = `${a}|${b}`;
    if (memo.has(key)) return memo.get(key);
    const per = new Map(); // table -> its walks, shared by time-only records
    const points = snapshots.map((s) => {
      if (engine !== "zigbee") {
        const v = (rx, tx) => { const e = entryOf(s.table, rx, tx); return s.empty || !e ? null : e; };
        return { t: s.t, index: s.index, aHearsB: v(a, b), bHearsA: v(b, a) };
      }
      let w = per.get(s.table);
      if (!w) {
        const l = light(s.table);
        w = l.byId.has(a) && l.byId.has(b) && !s.empty ? { there: walkLight(l, s.table, a, b), back: walkLight(l, s.table, b, a) }
          : { there: unread(a), back: unread(b) };
        per.set(s.table, w);
      }
      return { t: s.t, index: s.index, there: w.there, back: w.back };
    });
    const result = { a, b, points, spans: engine === "zigbee" ? routeSpans(points) : [] };
    memo.set(key, result);
    return result;
  };
  const walkAt = (a, b, index) => {
    const s = snapshots[index];
    const net = networkAt(index);
    if (!net) return null;
    return { t: s.t, there: walkOnNetwork(net, s.table, a, b), back: walkOnNetwork(net, s.table, b, a) };
  };
  /** The device behind a key for the UI's symbols: the live device, else a placeholder ({ id, role: "unknown", placeholder }). */
  const device = (key) => (ctx && ctx.byId.get(key)) || { id: key, label: key, role: "unknown", placeholder: true };
  return { engine, snapshots, timeline, walkAt, networkAt, device, lane: (a, b, window, context) => laneSeries(snapshots, a, b, window, context) };
}

/** A pair with a device the snapshot does not know, or an empty snapshot: nothing to walk. */
const unread = (from) => ({ ids: [from], complete: false, reason: "table not read", hops: [], weakest: null });

/** Histories by network and range, so the window loads each once: get(network, range) -> history or undefined,
 *  set(network, range, history), clear(network?) (after a new capture or a changed recording). */
export function createHistoryCache() {
  const m = new Map();
  return { get: (n, r) => m.get(`${n}|${r}`), set: (n, r, h) => { m.set(`${n}|${r}`, h); return h; },
    clear: (n) => { for (const k of [...m.keys()]) if (n === undefined || k.startsWith(`${n}|`)) m.delete(k); } };
}
