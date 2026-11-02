// SPDX-License-Identifier: MIT
// The view "routing table" of "Communication paths" (spec 5.1, 7.1, 9.1, 9.2, 11; feedback
// contribution 5): the walks of a device's own usable
// routing entries, hop by hop through every holder's entry for the same destination, the optional return routes, the
// overview of every usable entry, the heard option on top, and the Details card. Run: npm test
import test from "node:test";
import assert from "node:assert/strict";
import { nodePaths } from "../custom_components/meshroute_topology_explorer/frontend/engines/zigbee/node-paths.js";
import { tableWalk, usableRoutes } from "../custom_components/meshroute_topology_explorer/frontend/engines/zigbee/paths.js";
import { buildScene, drawScene } from "../custom_components/meshroute_topology_explorer/frontend/graph/renderer.js";
import { sceneTableLanes, scenePaths } from "../custom_components/meshroute_topology_explorer/frontend/engines/zigbee/scene.js";
import { resolveTheme } from "../custom_components/meshroute_topology_explorer/frontend/graph/palette.js";
import { detailsOf } from "../custom_components/meshroute_topology_explorer/frontend/engines/zigbee/ui/details.js";
import { sanitizeSettings as shellSettings } from "../custom_components/meshroute_topology_explorer/frontend/ui/settings.js";
import { settings as zigbeeSettings } from "../custom_components/meshroute_topology_explorer/frontend/engines/zigbee/settings.js";
import { asZigbee, recordingContext, labelWidth } from "./graph-fakes.mjs";
import { sampleNetwork } from "./panel-fixture.mjs";

/** The shell's sanitizer with the Zigbee engine's keys (engines cut step 5). */
const sanitizeSettings = (stored) => shellSettings(stored, zigbeeSettings);

const theme = resolveTheme({});
const m = (lqi, rating) => ({ state: "measured", lqi, rating, source: "table", reason: null });
const none = { state: "unknown", lqi: null, rating: null, source: null, reason: { code: "table_space" } };
const route = (owner, destination, nextHop, status = "Active") => ({ owner, destination, nextHop, status, stale: false });
const router = (id) => ({ id, role: "router", label: id.toUpperCase(), available: true, hasTable: true, children: [] });

// The acceptance example: A holds four usable entries, to C (via B), D (direct), the end device E (via
// its parent D) and the coordinator Z, and one inactive entry (to F) that is no destination. Back: C names F for A and
// F names A (a return route over another router than the way out); D's entry for A is inactive (a gap, and E's way
// back runs into it through its parent); Z names B and B names A. A measures H1-H4 and C, none of them on a walk.
const NET = asZigbee({
  devices: [
    { id: "z", role: "coordinator", label: "Coordinator", available: true, hasTable: true, children: [] },
    router("a"), router("b"), router("c"), router("d"), router("f"), router("h1"), router("h2"), router("h3"), router("h4"),
    { id: "e", role: "end device", label: "E", available: true, hasTable: false, parent: "d", children: [] },
  ],
  readings: [],
  routes: [
    route("a", "c", "b"), route("a", "d", "d"), route("a", "e", "d"), route("a", "z", "z"), route("a", "f", "f", "Inactive"),
    route("b", "c", "c"), route("b", "a", "a"), route("c", "a", "f"), route("f", "a", "a"), route("d", "a", "a", "Inactive"),
    route("z", "a", "b"),
  ],
  pairs: [
    { a: "a", b: "b", ab: m(200, 0.9), ba: m(190, 0.9) },
    { a: "b", b: "c", ab: m(150, 0.7), ba: m(140, 0.7) },
    { a: "a", b: "d", ab: m(120, 0.6), ba: m(110, 0.5) },
    { a: "d", b: "e", ab: m(90, 0.5), ba: { state: "implied", lqi: null, rating: null, source: "parent", reason: null } },
    { a: "a", b: "z", ab: m(210, 0.95), ba: m(200, 0.9) },
    { a: "c", b: "f", ab: m(130, 0.6), ba: m(120, 0.6) },
    { a: "a", b: "f", ab: m(100, 0.5), ba: m(100, 0.5) },
    { a: "b", b: "z", ab: m(180, 0.8), ba: m(170, 0.8) },
    { a: "a", b: "c", ab: m(30, 0.1), ba: none },
    { a: "a", b: "h1", ab: m(180, 0.95), ba: none },
    { a: "a", b: "h2", ab: m(170, 0.85), ba: m(160, 0.8) },
    { a: "a", b: "h3", ab: m(160, 0.75), ba: none },
    { a: "a", b: "h4", ab: m(150, 0.65), ba: none },
  ],
});
const ids = (paths, kind) => paths.filter((p) => p.kind === kind).map((p) => p.ids.join(">"));

test("table walks: the device's own usable entries, each followed by every holder's entry for the same destination", () => {
  const out = nodePaths(NET, "a", "table");
  assert.ok(out.every((p) => p.kind === "out"), "no up or down paths: the view has its own basis");
  assert.deepEqual(ids(out, "out"), ["a>b>c", "a>d", "a>d>e", "a>z"], "four destinations; the inactive entry is none");
  assert.ok(out.every((p) => p.complete));
  assert.deepEqual(out.find((p) => p.to === "e").hops.map((h) => h.how), ["table", "child"], "the parent delivers");
  assert.deepEqual(out.find((p) => p.to === "c").hops.map((h) => h.how), ["table", "table"], "B's own entry for C");
});

test("return routes: walked back from each destination by every hop's entry for the device; gaps stay gaps", () => {
  const paths = nodePaths(NET, "a", "table", { returns: true });
  const back = Object.fromEntries(paths.filter((p) => p.kind === "in").map((p) => [p.from, p]));
  assert.deepEqual(Object.keys(back), ["c", "d", "e", "z"], "the same destinations, no more");
  assert.deepEqual(back.c.ids, ["c", "f", "a"], "over another router than the way out, from the tables");
  assert.ok(back.c.complete);
  assert.deepEqual(back.z.ids, ["z", "b", "a"]);
  // D's entry for A is inactive: the walk stops at D, nothing is guessed (no reversed way out, no discovery).
  assert.deepEqual([back.d.ids, back.d.complete, back.d.reason], [["d"], false, "entry inactive"]);
  assert.deepEqual([back.e.ids, back.e.complete, back.e.reason], [["e", "d"], false, "entry inactive"]);
  assert.deepEqual(back.e.hops.map((h) => h.how), ["parent"], "an end device sends to its parent: protocol, no guess");
  const hows = new Set(paths.flatMap((p) => p.hops.map((h) => h.how)));
  assert.deepEqual([...hows].sort(), ["child", "parent", "table"], "never neighbour or discovery");
  assert.ok(paths.every((p) => !p.assumed && !p.recorded), "no source route in this view");
});

test("the checkboxes never widen the destination set: return routes and heard partners add lines, not destinations", () => {
  const scene = buildScene(NET, labelWidth);
  const a = scene.index.get("a");
  const goals = (r) => new Set(r.paths.map((p) => (p.kind === "out" ? p.to : p.from)));
  const plain = scenePaths(scene, a, "table");
  const back = scenePaths(scene, a, "table", "off", false, true);
  const heard = scenePaths(scene, a, "table", "off", true, true);
  assert.deepEqual([...goals(plain)].sort(), ["c", "d", "e", "z"]);
  assert.deepEqual([...goals(back)].sort(), ["c", "d", "e", "z"]);
  assert.deepEqual([...goals(heard)].sort(), ["c", "d", "e", "z"]);
  assert.ok([...plain.hops.values()].every((h) => h.cls === "route"), "every walk hop is drawn as a route");
  // The gaps stay visible: a stem at D towards A for D and for E.
  assert.deepEqual(back.ends.map((e) => `${scene.nodes[e.at].id}>${scene.nodes[e.toward].id}`), ["d>a"]);
  // Heard: the 3 best partners with a reading and no lane drawn between the two, as measurement lines only.
  const extra = [...heard.hops.values()].filter((h) => h.cls === "heard");
  const partners = new Set(extra.map((h) => scene.nodes[h.s === a ? h.h : h.s].id));
  assert.deepEqual([...partners].sort(), ["h1", "h2", "h3"]);
  for (const [key, hop] of back.hops) assert.deepEqual(heard.hops.get(key), hop, `walk hop ${key} unchanged`);
  // The option without return routes: the same partners; A -> B -> C's lanes are walks, not partners.
  const heardOnly = scenePaths(scene, a, "table", "off", true, false);
  assert.ok(![...heardOnly.hops.values()].some((h) => h.cls === "heard" && [h.s, h.h].includes(scene.index.get("b"))));
});

test("overview of the routing table: the lane of every usable entry, as a route, and nothing else", () => {
  const scene = buildScene(NET, labelWidth);
  const usable = usableRoutes(scene.pathNet);
  assert.equal(usable.length, 9, "11 entries less the two inactive ones");
  const { count } = sceneTableLanes(scene);
  // a>b (a's entry for c), a>d (d, e), a>z, b>c, b>a, c>f, f>a, z>b
  assert.equal(count, 8);
  const ctx = recordingContext({ props: true });
  const pos = { x: scene.nodes.map((_, i) => 300 * Math.cos(i)), y: scene.nodes.map((_, i) => 300 * Math.sin(i)),
    pinned: scene.nodes.map(() => 0), mesh: scene.nodes.map(() => 1) };
  const stats = drawScene(ctx, scene, pos, { cam: { k: 1, cx: 0, cy: 0 }, width: 1400, height: 1000, dpr: 1, labelZoom: 1,
    debug: false, selected: -1, hovered: -1, fps: null, fill: "none", sourceRoute: "assume", paths: "table" }, theme, labelWidth);
  assert.deepEqual([stats.classes.route, stats.classes.up, stats.classes.down, stats.classes.heard], [8, 0, 0, 0]);
});

test("the sample: Router 13's table walks, the gaps of its return routes, the overview's lane count (spec 12)", () => {
  const n = sampleNetwork();
  const label = new Map(n.devices.map((d) => [d.id, d.label]));
  const id = n.devices.find((d) => d.label === "Router 13").id;
  const paths = nodePaths(n, id, "table", { returns: true });
  const line = (p) => `${p.ids.map((x) => label.get(x)).join(" > ")}${p.complete ? "" : ` | ${p.reason}`}`;
  assert.deepEqual(paths.filter((p) => p.kind === "out").map(line), ["Router 13 > Coordinator", "Router 13 > Router 14",
    "Router 13 > Router 17 > Router 24", "Router 13 > Router 26", "Router 13 > Router 17 > End device 06"]);
  assert.deepEqual(paths.filter((p) => p.kind === "in").map(line), ["Coordinator > Router 13", "Router 14 | no entry",
    "Router 24 | no entry", "Router 26 | no entry", "End device 06 > Router 17 | no entry"]);
  assert.equal(tableWalk(n, id, id).complete, true);
  const scene = buildScene(n, labelWidth);
  // 129 entries, 127 usable, 101 distinct owner -> next hop; 99 of them have a lane (2 lead to an unavailable device).
  assert.equal(usableRoutes(n).length, 127);
  assert.equal(sceneTableLanes(scene).count, 99);
  // An end device keeps no routing table; the coordinator's view holds its own entries and their ways back.
  const ed = n.devices.find((d) => d.label === "End device 06").id;
  assert.deepEqual(nodePaths(n, ed, "table", { returns: true }), []);
  const c = n.devices.find((d) => d.role === "coordinator").id;
  const trees = nodePaths(n, c, "table", { returns: true });
  assert.deepEqual([trees.filter((p) => p.kind === "out").length, trees.filter((p) => p.kind === "in" && p.complete).length],
    [30, 30]);
});

test("Details: the routing-table card's rows, the return walks only with the checkbox, and why a device has none", () => {
  const net = { ...NET, findings: [] };
  const info = detailsOf(net, "a", "table", { returnRoutes: false });
  // By name: C, Coordinator, D, E.
  assert.deepEqual(info.table.rows.map((r) => [r.id, Boolean(r.out), r.in]), [["c", true, null], ["z", true, null],
    ["d", true, null], ["e", true, null]]);
  assert.ok(info.paths.every((p) => p.kind === "up" || p.kind === "down"), "the card with the coordinator stays");
  const back = detailsOf(net, "a", "table", { returnRoutes: true });
  assert.deepEqual(back.table.rows.map((r) => [r.id, r.in.complete]), [["c", true], ["z", true], ["d", false], ["e", false]]);
  assert.equal(detailsOf(net, "e", "table").table.none, "end device");
  assert.equal(detailsOf(net, "h1", "table").table.none, "no entries");
  assert.equal(detailsOf(net, "a", "coordinator").table, null, "only in the view routing table");
});

test("settings: the view 'table' and 'include return routes' are stored and bad values fall back", () => {
  assert.equal(sanitizeSettings({ paths: "table" }).paths, "table");
  assert.equal(sanitizeSettings({}).returnRoutes, false);
  assert.equal(sanitizeSettings({ returnRoutes: "yes" }).returnRoutes, false);
  assert.equal(sanitizeSettings({ paths: "table", returnRoutes: true }).returnRoutes, true);
});
