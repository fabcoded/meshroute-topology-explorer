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
import { DEFAULTS as SHELL_DEFAULTS, sanitizeSettings as shellSettings } from "../custom_components/meshroute_topology_explorer/frontend/ui/settings.js";
import { DEFAULTS as ZIGBEE_DEFAULTS, sanitizePaths, settings as zigbeeSettings }
  from "../custom_components/meshroute_topology_explorer/frontend/engines/zigbee/settings.js";
import { STRINGS } from "../custom_components/meshroute_topology_explorer/frontend/ui/i18n.js";
import { FakeCanvas, fakeEnv, recordingContext, labelWidth } from "./graph-fakes.mjs";

/** The shell's sanitizer and defaults with the Zigbee engine's keys (engines cut step 5). */
const sanitizeSettings = (stored) => shellSettings(stored, zigbeeSettings);
const DEFAULTS = { ...SHELL_DEFAULTS, ...ZIGBEE_DEFAULTS };

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

test("overview: up and down lanes in every stage; from 'all' the backbone of all theoretical paths; 'heard only' no more", () => {
  const coordinator = draw().stats;
  assert.deepEqual(coordinator.classes, { heard: 0, route: 0, down: 5, up: 5, assumed: 1, predicted: 0, none: 0 });
  assert.equal(coordinator.glyphs, 0, "only in their direction, nothing else");
  // Stage 2 (decision by Fabian Schwamborn, 2026-11-01): every lane a theoretical path between two devices takes, as
  // a route where it is not up or down; here r2 -> r3 and r4 -> r1 (neighbours), r1 -> e1 and e1 -> r1 (child,
  // parent), r1 -> r4 (table). A lane only a discovery takes would be lighter; the sample has 19 (graph-contract).
  const two = draw({ paths: "all" }).stats;
  assert.deepEqual(two.classes, { heard: 0, route: 5, down: 5, up: 5, assumed: 1, predicted: 0, none: 0 });
  // The checkbox without a selection changes nothing, in either stage: heard-only partners come on click.
  for (const [paths, base] of [["all", two], ["coordinator", coordinator]]) {
    const heard = draw({ paths, heard: true }).stats;
    assert.deepEqual(heard.classes, base.classes, `${paths}: nothing without a selection`);
    assert.equal(heard.glyphs, 0);
  }
  const off = draw({ sourceRoute: "off" }).stats;
  assert.deepEqual(off.classes, { heard: 0, route: 0, down: 4, up: 5, assumed: 0, predicted: 0, none: 0 }, "no assumed return path");
});

test("click: everything else off; stage 1 the way up and down, stage 2 adds routes, the checkbox the heard partners", () => {
  const r2 = at("r2");
  const one = draw({ selected: r2 }).stats;
  assert.deepEqual(one.classes, { heard: 0, route: 0, down: 2, up: 2, assumed: 0, predicted: 0, none: 0 });
  assert.equal(one.lanes, 4, "no other lane is drawn");
  assert.deepEqual(one.paths.values.map((v) => [ID[v.s], ID[v.h], v.text]).sort(),
    [["c", "r1", "180"], ["r1", "c", "200"], ["r1", "r2", "140"], ["r2", "r1", "150"]], "RX at every hop");
  const two = draw({ selected: r2, paths: "all" }).stats;
  // Stage 2: the way to and from every other device (spec 5.7). Out: r2 -> r1 and r2 -> r3 directly (r2 hears both),
  // r2 -> r1 -> r4 by the tables, r2 -> r1 -> e1 by discovery to the parent, which delivers. In: r1 and e1 by r1's
  // table; r3 does not hear r2 and r4 has no entry: their ways are what a discovery finds (r3 -> c -> r1 -> r2 costs
  // 4 + 3 + 4, via r4 it would cost 6 + 5 + 4). On click the selection's own tree decides (main session, 2026-11-01,
  // board M11 rule 5): r2's own up and down lanes stay up and down; e1 -> r1 and r1 -> e1 are parent hops of its
  // trees, so routes (not the up and down lanes they are for e1); r3 -> c and r4 -> r1 are only what a discovery would
  // take, so computed although they are someone's up lane or neighbour hop.
  assert.deepEqual(two.paths.values.map((v) => [ID[v.s], ID[v.h], v.text, v.cls, v.predicted]).sort(), [
    ["c", "r1", "180", "down", false], ["e1", "r1", "60", "route", false], ["r1", "c", "200", "up", false],
    ["r1", "e1", "Parent", "route", false], ["r1", "r2", "140", "down", false], ["r1", "r4", "70", "route", false],
    ["r2", "r1", "150", "up", false], ["r2", "r3", "–", "route", false], ["r3", "c", "120", "route", true],
    ["r4", "r1", "80", "route", true]]);
  assert.deepEqual(two.classes, { heard: 0, route: 6, down: 2, up: 2, assumed: 0, predicted: 2, none: 0 });
  assert.equal(two.paths.ends, 0, "every way complete");
  // The checkbox in stage 1 adds r2's heard-only partner r3 (no up, down or route lane between them): r3 -> r2 as
  // heard, r2 -> r3 has no reading, so its glyph "–".
  const withHeard = draw({ selected: r2, heard: true }).stats;
  assert.deepEqual(withHeard.classes, { heard: 1, route: 0, down: 2, up: 2, assumed: 0, predicted: 0, none: 0 });
  assert.equal(withHeard.lanes, 5);
  // In stage 2 the pair is no partner: r2's theoretical paths take r2 -> r3 (a lane drawn between the two), so the
  // checkbox adds nothing here (decision of the main session, 2026-11-01: no lane of the selection's paths between them).
  const three = draw({ selected: r2, paths: "all", heard: true }).stats;
  assert.deepEqual(three.classes, two.classes);
  assert.equal(three.paths.values.length, two.paths.values.length);
  // r3 and r4 hear each other, r3 hears r2: no up, down or route lane between them in stage 1.
  const r3h = draw({ selected: at("r3"), heard: true }).stats;
  assert.equal(r3h.classes.heard, 3, "r3 has two partners: r4 (both lanes) and r2 (r3 -> r2)");
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
    // The same lanes as the overview; a lane of another device's way may show in the class it has on r2's ways.
    assert.equal(stats.lanes, overview.lanes, `${paths}: the same lanes as the overview`);
    assert.ok(ctx.calls.some((c) => c[0] === "set" && c[1] === "globalAlpha" && c[2] === 0.2), "the rest dimmed");
  }
  assert.equal(draw({ hovered: r2 }).stats.paths.hops, 4, "its way up and down");
  // From stage 2 on the overview carries the backbone, so the preview shows r2's trees: all ten hops of the click.
  assert.equal(draw({ hovered: r2, paths: "all" }).stats.paths.hops, draw({ selected: r2, paths: "all" }).stats.paths.hops);
  assert.equal(draw({ hovered: r2, paths: "all" }).stats.paths.hops, 10);
  assert.equal(draw({ hovered: r2, paths: "all", heard: true }).stats.paths.hops, 10, "heard-only partners wait for the click");
  assert.equal(draw({ hovered: r2, heard: true }).stats.paths.hops, 4, "also in stage 1");
});

test("debug mode draws every lane of every class with values on both lanes, with and without a selection", () => {
  const { stats, ctx } = draw({ debug: true });
  assert.deepEqual(stats.classes, { heard: 4, route: 1, down: 5, up: 5, assumed: 1, predicted: 0, none: 0 });
  assert.equal(stats.lanes + stats.glyphs, 16, "every lane or its glyph");
  for (const v of ["200", "180", "150", "140", "80", "70", "50", "40", "30"]) {
    assert.ok(ctx.calls.some((c) => c[0] === "fillText" && c[1].startsWith(`${v} ←`)), v);
  }
  const selected = draw({ debug: true, selected: at("r2") }).stats;
  assert.equal(selected.lanes + selected.glyphs, 16, "a selection keeps everything, its own lanes on top");
});

test("the stage only filters the drawing: the layout never moves; junk counts as the default", () => {
  assert.deepEqual(PATH_STAGES, ["coordinator", "table", "all"]);
  assert.equal(DEFAULT_PATHS, "coordinator");
  for (const bad of [null, undefined, "", "ALL", 3, {}]) assert.equal(pathStage(bad), "coordinator");
  const canvas = new FakeCanvas(800, 600);
  const env = fakeEnv();
  const view = new GraphView(canvas, { env, paths: "junk" });
  assert.equal(view.paths, "coordinator");
  view.setNetwork(NET);
  env.flush();
  const before = JSON.stringify([...view.pos.x, ...view.pos.y]);
  view.setPaths("heard"); // the former third stage is no stage any more
  assert.equal(view.paths, "coordinator");
  view.setHeard(true);
  env.flush();
  assert.equal(view.heard, true);
  assert.equal(JSON.stringify([...view.pos.x, ...view.pos.y]), before);
  // The legend lists every class whatever the stage (decision by Fabian Schwamborn, 2026-11-01); only the glyph rows
  // follow it.
  assert.ok(view.legend().some((e) => e.id === "not-listed"), "glyph rows with the checkbox");
  view.setHeard(false);
  view.setPaths("everything");
  assert.equal(view.paths, "coordinator");
  assert.ok(!view.legend().some((e) => e.id === "not-listed"));
  view.setSourceRoute("off");
  assert.deepEqual(view.legend().filter((e) => e.kind === "lane").map((e) => e.id),
    ["coordinator", "assumed", "route", "discovery", "heard"]);
});

test("the stored stage: valid stages kept, the old node view migrates, the old keys go on the next save", () => {
  assert.equal(DEFAULTS.paths, "coordinator");
  assert.ok(!("links" in DEFAULTS) && !("nodeView" in DEFAULTS));
  for (const v of PATH_STAGES) assert.equal(sanitizeSettings({ paths: v }).paths, v);
  assert.equal(sanitizePaths(undefined, "all"), "all", "nodeView all reads as stage 2");
  assert.equal(sanitizePaths(undefined, "coordinator"), "coordinator");
  assert.equal(sanitizePaths("all", "coordinator"), "all", "a valid stage wins over the old key");
  assert.equal(sanitizePaths("heard", undefined), "all", "the former third stage reads as stage 2");
  for (const bad of [null, 5, "bogus", ["all"]]) assert.equal(sanitizePaths(bad, bad), "coordinator", JSON.stringify(bad));
  const migrated = sanitizeSettings({ links: { up: true, route: false, heard: true }, nodeView: "all", extra: 1 });
  assert.equal(migrated.paths, "all");
  assert.ok(!("links" in migrated) && !("nodeView" in migrated), "dropped");
  assert.equal(migrated.extra, 1, "unknown keys are kept");
  assert.equal(sanitizeSettings({ links: { heard: false } }).paths, "coordinator");
  // A.4l: the third stage became a checkbox on top of stage 2 (decision by Fabian Schwamborn, 2026-11-01).
  const legacy = sanitizeSettings({ paths: "heard", nodeView: "coordinator" });
  assert.deepEqual([legacy.paths, legacy.heard], ["all", true], "paths 'heard' -> all + heard");
  assert.deepEqual([migrated.heard, sanitizeSettings({}).heard, DEFAULTS.heard], [false, false, false], "calm default");
  for (const bad of [1, "yes", null, "true"]) assert.equal(sanitizeSettings({ paths: "all", heard: bad }).heard, false);
  assert.deepEqual(sanitizeSettings({ paths: "coordinator", heard: true }).paths, "coordinator", "the checkbox works in stage 1");
  assert.equal(sanitizeSettings({ paths: "coordinator", heard: true }).heard, true);
  // A round trip through JSON, as the integration stores it: the migrated shape is stable.
  const again = sanitizeSettings(JSON.parse(JSON.stringify(legacy)));
  assert.deepEqual([again.paths, again.heard], ["all", true]);
});

test("the three stages, their hints and the legend's words in English and German (boards M2, M7)", () => {
  const de = {
    "view.paths": "Kommunikationspfade", "view.paths_coordinator": "mit dem Koordinator, hin und zurück",
    "view.paths_coordinator_hint": "ohne Auswahl alle Geräte; bei Klick nur die Wege des Geräts, mit RX",
    "view.paths_all": "Wege zu allen Geräten (theoretisch)",
    "view.paths_all_hint":
      "ohne Auswahl alle Spuren, die irgendein Weg nutzt (berechnete heller); bei Klick der Baum des Geräts hin und zurück",
    "view.paths_heard": "zusätzlich gehörte Nachbarn (beste 3)",
    "view.paths_heard_hint": "braucht eine Auswahl: fügt die 3 besten Partner mit Messwert und ohne gezeichnete Spur hinzu, in jeder Ansicht",
    "view.paths_note": "Jede Ansicht hat ihre eigene Grundlage. Debug zeigt alles.",
    "legend.option_heard": "(Option \"zusätzlich gehörte Nachbarn\", braucht eine Auswahl)",
    "legend.link.coordinator": "Hin- und Rückweg mit dem Koordinator", "legend.link.assumed": "Rückweg angenommen (Source Route)",
    "legend.link.up-path": "Band: der Weg des ausgewählten Geräts zum Koordinator",
    "legend.link.route": "Weg zu einem anderen Gerät", "legend.link.discovery": "einer der günstigsten Wege nach den LQI der Tabellen",
    "legend.link.heard": "nur gehört", "legend.stage": "(Ansicht {n})", "legend.stage_computed": "(berechnet, Ansicht {n})",
    "legend.rx": "Empfang beim Empfänger, ein Viertel vor ihm", "legend.link.reception": "farbig: schlecht · mittel · gut",
  };
  for (const [key, text] of Object.entries(de)) {
    assert.equal(STRINGS.de[key], text, key);
    assert.ok(STRINGS.en[key] && STRINGS.en[key] !== text, `en ${key}`);
  }
  assert.equal(STRINGS.en["view.paths_coordinator"], "with the coordinator, there and back");
  assert.equal(STRINGS.en["view.paths_note"], "Each view has its own basis. Debug shows everything.");
  // The routing-table view (owner proposal 2026-11-01, Codex 5 and 6.2): its hint and the return-route checkbox.
  assert.equal(STRINGS.en["view.paths_table"], "routing table");
  assert.equal(STRINGS.en["view.paths_table_hint"],
    "Each router's table names the next hop to a destination. This view follows those entries until the destination or a gap.");
  assert.equal(STRINGS.en["view.paths_returns_hint"],
    "Follow each destination's route back, using the routing table at every hop.");
  assert.equal(STRINGS.en["view.paths_heard"], "additional heard neighbours (best 3)");
  // Texts of the main session (2026-11-01, owner's decisions on the stage-2 overview and the stage-3 click).
  assert.equal(STRINGS.en["view.paths_all_hint"],
    "without a selection every lane any path uses (computed lighter); on click the device's trees there and back");
  assert.equal(STRINGS.en["view.paths_heard_hint"],
    "needs a selection: adds the device's 3 best partners with a reading and no drawn lane, in any view");
  assert.equal(STRINGS.en["legend.link.discovery"], "Computed path: a candidate, not observed traffic.");
  assert.equal(STRINGS.en["legend.stage_computed"], "(computed, view {n})");
  for (const gone of ["view.link_up", "view.link_route", "view.link_heard", "view.nodeview_coordinator", "view.nodeview_all",
    "legend.link.up", "legend.link.path"]) {
    assert.ok(!(gone in STRINGS.en) && !(gone in STRINGS.de), gone);
  }
});
