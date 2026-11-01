// SPDX-License-Identifier: MIT
// "Communication paths" (decision by Fabian Schwamborn, 2026-11-01; boards M2, M11; spec 7.1, 9.1, 11): classes per
// direction (the way back of an up hop is not up; down measured or assumed; routes between devices; heard only), what
// each stage draws in the overview, on click and on hover, debug mode drawing every lane, the layout never moving, and
// the stored setting with its migration from the class switches and the node view.
// node --test "tests/**/*.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PATHS, PATH_STAGES, pathStage } from "../custom_components/meshroute_topology_explorer/frontend/graph/links.js";
import { buildScene, drawScene, sceneClasses, scenePaths } from "../custom_components/meshroute_topology_explorer/frontend/graph/renderer.js";
import { GraphView } from "../custom_components/meshroute_topology_explorer/frontend/graph/graph-view.js";
import { resolveTheme } from "../custom_components/meshroute_topology_explorer/frontend/graph/palette.js";
import { DEFAULTS, sanitizePaths, sanitizeSettings } from "../custom_components/meshroute_topology_explorer/frontend/ui/settings.js";
import { STRINGS } from "../custom_components/meshroute_topology_explorer/frontend/ui/i18n.js";
import { FakeCanvas, fakeEnv, recordingContext, labelWidth } from "./graph-fakes.mjs";

const theme = resolveTheme({});
const m = (lqi, rating) => ({ state: "measured", lqi, rating, source: "table", reason: null });
const route = (owner, destination, nextHop) => ({ owner, destination, nextHop, status: "Active", stale: false });
// c coordinator (its table is there), routers r1-r4, end device e1 under r1.
// Up: r1 -> c, r2 -> r1 -> c, r3 -> c, r4 -> c, e1 -> r1 -> c. Down (coordinator's table): c -> r1, c -> r1 -> r2,
// c -> r4, c -> r1 -> e1 (parent link). r3 has no entry at the coordinator: its way back is assumed (c -> r3).
// A route between devices: r2 -> r4 via r1 (r2 -> r1 is also r2's way up, so it stays up; r1 -> r4 is a route).
// Heard only: r3 hears r2 (r2 does not list r3: table full), r3 and r4 hear each other.
const NET = {
  devices: [
    { id: "c", role: "coordinator", label: "Coordinator", available: true, hasTable: true },
    { id: "e1", role: "end device", label: "Sensor", available: true, parent: "r1" },
    { id: "r1", role: "router", label: "Router 1", available: true, hasTable: true },
    { id: "r2", role: "router", label: "Router 2", available: true, hasTable: true },
    { id: "r3", role: "router", label: "Router 3", available: true, hasTable: true },
    { id: "r4", role: "router", label: "Router 4", available: true, hasTable: true },
  ],
  readings: [],
  routes: [
    route("r1", "c", "c"), route("r2", "c", "r1"), route("r3", "c", "c"), route("r4", "c", "c"),
    route("c", "r1", "r1"), route("c", "r2", "r1"), route("r1", "r2", "r2"), route("c", "r4", "r4"),
    route("r2", "r4", "r1"), route("r1", "r4", "r4"),
  ],
  pairs: [
    { a: "c", b: "r1", ab: m(200, 0.9), ba: m(180, 0.8) },
    { a: "c", b: "r3", ab: m(120, 0.6), ba: m(110, 0.5) },
    { a: "c", b: "r4", ab: m(100, 0.5), ba: m(90, 0.4) },
    { a: "e1", b: "r1", ab: { state: "implied", lqi: null, rating: null, source: "parent", reason: null }, ba: m(60, 0.3) },
    { a: "r1", b: "r2", ab: m(150, 0.7), ba: m(140, 0.7) },
    { a: "r1", b: "r4", ab: m(80, 0.4), ba: m(70, 0.3) },
    { a: "r2", b: "r3", ab: m(50, 0.5), ba: { state: "unknown", lqi: null, rating: null, source: null, reason: "table full (16/16)" } },
    { a: "r3", b: "r4", ab: m(40, 0.2), ba: m(30, 0.1) },
  ],
};
const ID = ["c", "e1", "r1", "r2", "r3", "r4"];
const at = (id) => ID.indexOf(id);
// Far apart on a grid, so every lane and value has room.
const POS = { x: [0, -400, -200, -400, 400, 200], y: [0, -300, -150, 300, 0, 300], pinned: new Array(6).fill(0),
  mesh: new Array(6).fill(1) };

function draw(extra = {}) {
  const scene = buildScene(NET, labelWidth);
  const ctx = recordingContext({ props: true });
  const stats = drawScene(ctx, scene, POS, { cam: { k: 1, cx: 0, cy: 0 }, width: 1400, height: 1000, dpr: 1,
    labelZoom: 1, debug: false, selected: -1, hovered: -1, fps: null, fill: "none", sourceRoute: "assume", ...extra },
  theme, labelWidth);
  return { scene, ctx, stats };
}
const lanesOf = (scene, sr) => {
  const sc = sceneClasses(scene, sr);
  return Object.fromEntries(scene.lanes.map((l) => [`${scene.nodes[l.s].id}>${scene.nodes[l.h].id}`, sc.cls[l.index]]));
};

test("classes per direction: up, down measured or assumed, routes between devices, heard only", () => {
  const scene = buildScene(NET, labelWidth);
  const off = lanesOf(scene, "off");
  assert.deepEqual(off, {
    "r1>c": "up", "c>r1": "down", "r3>c": "up", "c>r3": "heard", "r4>c": "up", "c>r4": "down",
    "r1>e1": "down", "e1>r1": "up", "r2>r1": "up", "r1>r2": "down", "r4>r1": "heard", "r1>r4": "route",
    "r3>r2": "heard", "r2>r3": null, "r4>r3": "heard", "r3>r4": "heard",
  });
  // The way back of an up hop is never up: it is down where the coordinator's table walks it, else heard.
  for (const [k, cls] of Object.entries(off)) if (cls === "up") assert.notEqual(off[k.split(">").reverse().join(">")], "up", k);
  // Assumed (source route): c -> r3 is r3's way up reversed, drawn as down, assumed; with "off" it is heard only.
  const assume = lanesOf(scene, "assume");
  assert.equal(assume["c>r3"], "down");
  const sc = sceneClasses(scene, "assume");
  assert.deepEqual(scene.lanes.filter((l) => sc.assumed[l.index]).map((l) => l.key), [`${at("c")}>${at("r3")}`]);
  assert.equal(sc.counts.assumed, 1);
  // r2 -> r1 carries r2's way up and the route r2 -> r4: the strongest wins.
  const lane = scene.laneByKey.get(`${at("r2")}>${at("r1")}`);
  assert.ok(lane.up && lane.route);
  // Heard-only pairs: a reading and no traffic in either direction.
  const heardOnly = scene.pairs.filter((p) => sc.heardOnly[p.index]).map((p) => `${scene.nodes[p.a].id}|${scene.nodes[p.b].id}`);
  assert.deepEqual(heardOnly, ["r2|r3", "r3|r4"]);
});

test("overview: up and down lanes of all devices in every stage; 'heard' adds the best heard-only partners", () => {
  const coordinator = draw().stats;
  assert.deepEqual(coordinator.classes, { heard: 0, route: 0, down: 5, up: 5, assumed: 1, none: 0 });
  assert.equal(coordinator.glyphs, 0, "only in their direction, nothing else");
  assert.deepEqual(draw({ paths: "all" }).stats.classes, coordinator.classes, "stage 2 adds only on click");
  const heard = draw({ paths: "heard" }).stats;
  assert.deepEqual(heard.classes, { heard: 3, route: 0, down: 5, up: 5, assumed: 1, none: 0 });
  assert.equal(heard.glyphs, 1, "r2 -> r3: r3's table does not list r2");
  const off = draw({ sourceRoute: "off" }).stats;
  assert.deepEqual(off.classes, { heard: 0, route: 0, down: 4, up: 5, assumed: 0, none: 0 }, "no assumed return path");
});

test("click: everything else off; stage 1 the way up and down, stage 2 adds routes, stage 3 the heard partners", () => {
  const r2 = at("r2");
  const one = draw({ selected: r2 }).stats;
  assert.deepEqual(one.classes, { heard: 0, route: 0, down: 2, up: 2, assumed: 0, none: 0 });
  assert.equal(one.lanes, 4, "no other lane is drawn");
  assert.deepEqual(one.paths.values.map((v) => [ID[v.s], ID[v.h], v.text]).sort(),
    [["c", "r1", "180"], ["r1", "c", "200"], ["r1", "r2", "140"], ["r2", "r1", "150"]], "RX at every hop");
  const two = draw({ selected: r2, paths: "all" }).stats;
  assert.deepEqual(two.classes, { heard: 0, route: 1, down: 2, up: 2, assumed: 0, none: 0 }, "r1 -> r4 on the way to r4");
  assert.ok(two.paths.values.some((v) => ID[v.s] === "r1" && ID[v.h] === "r4" && v.text === "70" && v.cls === "route"));
  const three = draw({ selected: r2, paths: "heard" }).stats;
  assert.deepEqual(three.classes, { heard: 1, route: 1, down: 2, up: 2, assumed: 0, none: 0 }, "r3 -> r2, heard");
  assert.equal(three.glyphs, 1, "and the glyph of the direction without a reading");
  assert.equal(three.paths.values.length, 6, "with RX");
  // The assumed return path of r3 on its own click: dotted, its value the hearer's reading.
  const r3 = draw({ selected: at("r3") }).stats;
  assert.equal(r3.classes.assumed, 1);
  assert.ok(r3.paths.values.some((v) => ID[v.s] === "c" && ID[v.h] === "r3" && v.text === "110"));
  // The coordinator stands for Home Assistant: its click shows its routes down and the routes up towards it.
  const scene = buildScene(NET, labelWidth);
  const c = scenePaths(scene, at("c"), "coordinator", "assume");
  assert.ok([...c.hops.values()].every((h) => h.cls === "up" || h.cls === "down"));
});

test("hover previews the device's lanes of the stage, dims the rest, and never adds what the stage hides", () => {
  const r2 = at("r2");
  for (const paths of PATH_STAGES) {
    const { stats, ctx } = draw({ hovered: r2, paths });
    const overview = draw({ paths }).stats;
    assert.deepEqual(stats.classes, overview.classes, `${paths}: the same lanes as the overview`);
    assert.ok(ctx.calls.some((c) => c[0] === "set" && c[1] === "globalAlpha" && c[2] === 0.2), "the rest dimmed");
  }
  assert.equal(draw({ hovered: r2 }).stats.paths.hops, 4, "its way up and down");
  assert.equal(draw({ hovered: r2, paths: "all" }).stats.paths.hops, 4, "the route waits for the click");
  assert.equal(draw({ hovered: r2, paths: "heard" }).stats.paths.hops, 5, "its heard partner joins");
});

test("debug mode draws every lane of every class with values on both lanes, with and without a selection", () => {
  const { stats, ctx } = draw({ debug: true });
  assert.deepEqual(stats.classes, { heard: 4, route: 1, down: 5, up: 5, assumed: 1, none: 0 });
  assert.equal(stats.lanes + stats.glyphs, 16, "every lane or its glyph");
  for (const v of ["200", "180", "150", "140", "80", "70", "50", "40", "30"]) {
    assert.ok(ctx.calls.some((c) => c[0] === "fillText" && c[1].startsWith(`${v} ←`)), v);
  }
  const selected = draw({ debug: true, selected: at("r2") }).stats;
  assert.equal(selected.lanes + selected.glyphs, 16, "a selection keeps everything, its own lanes on top");
});

test("the stage only filters the drawing: the layout never moves; junk counts as the default", () => {
  assert.deepEqual(PATH_STAGES, ["coordinator", "all", "heard"]);
  assert.equal(DEFAULT_PATHS, "coordinator");
  for (const bad of [null, undefined, "", "ALL", 3, {}]) assert.equal(pathStage(bad), "coordinator");
  const canvas = new FakeCanvas(800, 600);
  const env = fakeEnv();
  const view = new GraphView(canvas, { env, paths: "junk" });
  assert.equal(view.paths, "coordinator");
  view.setNetwork(NET);
  env.flush();
  const before = JSON.stringify([...view.pos.x, ...view.pos.y]);
  view.setPaths("heard");
  env.flush();
  assert.equal(view.paths, "heard");
  assert.equal(JSON.stringify([...view.pos.x, ...view.pos.y]), before);
  assert.ok(view.legend().some((e) => e.id === "heard"), "the legend follows the stage");
  view.setPaths("everything");
  assert.equal(view.paths, "coordinator");
  assert.ok(!view.legend().some((e) => e.id === "heard"));
  view.setSourceRoute("off");
  assert.ok(!view.legend().some((e) => e.id === "assumed"), "no assumed row while source routes are off");
});

test("the stored stage: valid stages kept, the old node view migrates, the old keys go on the next save", () => {
  assert.equal(DEFAULTS.paths, "coordinator");
  assert.ok(!("links" in DEFAULTS) && !("nodeView" in DEFAULTS));
  for (const v of PATH_STAGES) assert.equal(sanitizeSettings({ paths: v }).paths, v);
  assert.equal(sanitizePaths(undefined, "all"), "all", "nodeView all reads as stage 2");
  assert.equal(sanitizePaths(undefined, "coordinator"), "coordinator");
  assert.equal(sanitizePaths("heard", "all"), "heard", "a valid stage wins over the old key");
  for (const bad of [null, 5, "bogus", ["all"]]) assert.equal(sanitizePaths(bad, bad), "coordinator", JSON.stringify(bad));
  const migrated = sanitizeSettings({ links: { up: true, route: false, heard: true }, nodeView: "all", extra: 1 });
  assert.equal(migrated.paths, "all");
  assert.ok(!("links" in migrated) && !("nodeView" in migrated), "dropped");
  assert.equal(migrated.extra, 1, "unknown keys are kept");
  assert.equal(sanitizeSettings({ links: { heard: false } }).paths, "coordinator");
  // A round trip through JSON, as the integration stores it.
  assert.equal(sanitizeSettings(JSON.parse(JSON.stringify(sanitizeSettings({ paths: "heard" })))).paths, "heard");
});

test("the three stages, their hints and the legend's words in English and German (boards M2, M7)", () => {
  const de = {
    "view.paths": "Kommunikationspfade", "view.paths_coordinator": "mit dem Koordinator, hin und zurück",
    "view.paths_coordinator_hint": "ohne Auswahl alle Geräte; bei Klick nur die Wege des Geräts, mit RX",
    "view.paths_all": "+ Wege zu allen Geräten (theoretisch)",
    "view.paths_all_hint": "bei Klick: vom Gerät zu jedem anderen Gerät und zurück, aus den Routingtabellen",
    "view.paths_heard": "+ nur gehört (beste 3)", "view.paths_heard_hint": "dazu Geräte, die man hört, über die aber kein Weg läuft",
    "view.paths_note": "Jede Stufe enthält die vorige. Debug zeigt alles.",
    "legend.link.coordinator": "Hin- und Rückweg mit dem Koordinator", "legend.link.assumed": "Rückweg angenommen (Source Route)",
    "legend.link.up-path": "Band: der Weg des ausgewählten Geräts zum Koordinator",
    "legend.link.route": "Weg zu einem anderen Gerät", "legend.link.heard": "nur gehört", "legend.stage": "(Stufe {n})",
    "legend.rx": "Empfang beim Empfänger, ein Viertel vor ihm", "legend.link.reception": "farbig: schlecht · mittel · gut",
  };
  for (const [key, text] of Object.entries(de)) {
    assert.equal(STRINGS.de[key], text, key);
    assert.ok(STRINGS.en[key] && STRINGS.en[key] !== text, `en ${key}`);
  }
  assert.equal(STRINGS.en["view.paths_coordinator"], "with the coordinator, there and back");
  assert.equal(STRINGS.en["view.paths_note"], "Every stage includes the previous one. Debug shows everything.");
  for (const gone of ["view.link_up", "view.link_route", "view.link_heard", "view.nodeview_coordinator", "view.nodeview_all",
    "legend.link.up", "legend.link.path"]) {
    assert.ok(!(gone in STRINGS.en) && !(gone in STRINGS.de), gone);
  }
});
