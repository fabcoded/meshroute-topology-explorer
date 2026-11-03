// SPDX-License-Identifier: MIT
// The Route tab of the path history window, without a canvas (spec 9.5; boards M36 D4 Metro-Map, D5 Mesh): which hops
// a record shows (the walked route there and back, hops of the range's other routes as ghosts; Thread: the pair's
// direct link and its neighbours), the pill text of each, and where stations, lanes and pills go for the two
// drawings. Reuses the map's lane geometry and pill placement (graph/links.js). Pure functions. npm test
import { LANE_OFFSET, laneGeometry, pillCentre, pillDistances, pillSize } from "../graph/links.js";
import { SYMBOL_SIZE } from "../graph/symbols.js";


/** Pill text of a hop of a walk (Zigbee): the receiver's LQI, "Parent" or "Route" where only the link implies the hop,
 *  "?" where nothing does. */
export function hopText(hop, t) {
  if (hop.state === "measured" && typeof hop.lqi === "number") return String(hop.lqi);
  if (hop.state === "implied") return t(["parent"].includes(hop.source) ? "history.parent" : "history.route");
  return t("history.unknown_value");
}

/** Hop items of one walk: { dir, hopIndex, sender, hearer, text, weakest, ghost, pointIndex, kind }. */
function walkItems(walk, dir, pointIndex, t, ghost) {
  return walk.hops.map((h, i) => ({ kind: ghost ? "ghost" : "route", dir, hopIndex: i, sender: h.sender, hearer: h.hearer,
    text: hopText(h, t), weakest: !ghost && walk.weakest === i, ghost, pointIndex }));
}

/** What the Route tab shows at record `index` of a pair's timeline `tl` (history.timeline(a, b)):
 *  { t, index, ids: { there, back }, items } with the current route's hops, the weakest marked, then the ghosts: the
 *  hops of the routes before this record in the range (last value of each, newest route wins) that the current route does not use.
 *  Without walks: items are the direct link both ways and, as `neighbour`, the links of the pair's devices in that record
 *  (`table` = the record's rows). Null when the record is empty. */
export function routeAt({ caps, tl, index, t, table = null }) {
  const point = tl.points[index];
  if (!point) return null;
  if (!caps.walks) return directRoute(tl, point, caps, table);
  const items = [];
  const keys = new Set();
  for (const dir of ["there", "back"]) {
    const list = walkItems(point[dir], dir, index, t, false);
    for (const it of list) keys.add(`${dir}:${it.sender}>${it.hearer}`);
    items.push(...list);
  }
  const ghosts = new Map();
  for (const span of tl.spans) {
    if (span.lastIndex >= index) continue; // only routes before this record
    const last = tl.points[span.lastIndex];
    for (const dir of ["there", "back"]) {
      for (const it of walkItems(last[dir], dir, span.lastIndex, t, true)) {
        const key = `${dir}:${it.sender}>${it.hearer}`;
        if (!keys.has(key)) ghosts.set(key, it);
      }
    }
  }
  return { t: point.t, index, ids: { there: point.there.ids, back: point.back.ids }, items: [...items, ...ghosts.values()] };
}

/** No routing table (Thread): no walked route; the pair's direct link (a to b "there": b hears a) and the neighbours of both devices. */
function directRoute(tl, point, caps, table) {
  const { a, b } = tl;
  const link = (dir, sender, hearer, entry) => ({ kind: "route", dir, hopIndex: 0, sender, hearer, text: caps.entryText(entry),
    weakest: false, ghost: false, pointIndex: point.index });
  const items = [link("there", a, b, point.bHearsA), link("back", b, a, point.aHearsB)];
  const seen = new Set();
  for (const [rx, tx, lqi, rssi] of table ? table.e : []) {
    if (!(rx === a || rx === b || tx === a || tx === b) || (rx === a && tx === b) || (rx === b && tx === a)) continue;
    const key = `${tx}>${rx}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ kind: "neighbour", dir: "there", hopIndex: 0, sender: tx, hearer: rx, text: caps.entryText([lqi, rssi]), weakest: false,
      ghost: false, pointIndex: point.index });
  }
  return { t: point.t, index: point.index, ids: { there: [a, b], back: [b, a] }, items };
}

/** Station order of the Metro-Map: the first sequence gives the columns; every later one puts its other nodes between
 *  the neighbours it shares (a node only the way back uses sits between its shared neighbours), so shared stations line
 *  up. Returns ids in column order. */
export function columnOrder(sequences) {
  const pos = new Map();
  for (const seq of sequences) {
    if (!pos.size) { seq.forEach((id, i) => { if (!pos.has(id)) pos.set(id, i); }); continue; }
    for (let i = 0; i < seq.length;) {
      if (pos.has(seq[i])) { i += 1; continue; }
      let j = i;
      while (j < seq.length && !pos.has(seq[j])) j += 1;
      const lo = i > 0 ? pos.get(seq[i - 1]) : null;
      const hi = j < seq.length ? pos.get(seq[j]) : null;
      const n = j - i;
      for (let k = 0; k < n; k++) {
        pos.set(seq[i + k], lo !== null && hi !== null ? lo + ((hi - lo) * (k + 1)) / (n + 1)
          : lo !== null ? lo + (k + 1) * 0.5 : hi - (n - k) * 0.5);
      }
      i = j;
    }
  }
  return [...pos.entries()].sort((p, q) => p[1] - q[1]).map(([id]) => id);
}

/** Pill rectangle of a hop on its lane geometry: the map's first choice (a quarter before the arrowhead, at most four
 *  symbol diameters), else the middle; never dropped (the lane is short, the pill is accepted over it). */
function pillOn(lane, text, size, measure) {
  const lines = text.split("\n");
  const { w, h } = pillSize(Math.max(...lines.map((l) => measure(l))));
  const height = lines.length > 1 ? h * 1.7 : h;
  const d = pillDistances(lane, size, w, height)[0] ?? lane.len / 2;
  const [x, y] = pillCentre(lane, d);
  return { x, y, w, h: height, text };
}

const quad = (p0, c, p1, s) => (1 - s) * (1 - s) * p0 + 2 * (1 - s) * s * c + s * s * p1;

/** The Metro-Map: two rows (there above, back below), stations in shared columns, hops as horizontal lanes, ghosts as
 *  dashed arcs (there above its row, back below). Returns { stations: [{ id, dir, x, y, ghost }], links: items with
 *  `lane` or `curve` and `pill`, verticals: [{ id, x, y0, y1 }] (the dotted lines of stations both rows share), size }. */
export function metroLayout({ route, width, height, measure, size = SYMBOL_SIZE }) {
  const margin = size / 2 + 36;
  const rowY = { there: Math.round(height * 0.33), back: Math.round(height * 0.72) };
  const by = (dir, ghost) => route.items.filter((it) => it.dir === dir && it.ghost === ghost);
  const chain = (dir) => route.ids[dir];
  const sequences = [chain("there"), [...chain("back")].reverse(), ...route.items.filter((i) => i.ghost)
    .map((i) => (i.dir === "there" ? [i.sender, i.hearer] : [i.hearer, i.sender]))];
  const order = columnOrder(sequences);
  const x = (id) => (order.length < 2 ? width / 2 : margin + (order.indexOf(id) * (width - 2 * margin)) / (order.length - 1));
  const stations = [];
  for (const dir of ["there", "back"]) {
    const ids = new Set(chain(dir));
    for (const it of by(dir, true)) { ids.add(it.sender); ids.add(it.hearer); }
    for (const id of ids) stations.push({ id, dir, x: x(id), y: rowY[dir], ghost: !chain(dir).includes(id) });
  }
  const verticals = [];
  for (const s of stations) {
    const other = stations.find((o) => o.id === s.id && o.dir === "back");
    if (s.dir === "there" && other) verticals.push({ id: s.id, x: s.x, y0: s.y, y1: other.y });
  }
  const links = [];
  for (const it of route.items.filter((i) => i.kind !== "neighbour")) {
    const y = rowY[it.dir];
    const [x0, x1] = [x(it.sender), x(it.hearer)];
    if (!it.ghost) {
      const lane = laneGeometry(x0, y, x1, y, size, size, 0);
      links.push({ ...it, lane, pill: lane ? pillOn(lane, it.text, size, measure) : null });
      continue;
    }
    const sign = it.dir === "there" ? -1 : 1;
    const [y0, cy] = [y + (sign * size) / 2, y + sign * (size / 2 + 44)];
    const curve = { x0: x0, y0, cx: (x0 + x1) / 2, cy, x1, y1: y0 };
    const { w, h } = pillSize(measure(it.text));
    links.push({ ...it, curve, pill: { x: quad(x0, curve.cx, x1, 0.5), y: quad(y0, cy, y0, 0.5), w, h, text: it.text } });
  }
  return { stations, links, verticals, size, rows: rowY };
}

/** The Mesh drawing: the devices of the items at the map's positions (positionOf(id) -> { x, y } or null, any scale)
 *  fitted into width x height; one without a position goes on a ring around the middle. Each direction is a lane
 *  offset to the right of its travel, as on the main map, so the two directions of a pair never overlap; ghosts are the
 *  same lanes dashed. Returns { stations: [{ id, x, y, ghost }], links, size }. */
export function meshLayout({ route, positionOf, width, height, measure, size = SYMBOL_SIZE }) {
  const ids = [];
  const addId = (id) => { if (!ids.includes(id)) ids.push(id); };
  for (const dir of ["there", "back"]) route.ids[dir].forEach(addId);
  for (const it of route.items) { addId(it.sender); addId(it.hearer); }
  const known = ids.map((id) => [id, positionOf(id)]).filter(([, p]) => p && Number.isFinite(p.x) && Number.isFinite(p.y));
  const margin = size + 20;
  const xs = known.map(([, p]) => p.x);
  const ys = known.map(([, p]) => p.y);
  const spanX = Math.max(...xs) - Math.min(...xs) || 1;
  const spanY = Math.max(...ys) - Math.min(...ys) || 1;
  const k = known.length > 1 ? Math.min((width - 2 * margin) / spanX, (height - 2 * margin) / spanY) : 1;
  const [cx, cy] = [(Math.max(...xs) + Math.min(...xs)) / 2, (Math.max(...ys) + Math.min(...ys)) / 2];
  const at = new Map(known.map(([id, p]) => [id, { x: width / 2 + (p.x - cx) * k, y: height / 2 + (p.y - cy) * k }]));
  const lost = ids.filter((id) => !at.has(id));
  lost.forEach((id, i) => {
    const angle = (2 * Math.PI * i) / lost.length;
    at.set(id, { x: width / 2 + Math.cos(angle) * (width / 2 - margin), y: height / 2 + Math.sin(angle) * (height / 2 - margin) });
  });
  const onRoute = new Set(route.items.filter((i) => !i.ghost && i.kind === "route").flatMap((i) => [i.sender, i.hearer]));
  const stations = ids.map((id) => ({ id, ...at.get(id), ghost: !onRoute.has(id) && !route.ids.there.includes(id) && !route.ids.back.includes(id) }));
  const offset = Math.max(LANE_OFFSET + 1, (size / SYMBOL_SIZE) * (LANE_OFFSET + 1));
  const links = route.items.map((it) => {
    const [s, h] = [at.get(it.sender), at.get(it.hearer)];
    const lane = laneGeometry(s.x, s.y, h.x, h.y, size, size, offset);
    return { ...it, lane, pill: lane ? pillOn(lane, it.text, size, measure) : null };
  });
  return { stations, links, size };
}

/** Index of the record nearest to time t (seconds) among points [{ t }], or -1 without any. */
export function nearestIndex(points, t) {
  let best = -1;
  points.forEach((p, i) => { if (best < 0 || Math.abs(p.t - t) < Math.abs(points[best].t - t)) best = i; });
  return best;
}
