// SPDX-License-Identifier: MIT
// The path history window's models without a DOM (spec 9.5): the loader and its states, the ranges "Keep for" allows,
// the route a record shows (weakest hop, ghosts of earlier routes without a date), Metro-Map columns and Mesh lanes,
// the timeline bands, the lane chart's regions, sparklines, the Thread pill text. Uses the committed samples. npm test
import test from "node:test";
import assert from "node:assert/strict";
import { createLoader, rangesFor } from "../custom_components/meshroute_topology_explorer/frontend/ui/history-loader.js";
import { columnOrder, metroLayout, meshLayout, nearestIndex, routeAt } from "../custom_components/meshroute_topology_explorer/frontend/ui/history-route.js";
import { directionModel, placeNotes } from "../custom_components/meshroute_topology_explorer/frontend/ui/history-timeline.js";
import { laneModel } from "../custom_components/meshroute_topology_explorer/frontend/ui/history-lane.js";
import { sparkModel } from "../custom_components/meshroute_topology_explorer/frontend/ui/history-sparkline.js";
import { sliderModel } from "../custom_components/meshroute_topology_explorer/frontend/ui/history-route-view.js";
import { dayText, linePath, scale, tickText, timeText } from "../custom_components/meshroute_topology_explorer/frontend/ui/history-chart.js";
import { ENGINES, historyCaps, historyFor, pairHops } from "../custom_components/meshroute_topology_explorer/frontend/engines/index.js";
import { entryText } from "../custom_components/meshroute_topology_explorer/frontend/engines/thread/history.js";
import { translator } from "../custom_components/meshroute_topology_explorer/frontend/ui/i18n.js";
import { callWsFor, sampleHistory } from "./history-ui-fixture.mjs";

const t = translator("en");
const { network, response, last } = sampleHistory();
const caps = historyCaps(network);
const history = historyFor(network, response);
const ids = network.devices.map((d) => d.id);
const coordinator = network.devices.find((d) => d.role === "coordinator").id;
const measure = (s) => s.length * 6;

/** A pair whose route changes inside the sample, with the index of its last record. */
function changing() {
  for (const a of ids) for (const b of ids) {
    if (a >= b) continue;
    const tl = history.timeline(a, b);
    if (tl.spans.length > 1 && tl.spans.at(-1).there.complete && tl.spans.at(-1).back.complete) return tl;
  }
  throw new Error("the sample has no pair with a changing route");
}

test("ranges: only what Keep for holds, at least 48 h, all while unknown", () => {
  assert.deepEqual(rangesFor(90), ["48h", "7d", "30d", "90d"]);
  assert.deepEqual(rangesFor(30), ["48h", "7d", "30d"]);
  assert.deepEqual(rangesFor(7), ["48h", "7d"]);
  assert.deepEqual(rangesFor(1), ["48h"]);
  assert.deepEqual(rangesFor(null), ["48h", "7d", "30d", "90d"]);
});

test("loader: states ok, sparse, empty, off, unsupported, failed; one read per range; info fields as the integration names them", async () => {
  const info = { record: true, keep_days: 30, last_error: null };
  const make = (extra = {}, now = last + 3600) => {
    const { callWS, calls } = callWsFor(response, { ...info, ...extra });
    return { calls, loader: createLoader({ callWS, network: () => network, now: () => now }) };
  };
  const ok = make();
  assert.equal((await ok.loader.get("7d")).state, "ok");
  assert.deepEqual(await ok.loader.info(), { record: true, keepDays: 30, lastError: null });
  await ok.loader.get("7d");
  assert.equal(ok.calls.filter((c) => c.type.endsWith("/history/records")).length, 1, "cached per range");
  await ok.loader.get("30d");
  assert.equal(ok.calls.filter((c) => c.type.endsWith("/history/records")).length, 2);
  ok.loader.clear();
  await ok.loader.get("7d");
  assert.equal(ok.calls.filter((c) => c.type.endsWith("/history/records")).length, 3, "clear() reads again");
  assert.equal((await make().loader.get("48h")).state, "sparse", "48 h hold fewer than 3 records");
  assert.equal((await make({}, last + 400 * 86400).loader.get("48h")).state, "empty");
  assert.equal((await make({ record: false }, last + 400 * 86400).loader.get("48h")).state, "off");
  const bad = await make({ last_error: "zha/devices: no handler" }, last + 400 * 86400).loader.get("48h");
  assert.equal(bad.state, "unsupported");
  assert.equal(bad.info.lastError, "zha/devices: no handler");
  const failed = await createLoader({ callWS: async () => { throw { code: "unauthorized", message: "no admin" }; }, network: () => network }).get("48h");
  assert.deepEqual([failed.state, failed.error], ["failed", "no admin"]);
});

test("route: the weakest hop is marked once per direction, by rank; ghosts are earlier routes only and carry no date", () => {
  const tl = changing();
  const second = tl.spans.at(-1);
  const now = routeAt({ caps, tl, index: second.firstIndex, t });
  for (const dir of ["there", "back"]) {
    const hops = now.items.filter((i) => i.dir === dir && !i.ghost);
    const walk = tl.points[second.firstIndex][dir];
    assert.deepEqual(hops.map((h) => h.weakest), walk.hops.map((_, i) => walk.weakest === i));
  }
  const ghosts = now.items.filter((i) => i.ghost);
  assert.ok(ghosts.length > 0, "the earlier route leaves ghosts");
  for (const g of ghosts) {
    assert.ok(g.pointIndex < second.firstIndex, "from a record before the shown one");
    assert.ok(!("t" in g) && !("time" in g) && !/\d{1,2}:\d{2}|Nov|Oct/.test(g.text), "no date on a ghost");
  }
  const first = routeAt({ caps, tl, index: 0, t });
  assert.equal(first.items.filter((i) => i.ghost).length, 0, "nothing earlier than the first record");
});

test("route: a stopped walk is a hop list as far as it went; an unknown pair gives no hops, never invented ones", () => {
  const ghostId = "aa:bb:cc:dd:ee:ff:00:11";
  const tl = history.timeline(coordinator, ghostId);
  const r = routeAt({ caps, tl, index: 0, t });
  assert.deepEqual(r.items, []);
  assert.deepEqual(r.ids.there, [coordinator]);
});

test("Metro-Map: shared stations share a column, a station only the way back uses sits between its neighbours", () => {
  assert.deepEqual(columnOrder([["C", "S", "G", "F", "H"], ["C", "A", "F", "H"]]), ["C", "S", "A", "G", "F", "H"]);
  assert.deepEqual(columnOrder([["a", "b"], ["c", "a"]]), ["c", "a", "b"], "a node before the first shared one goes in front");
  const route = { ids: { there: ["C", "S", "G", "F", "H"], back: ["H", "F", "A", "C"] }, items: [
    ...[["C", "S"], ["S", "G"], ["G", "F"], ["F", "H"]].map(([s, h], i) => ({ kind: "route", dir: "there", hopIndex: i, sender: s, hearer: h, text: "100", weakest: i === 1, ghost: false, pointIndex: 0 })),
    ...[["H", "F"], ["F", "A"], ["A", "C"]].map(([s, h], i) => ({ kind: "route", dir: "back", hopIndex: i, sender: s, hearer: h, text: "90", weakest: false, ghost: false, pointIndex: 0 })),
    { kind: "ghost", dir: "back", hopIndex: 0, sender: "F", hearer: "C", text: "22", weakest: false, ghost: true, pointIndex: 0 }] };
  const m = metroLayout({ route, width: 800, height: 250, measure });
  const x = (id, dir) => m.stations.find((s) => s.id === id && s.dir === dir).x;
  for (const id of ["C", "F", "H"]) assert.equal(x(id, "there"), x(id, "back"), `${id} shares its column`);
  assert.ok(x("S", "there") < x("A", "back") && x("A", "back") < x("G", "there"));
  assert.deepEqual(m.verticals.map((v) => v.id).sort(), ["C", "F", "H"]);
  assert.ok(m.stations.find((s) => s.id === "A").y > m.stations.find((s) => s.id === "S").y, "there above, back below");
  const weakest = m.links.filter((l) => l.weakest);
  assert.equal(weakest.length, 1);
  assert.equal(weakest[0].sender, "S");
  const ghost = m.links.find((l) => l.ghost);
  assert.ok(ghost.curve && ghost.pill.text === "22", "a ghost is an arc with its last value");
  const pill = m.links.find((l) => l.sender === "H" && l.hearer === "F");
  const [lo, hi] = [Math.min(pill.lane.x0, pill.lane.x1), Math.max(pill.lane.x0, pill.lane.x1)];
  assert.ok(pill.pill.x > lo && pill.pill.x < hi, "the pill sits in its lane");
  assert.ok(Math.abs(pill.pill.x - pill.lane.x1) <= Math.max(pill.lane.len * 0.25, 4 * 32) + 1e-6, "near the arrowhead, as on the map (M30)");
  assert.ok(pill.lane.x1 < pill.lane.x0, "the way back runs right to left");
});

test("Mesh: each direction is offset to its own right side, so the two directions of a pair never overlap", () => {
  const route = { ids: { there: ["a", "b"], back: ["b", "a"] }, items: [
    { kind: "route", dir: "there", hopIndex: 0, sender: "a", hearer: "b", text: "100", weakest: false, ghost: false, pointIndex: 0 },
    { kind: "route", dir: "back", hopIndex: 0, sender: "b", hearer: "a", text: "90", weakest: false, ghost: false, pointIndex: 0 }] };
  const m = meshLayout({ route, positionOf: (id) => ({ a: { x: 0, y: 0 }, b: { x: 10, y: 0 } })[id], width: 600, height: 300, measure });
  const [there, back] = m.links;
  assert.ok(there.lane.y0 > m.stations[0].y, "travelling right, the lane is on the right-hand side: below (y points down)");
  assert.ok(back.lane.y0 < m.stations[0].y, "travelling left, above");
  assert.ok(Math.abs(there.lane.y0 - back.lane.y0) >= 6);
  const lost = meshLayout({ route, positionOf: () => null, width: 600, height: 300, measure });
  assert.equal(lost.stations.length, 2, "a device without a position is still drawn");
});

test("timeline bands: per direction, one band per run of the same hop list of THAT direction, always labelled; the weakest hop named at each band's start", () => {
  const labelOf = (id) => (network.devices.find((d) => d.id === id) || { label: id }).label;
  const tl = changing();
  for (const dir of ["there", "back"]) {
    const m = directionModel({ tl, dir, labelOf, t, locale: "en", zone: "UTC" });
    const sig = (p) => p[dir].ids.join(">") + (p[dir].complete ? "" : `!${p[dir].reason}`);
    const runs = tl.points.filter((p, i) => i === 0 || sig(p) !== sig(tl.points[i - 1]));
    assert.equal(m.bands.length, runs.length, `${dir}: bands follow this direction's own changes`);
    m.bands.forEach((b, i) => {
      const w = runs[i][dir];
      assert.ok(b.full.length > 0, "every band has a label");
      assert.equal(b.gap, !w.complete);
      if (w.complete && w.ids.length > 2) assert.equal(b.full, `via ${w.ids.slice(1, -1).map(labelOf).join(", ")}`);
      if (w.complete && w.ids.length === 2) assert.equal(b.full, "direct");
      assert.equal(b.from, runs[i].t);
      const start = tl.points.findIndex((p) => p.t === runs[i].t);
      if (w.weakest !== null && w.weakest !== undefined) assert.ok(m.notes.some((n) => n.t === tl.points[start].t), "the weakest hop is named at the band's first record");
    });
    assert.equal(m.series.length, tl.points.length);
    tl.points.forEach((p, i) => assert.equal(m.series[i][1], p[dir].weakest === null ? null : p[dir].hops[p[dir].weakest].rankPct, "rank of the weakest hop, never raw LQI"));
  }
  // A change of the way back must not split the way there.
  const there = { complete: true, ids: ["a", "x", "b"], hops: [], weakest: null };
  const fake = { points: [{ t: 10, there, back: { complete: true, ids: ["b", "a"], hops: [], weakest: null } },
    { t: 20, there, back: { complete: true, ids: ["b", "y", "a"], hops: [], weakest: null } }] };
  assert.equal(directionModel({ tl: fake, dir: "there", labelOf: (i) => i, t, locale: "en" }).bands.length, 1);
  assert.equal(directionModel({ tl: fake, dir: "back", labelOf: (i) => i, t, locale: "en" }).bands.length, 2);
  const stopped = directionModel({ tl: { points: [{ t: 1, there: { complete: false, reason: "table not read", ids: ["a"], hops: [], weakest: null } }] },
    dir: "there", labelOf, t, locale: "en" });
  assert.deepEqual([stopped.bands[0].gap, stopped.bands[0].full], [true, "no route: table not read"]);
});

test("one time format: the annotation of a point and the axis use the same local time text", () => {
  const labelOf = (id) => id;
  const hop = { sender: "s", hearer: "h", lqi: 99, rankPct: 40 };
  const tl = { points: [{ t: 1762041600 + 3600, there: { complete: true, ids: ["s", "h"], hops: [hop], weakest: 0 }, back: {} }] };
  const m = directionModel({ tl, dir: "there", labelOf, t, locale: "en", zone: "UTC" });
  assert.equal(m.notes[0].text, `${timeText(1762041600 + 3600, "en", "UTC")}: s → h, 99, rank 40 %`);
  assert.equal(tickText({ t: 1762041600, day: true }, "en", "UTC"), "Nov 2");
  assert.equal(tickText({ t: 1762041600 + 12 * 3600, day: false }, "en", "UTC"), "12:00", "a 12 h tick is a time, never the date");
});

test("Mesh: pills and labels do not cover each other or a symbol where a place is free", () => {
  const items = [["c", "s"], ["s", "g"], ["g", "f"], ["f", "h"]].map(([s, h], i) => ({ kind: "route", dir: "there", hopIndex: i, sender: s, hearer: h, text: i === 3 ? "Parent" : "1" + i + "0", weakest: false, ghost: false, pointIndex: 0 }))
    .concat([["h", "f"], ["f", "a"], ["a", "c"]].map(([s, h], i) => ({ kind: "route", dir: "back", hopIndex: i, sender: s, hearer: h, text: "10" + i, weakest: false, ghost: false, pointIndex: 0 })));
  const route = { ids: { there: ["c", "s", "g", "f", "h"], back: ["h", "f", "a", "c"] }, items };
  const pos = { c: [0, 0], s: [3, -4], g: [6, -9], f: [9, -5], h: [14, -2], a: [4, 3] };
  const m = meshLayout({ route, positionOf: (id) => ({ x: pos[id][0], y: pos[id][1] }), width: 840, height: 480, measure, labelOf: (id) => `Device ${id}` });
  const rect = (x, y, w, h) => ({ x: x - w / 2, y: y - h / 2, w, h });
  const hit = (p, q) => p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h;
  const pills = m.links.map((l) => rect(l.pill.x, l.pill.y, l.pill.w, l.pill.h));
  const symbols = m.stations.map((s) => rect(s.x, s.y, m.size, m.size));
  const labels = m.stations.map((s) => rect(s.label.x, s.label.y, s.label.w, s.label.h));
  for (let i = 0; i < pills.length; i++) {
    for (let j = i + 1; j < pills.length; j++) assert.ok(!hit(pills[i], pills[j]), `pills ${i} and ${j}`);
    symbols.forEach((s, j) => assert.ok(!hit(pills[i], s), `pill ${i} over symbol ${j}`));
  }
  labels.forEach((l, i) => { symbols.forEach((s, j) => assert.ok(!hit(l, s), `label ${i} over symbol ${j}`)); pills.forEach((p, j) => assert.ok(!hit(l, p), `label ${i} over pill ${j}`)); });
  const xs = m.stations.map((s) => s.x);
  const ys = m.stations.map((s) => s.y);
  assert.ok(Math.max(...xs) - Math.min(...xs) > 500 || Math.max(...ys) - Math.min(...ys) > 250, "the route fills the free area");
  assert.ok(Math.min(...xs) > 0 && Math.max(...xs) < 840 && Math.min(...ys) > 0 && Math.max(...ys) < 480, "padding all round");
});

test("lane chart regions: after now, before the first record, before the lane existed", () => {
  const base = { a: "x", b: "y", from: 100, to: 500, aHearsB: [[200, 10], [300, null]], bHearsA: [[200, 20], [300, 21]], firstSeen: { aHearsB: 200, bHearsA: 200 }, context: null };
  const kinds = (m) => m.regions.map((r) => r.kind);
  assert.deepEqual(kinds(laneModel({ lane: base, now: 400, firstRecord: 150 })), ["after_now", "none", "not_used"]);
  const m = laneModel({ lane: base, now: 400, firstRecord: 150 });
  assert.deepEqual(m.regions.map((r) => [r.from, r.to]), [[400, 500], [100, 150], [150, 200]]);
  assert.deepEqual(m.orange, [[200, 10], [300, null]], "a record without the entry is a gap, not a zero");
  assert.deepEqual(kinds(laneModel({ lane: { ...base, firstSeen: { aHearsB: null, bHearsA: null } }, now: 600, firstRecord: 100 })), ["not_used"], "never used: all of it");
  const thread = laneModel({ lane: { ...base, aHearsB: [[200, 1, -75]], bHearsA: [[200, 2, -81]] }, now: 600, firstRecord: 100 });
  assert.ok(thread.hasRssi);
  assert.deepEqual(thread.blueRssi, [[200, -81]]);
  assert.equal(laneModel({ lane: base, now: 600, firstRecord: 100 }).hasRssi, false);
});

test("Thread pill: RSSI over LQI, both written out; no RSSI leaves its line out; the engine has no walk", () => {
  assert.equal(entryText([3, -75]), "−75 dBm\nLQI 3");
  assert.equal(entryText([2, null]), "LQI 2");
  assert.equal(entryText(null), "?");
  assert.deepEqual([ENGINES.thread.history.walks, ENGINES.thread.history.lqiMax, ENGINES.zigbee.history.walks, ENGINES.zigbee.history.lqiMax], [false, 3, true, 255]);
  const tl = { a: "a", b: "b", points: [{ t: 1, index: 0, aHearsB: [3, -75], bHearsA: [2, -81] }], spans: [] };
  const table = { e: [["a", "b", 3, -75], ["b", "a", 2, -81], ["a", "n", 1, -90], ["n", "b", 2, null], ["x", "y", 1, null]], r: [], l: [] };
  const r = routeAt({ caps: { walks: false, entryText }, tl, index: 0, t, table });
  assert.deepEqual(r.items.filter((i) => i.kind === "route").map((i) => [i.dir, i.sender, i.hearer, i.text]),
    [["there", "a", "b", "−81 dBm\nLQI 2"], ["back", "b", "a", "−75 dBm\nLQI 3"]]);
  assert.deepEqual(r.items.filter((i) => i.kind === "neighbour").map((i) => `${i.sender}>${i.hearer}`).sort(), ["b>n", "n>a"],
    "neighbours of either device in that record; a row between two strangers is no neighbour");
});

test("pairHops: hop counts of the live network for the badge tooltip, none without a routing table", () => {
  const other = ids.find((i) => i !== coordinator);
  const hops = pairHops(network, coordinator, other);
  assert.ok(Number.isInteger(hops.there) && Number.isInteger(hops.back));
  assert.equal(pairHops({ ...network, engine: "thread" }, coordinator, other), null);
});

test("slider and sparkline models, time helpers", () => {
  const points = [{ t: 100 }, { t: 200 }, { t: 900 }];
  assert.equal(nearestIndex(points, 190), 1);
  assert.equal(nearestIndex(points, 5000), 2);
  assert.equal(nearestIndex([], 1), -1);
  const s = sliderModel({ points, from: 0, to: 1000, width: 520, locale: "en" });
  assert.deepEqual(s.ticks.map((k) => k.index), [0, 1, 2]);
  assert.ok(s.ticks[0].x < s.ticks[1].x && s.ticks[1].x < s.ticks[2].x);
  assert.equal(sparkModel([[1, null]]), null);
  const sp = sparkModel([[1, 10], [2, null], [3, 30], [4, 20]]);
  assert.deepEqual([sp.min, sp.max, sp.n], [10, 30, 3]);
  assert.ok(sp.path.startsWith("M") && sp.path.includes("L"), "three values: a line");
  assert.equal(sparkModel([[1, 10], [2, 12]]).path, "", "fewer than 3 values: points only");
  assert.equal(linePath([[0, 1], [1, null], [2, 3]], scale([0, 2], [0, 100]), scale([0, 4], [40, 0])), "M0 30M100 10", "a gap breaks the line");
  assert.match(timeText(1762041600, "en", "UTC"), /Nov 2,? 00:00/);
  assert.equal(dayText(1762041600, "en", "UTC"), "Nov 2");
});

test("timeline: weakest-hop labels never overlap each other or leave the plot, however dense the series", () => {
  const x = scale([0, 1000], [34, 592]);
  const y = scale([0, 100], [92, 6]);
  // 40 changes of the weakest hop on a 600 px chart: far more text than room.
  const notes = Array.from({ length: 40 }, (_, i) => ({ t: i * 25, pct: (i * 37) % 101, text: `Nov ${i}, 01:00: Router ${i} \u2192 Router ${i + 1}, ${100 + i}, rank ${i} %` }));
  const placed = placeNotes(notes, { x, y, left: 34, right: 592 });
  assert.ok(placed.length > 0 && placed.length < notes.length, "some placed, the rest left to the hover title");
  for (const [i, a] of placed.entries()) {
    assert.ok(a.x0 >= 34 && a.x1 <= 592 && a.y0 >= 1 && a.y1 <= 99, `inside the plot: ${a.text}`);
    for (const b of placed.slice(i + 1)) assert.ok(a.x1 <= b.x0 || b.x1 <= a.x0 || a.y1 <= b.y0 || b.y1 <= a.y0, `${a.text} / ${b.text}`);
  }
  assert.equal(placeNotes([notes[0]], { x, y, left: 34, right: 592 }).length, 1, "a lone label is placed");
});
