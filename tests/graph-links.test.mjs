// SPDX-License-Identifier: MIT
// Tests of the link rendering (spec 7.1, 8, 9.3): lanes on
// the right of their travel in every quadrant, classes per direction by dash and weight, glyphs for directions without
// a reading, drawing order, the selection's lanes with "RX:" values a quarter before each hearer, unknown ends, colour
// by reception, legend entries per stage.
// node --test "tests/**/*.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import {
  BAND, DASH, DIM, LANE_GAP, STEM, STROKES, VALUE_AT, laneGeometry, laneStyle, stemGeometry, widthStep, textBeside, WIDTHS,
} from "../custom_components/meshroute_topology_explorer/frontend/graph/links.js";
import { CLASSES, legendEntries, strokeOf }
  from "../custom_components/meshroute_topology_explorer/frontend/engines/zigbee/lanes.js";
import { sceneClasses } from "../custom_components/meshroute_topology_explorer/frontend/engines/zigbee/scene.js";
import { GRID, OUTER, OUTER_RADIUS } from "../custom_components/meshroute_topology_explorer/frontend/graph/symbols.js";
import { buildScene, drawScene } from "../custom_components/meshroute_topology_explorer/frontend/graph/renderer.js";
import { receptionColor, resolveTheme, RECEPTION_STOPS, contrastRatio, parseColor } from "../custom_components/meshroute_topology_explorer/frontend/graph/palette.js";
import { asZigbee, recordingContext, labelWidth } from "./graph-fakes.mjs";

const cross = (ax, ay, bx, by) => ax * by - ay * bx;
/** A Zigbee class's style: its look (strokeOf, board M11) through the shared laneStyle. */
const classStyle = (cls, rating, t, opts = {}) => laneStyle(strokeOf(cls, opts), rating, t, opts);
const theme = resolveTheme({});

/** Signed distance of a point (relative to a symbol's centre) to the symbol's rounded-square contour. */
function contourDistance(px, py, size) {
  const h = (size * (GRID / 2 - OUTER)) / GRID;
  const r = (size * OUTER_RADIUS) / GRID;
  const qx = Math.abs(px) - (h - r);
  const qy = Math.abs(py) - (h - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

test("a lane lies on the right of its direction of travel in all four quadrants, ending at the symbols' contours", () => {
  for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [-1, -1], [1, -1], [3, -7]]) {
    const [x2, y2] = [100 + 200 * dx, 100 + 200 * dy];
    const lane = laneGeometry(100, 100, x2, y2, 32, 48, 3);
    // Offset of the lane from the centre line, seen along the travel: positive cross product = right (y down).
    const side = cross(lane.ux, lane.uy, lane.x0 - 100, lane.y0 - 100);
    assert.ok(side > 0, `right of (${dx}, ${dy})`);
    assert.ok(Math.abs(side - 3) < 1e-9, "3 px from the centre line");
    // Each end lies LANE_GAP beyond its symbol's contour: the sender's (32 px) and the hearer's (48 px).
    const start = contourDistance(lane.x0 - lane.ux * LANE_GAP - 100, lane.y0 - lane.uy * LANE_GAP - 100, 32);
    const end = contourDistance(lane.x1 + lane.ux * LANE_GAP - x2, lane.y1 + lane.uy * LANE_GAP - y2, 48);
    assert.ok(Math.abs(start) < 1e-9 && Math.abs(end) < 1e-9, `on the contours (${dx}, ${dy}): ${start}, ${end}`);
  }
  // Along an axis the contour is the straight side: half the silhouette (11.3 of 24) plus the gap from each centre.
  const east = laneGeometry(0, 0, 100, 0, 32, 32, 3);
  const west = laneGeometry(100, 0, 0, 0, 32, 32, 3);
  assert.ok(Math.abs(east.len - (100 - 2 * (32 * 11.3 / 24 + LANE_GAP))) < 1e-9);
  // East: right is down on screen; the opposite direction of the same pair runs on the other side.
  assert.ok(east.y0 > 0 && west.y0 < 0);
  assert.equal(laneGeometry(0, 0, 33, 0, 32, 32, 3), null, "touching symbols leave no lane");
});

test("classes are told apart by dash and weight, not colour; widths follow the lane's rating in three steps", () => {
  assert.deepEqual([0, 0.2, 0.34, 0.5, 0.67, 1, null].map(widthStep), [0, 0, 1, 1, 2, 2, 0]);
  const up = classStyle("up", 0.9, theme);
  const down = classStyle("down", 0.9, theme);
  const assumed = classStyle("down", 0.9, theme, { assumed: true });
  const route = classStyle("route", 0.9, theme);
  const heard = classStyle("heard", 0.9, theme);
  const none = classStyle(null, null, theme);
  assert.deepEqual(up.dash, [], "up and down solid (board M11)");
  assert.deepEqual(down, up);
  assert.equal(assumed.cap, "round");
  assert.ok(assumed.dash[0] < 0.1 && assumed.dash[1] > assumed.width + 3, "sparse round dots");
  assert.deepEqual(route.dash, [6, 3, 1.5, 3], "dash-dot");
  assert.deepEqual(heard.dash, [6, 3], "dashed");
  assert.deepEqual(DASH.dashdot, [6, 3, 1.5, 3]);
  for (const s of [up, assumed, route]) assert.equal(s.color, theme.foreground);
  assert.equal(heard.color, theme.muted);
  assert.ok(up.width > route.width && route.width > heard.width, "up and down strongest, heard only thinnest");
  for (const s of [up, assumed, route, heard]) assert.equal(s.head, true, "arrowhead at the hearer");
  assert.equal(none.head, false);
  assert.equal(none.color, theme.muted);
  // A path hop nothing proves keeps its class's dash, in grey at the thinnest width.
  const unknown = classStyle("route", null, theme, { state: "unknown" });
  assert.deepEqual(unknown.dash, route.dash);
  assert.equal(unknown.color, theme.muted);
  assert.equal(unknown.width, WIDTHS.dashdot[0]);
  for (const look of STROKES.filter((k) => k in WIDTHS && k !== "faint")) assert.ok(WIDTHS[look][0] < WIDTHS[look][2]);
  assert.deepEqual(CLASSES.map((c) => strokeOf(c)), ["dashed", "dashdot", "solid", "solid"]);
});

import { unknownGlyph } from "../custom_components/meshroute_topology_explorer/frontend/engines/unknown-reason.js";

test("glyphs: '–' where the hearer's table does not list the sender, '?' where there is no table or LQI 0", () => {
  for (const code of ["table_full", "table_nearly_full", "table_space", "capacity_unknown", "not_listed"]) {
    assert.equal(unknownGlyph({ code }), "–", code);
  }
  for (const reason of [{ code: "no_table_end_device" }, { code: "table_missing" }, { code: "lqi0" }, null, undefined]) {
    assert.equal(unknownGlyph(reason), "?");
  }
});

// A small network with explicit pairs: c (coordinator) - r1, r1's way up; r1 - r2 a route between devices (r2 -> r1);
// r2 - r3 heard only (r3 does not list r2: table full); e1 end device under r1 (parent link, end device has no table).
// The coordinator holds no routes, so no way down is known.
const dir = (state, lqi = null, rating = null, source = null, reason = null) =>
  ({ state, lqi, rating, source, reason });
const NET = {
  devices: [
    { id: "c", role: "coordinator", label: "Coordinator", available: true },
    { id: "r1", role: "router", label: "Router 1", available: true },
    { id: "r2", role: "router", label: "Router 2", available: true },
    { id: "r3", role: "router", label: "Router 3", available: true },
    { id: "e1", role: "end device", label: "Sensor", available: true, parent: "r1" },
  ],
  readings: [],
  routes: [
    { owner: "r1", destination: "c", nextHop: "c", status: "Active", stale: false },
    { owner: "r2", destination: "r1", nextHop: "r1", status: "Active", stale: false },
  ],
  pairs: [
    { a: "c", b: "r1", ab: dir("measured", 200, 0.9, "table"), ba: dir("measured", 120, 0.5, "table") },
    { a: "e1", b: "r1", ab: dir("implied", null, null, "parent"), ba: dir("measured", 90, 0.4, "table") },
    { a: "r1", b: "r2", ab: dir("implied", null, null, "route"), ba: dir("implied", null, null, "route") },
    { a: "r2", b: "r3", ab: dir("measured", 60, 0.2, "table"),
      ba: dir("unknown", null, null, null, { code: "table_full", size: "16/16" }) },
  ],
};
// Positions (screen = layout at zoom 1, centred): c left, r1 middle, r2 right, r3 below r2, e1 above r1.
const POS = { x: [-300, 0, 300, 300, 0], y: [0, 0, 0, 250, -250], pinned: [0, 0, 0, 0, 0], mesh: [1, 1, 1, 1, 1] };

function draw({ selected = -1, hovered = -1, debug = false, net = NET, ...extra } = {}) {
  const scene = buildScene(asZigbee(net), labelWidth);
  const ctx = recordingContext({ props: true });
  const stats = drawScene(ctx, scene, POS, { cam: { k: 1, cx: 0, cy: 0 }, width: 1000, height: 800, dpr: 1,
    labelZoom: 1, debug, selected, hovered, fps: null, fill: "none", ...extra }, theme, labelWidth);
  return { scene, ctx, stats };
}

test("classes per direction on a small network; a direction without a reading gets a glyph mid-way", () => {
  const { scene, ctx, stats } = draw({ debug: true });
  const sc = sceneClasses(scene, "off");
  const cls = Object.fromEntries(scene.lanes.map((l) => [`${scene.nodes[l.s].id}>${scene.nodes[l.h].id}`, sc.cls[l.index]]));
  assert.deepEqual(cls, { "r1>c": "up", "c>r1": "heard", "r1>e1": null, "e1>r1": "up", "r2>r1": "route", "r1>r2": null,
    "r3>r2": "heard", "r2>r3": null }, "the way back of an up hop is no up lane");
  assert.equal(stats.glyphs, 1);
  // r2 -> r3 is unknown (r3 hears r2: not listed): travel from r2 (300, 0) down to r3 (300, 250); right of "down"
  // is to the left on screen, so the glyph sits at x = 500 + 300 - 3 = 797, half way between the symbol contours.
  const glyph = ctx.calls.find((c) => c[0] === "fillText" && c[1] === "–");
  assert.ok(glyph, "the glyph is drawn");
  assert.ok(Math.abs(glyph[2] - 797) < 1e-9 && Math.abs(glyph[3] - (400 + 125)) < 1e-9, `${glyph[2]}, ${glyph[3]}`);
  assert.equal(draw().stats.glyphs, 0, "the first stage draws no heard-only pair, so no glyph");
  assert.equal(draw({ heard: true }).stats.glyphs, 0, "nor the heard option without a selection");
});

test("drawing order: lanes without class, heard only, routes, down, then up on top", () => {
  const { stats } = draw({ debug: true });
  const rank = stats.order.map((c) => (c === "none" ? -1 : CLASSES.indexOf(c)));
  assert.deepEqual(rank, [...rank].sort((a, b) => a - b));
  assert.deepEqual(stats.classes, { heard: 2, route: 1, down: 0, up: 2, assumed: 0, predicted: 0, none: 2 });
});

test("selection: only its lanes, its way up as a band, every hop with RX at its hearer, the unknown way down", () => {
  const e1 = 4;
  const { ctx, stats } = draw({ selected: e1 });
  const calls = ctx.calls;
  // Up path e1 -> r1 -> c: r1 hears e1 at 90, the coordinator hears r1 at 200. The coordinator has no route down, so
  // the down path is unknown from the coordinator on: a stem towards e1 with "?" and the words.
  assert.equal(stats.paths.hops, 2);
  assert.equal(stats.paths.ends, 1);
  assert.equal(stats.lanes, 2, "everything else is off");
  assert.deepEqual(stats.paths.values.map((v) => [v.s, v.h, v.text, v.drawn, v.cls]),
    [[4, 1, "90", true, "up"], [1, 0, "200", true, "up"]]);
  // The band: alpha 0.18, width 7, through e1 -> r1 -> c, under the lanes (it tells the way
  // to the coordinator apart from the other paths).
  const bandAt = calls.findIndex((c, j) => c[0] === "set" && c[1] === "lineWidth" && c[2] === BAND.width &&
    calls.slice(Math.max(0, j - 3), j).some((x) => x[0] === "set" && x[1] === "globalAlpha" && x[2] === BAND.alpha));
  assert.ok(bandAt > 0, "a band is drawn");
  const bandPath = calls.slice(bandAt).filter((c) => c[0] === "moveTo" || c[0] === "lineTo").slice(0, 3)
    .map((c) => [c[1], c[2]]);
  assert.deepEqual(bandPath, [[500, 150], [500, 400], [200, 400]], "e1, r1, coordinator");
  const firstLane = calls.findIndex((c, j) => j > bandAt && c[0] === "set" && c[1] === "lineWidth" && c[2] !== BAND.width);
  assert.ok(firstLane > bandAt, "the lanes on top of it");
  // The other devices are dimmed.
  assert.ok(calls.some((c) => c[0] === "set" && c[1] === "globalAlpha" && c[2] === DIM));
  const text = (t) => calls.filter((c) => c[0] === "fillText" && c[1] === t);
  assert.equal(text("RX:").length, 2, "each value under RX:");
  assert.equal(text("?").length, 1);
  assert.equal(text("path unknown").length, 1);
  // "e1 -> r1" travels down the screen: its right is x < 500. "r1 -> c" travels left: its right is up, y < 400.
  const [v90] = text("90");
  const [v200] = text("200");
  assert.ok(v90[1] < 500 && v90[3] > 275, `90 near r1, left of the lane: ${v90[2]}, ${v90[3]}`);
  assert.ok(v200[3] < 400 && v200[2] < 350, `200 near the coordinator, above the lane: ${v200[2]}, ${v200[3]}`);
  // Lanes off its paths are not drawn at all: not 120 (r1 hears c), not "Parent" (e1 hears r1: the way down is unknown).
  assert.equal(text("120").length, 0);
  assert.equal(text("Parent").length, 0);
  assert.equal(text("60").length, 0);
});

test("a value sits a quarter of its lane before the hearer, on the right of travel, with RX: above it", () => {
  const e1 = 4;
  const { ctx, stats } = draw({ selected: e1 });
  // Hop e1 -> r1, as the renderer lays it out at zoom 1 (symbols 32 px, lanes 3 px off the centre line).
  const lane = laneGeometry(500, 150, 500, 400, 32, 32, 3);
  const at = ctx.calls.findIndex((c) => c[0] === "fillText" && c[1] === "90");
  const value = ctx.calls[at];
  const rx = ctx.calls.slice(0, at).reverse().find((c) => c[0] === "fillText" && c[1] === "RX:");
  const centre = [value[2], value[3] - 7]; // two lines of 14 px: the value is the lower one
  const along = (centre[0] - lane.x0) * lane.ux + (centre[1] - lane.y0) * lane.uy;
  assert.ok(Math.abs(along - VALUE_AT * lane.len) < 1e-9, `3/4 of the lane from the sender: ${along} of ${lane.len}`);
  assert.equal(VALUE_AT, 0.75);
  assert.ok(cross(lane.ux, lane.uy, centre[0] - lane.x0, centre[1] - lane.y0) > 0, "right of travel");
  assert.ok(rx && rx[2] === value[2] && rx[3] === value[3] - 14, "RX: right above the value");
  assert.equal(stats.paths.values[0].x, centre[0]);
  // In every direction the anchor is 3/4 along and on the right, clear of the stroke.
  for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1], [2, 1], [-3, 2]]) {
    const l = laneGeometry(0, 0, 300 * dx, 300 * dy, 32, 32, 3);
    const [tx, ty] = textBeside(l, 24, 28, 1, VALUE_AT);
    const a = (tx - l.x0) * l.ux + (ty - l.y0) * l.uy;
    assert.ok(Math.abs(a - 0.75 * l.len) < 1e-9);
    const side = cross(l.ux, l.uy, tx - l.x0, ty - l.y0);
    assert.ok(side > Math.abs(l.nx) * 12 + Math.abs(l.ny) * 14 - 1e-9, `clear on the right (${dx}, ${dy})`);
  }
});

test("stage 'all': paths to and from other devices join the click as routes; hover previews only what the stage draws", () => {
  // r1's own route to c is its up path. Stage 2 adds its theoretical way to and from every other device (spec 5.7):
  // r1 delivers to its child e1 ("Parent": the parent link implies the hop), e1 sends to its parent (r1 hears it at
  // 90), r2's table leads to r1 ("Route"); nothing leads between r1 and r3 (no table read, no reading), so those two
  // walks and the down path from c end in "?" stems.
  const coordinatorView = draw({ selected: 1 });
  assert.equal(coordinatorView.stats.paths.hops, 1, "r1 -> c");
  const all = draw({ selected: 1, paths: "all" });
  const values = all.stats.paths.values.map((v) => [v.s, v.h, v.text, v.cls]).sort();
  assert.deepEqual(values, [[1, 0, "200", "up"], [1, 4, "Parent", "route"], [2, 1, "Route", "route"],
    [4, 1, "90", "route"]], "e1 -> r1 is e1's up lane, but r1's own tree takes it as a route");
  assert.equal(all.stats.paths.ends, 4, "c -> r1, r1 -> r2, r1 -> r3, r3 -> r1");
  // The overview of stage 2 carries every lane a theoretical path takes, so hover previews r1's hops without adding a
  // lane; the "?" stems of incomplete ways wait for the click.
  const hover = draw({ hovered: 1, paths: "all" });
  assert.equal(hover.stats.paths.hops, 4);
  assert.equal(hover.stats.lanes, draw({ paths: "all" }).stats.lanes, "no lane the overview does not draw");
  assert.equal(hover.stats.paths.ends, all.stats.paths.ends, "the unknown ends as on the click");
});

test("up and down hop of one pair are drawn on its two lanes, each on the right of its own travel", () => {
  // c <-> r1 both ways: r1's route to c is its up path, c's route to r1 its down path.
  const net = {
    devices: NET.devices.slice(0, 2),
    readings: [],
    routes: [{ owner: "r1", destination: "c", nextHop: "c", status: "Active", stale: false },
      { owner: "c", destination: "r1", nextHop: "r1", status: "Active", stale: false }],
    pairs: [{ a: "c", b: "r1", ab: dir("measured", 200, 0.9, "table"), ba: dir("measured", 120, 0.5, "table") }],
  };
  const { ctx, stats } = draw({ net, selected: 1 });
  assert.deepEqual(stats.paths.values.map((v) => [v.s, v.h, v.text, v.cls]).sort(),
    [[0, 1, "120", "down"], [1, 0, "200", "up"]]);
  // Lanes start where they leave the sender: track the opacity in force at each moveTo.
  let alpha = 1;
  const starts = [];
  for (const c of ctx.calls) {
    if (c[0] === "set" && c[1] === "globalAlpha") alpha = c[2];
    if (c[0] === "moveTo") starts.push({ x: c[1], y: c[2], alpha });
  }
  // r1 (500, 400) -> c (200, 400) travels left: its right is up (y 397). c -> r1 travels right: its right is down.
  const up = starts.filter((p) => p.alpha === 1 && Math.abs(p.y - 397) < 1e-9 && p.x > 450);
  const down = starts.filter((p) => p.alpha === 1 && Math.abs(p.y - 403) < 1e-9 && p.x < 250);
  assert.equal(up.length, 1, "the up hop on its lane");
  assert.equal(down.length, 1, "the down hop on the other lane");
  // Each value beside its own lane: 200 above (near c), 120 below (near r1).
  const [v200] = ctx.calls.filter((c) => c[0] === "fillText" && c[1] === "200");
  const [v120] = ctx.calls.filter((c) => c[0] === "fillText" && c[1] === "120");
  assert.ok(v200[3] < 400 && v200[2] < 350, `${v200[2]}, ${v200[3]}`);
  assert.ok(v120[3] > 400 && v120[2] > 350, `${v120[2]}, ${v120[3]}`);
  // The overview draws both: up and down, each in its own direction only.
  assert.deepEqual(draw({ net }).stats.classes, { heard: 0, route: 0, down: 1, up: 1, assumed: 0, predicted: 0, none: 0 });
});

test("the unknown end: a short dashed stem on the right of the way towards the goal", () => {
  const stem = stemGeometry(0, 0, 300, 0, 32, 3);
  assert.ok(stem.y0 > 0, "right of travel");
  assert.ok(Math.abs(stem.x1 - stem.x0 - STEM.length) < 1e-9);
  assert.ok(stem.gx > stem.x1, "the ? beyond the stem's tip");
  assert.ok(stemGeometry(0, 0, 60, 0, 32, 3).x1 - 17 < 60 * STEM.share, "never more than its share of the way");
  assert.equal(stemGeometry(0, 0, 10, 0, 32, 3), null);
});

test("colour by reception: rated lanes red to green by their hearer's rating, dash kept; off by default", () => {
  for (const background of ["#ffffff", "#111111"]) {
    const t = resolveTheme({ background });
    const weak = classStyle("heard", 0, t, { colored: true });
    const strong = classStyle("up", 1, t, { colored: true });
    assert.equal(weak.color, receptionColor(0, t));
    assert.equal(strong.color, receptionColor(1, t));
    assert.deepEqual(weak.dash, classStyle("heard", 0, t).dash, "the class still shows by its dash");
    assert.equal(classStyle("route", 1, t, { colored: true }).color, receptionColor(1, t));
    assert.equal(classStyle("up", 1, t).color, t.foreground, "colour-free unless switched on");
    assert.equal(classStyle(null, null, t, { colored: true }).color, t.muted, "no reading, no colour");
    assert.equal(classStyle("up", null, t, { colored: true }).color, t.foreground, "no rating, no colour");
    assert.equal(classStyle("down", 1, t, { colored: true, assumed: true }).color, t.foreground, "assumed stays uncoloured");
  }
  // On the map: the selection's measured hops take the colour, the numbers stay.
  const { ctx } = draw({ selected: 4, receptionColors: true });
  const colours = new Set(ctx.calls.filter((c) => c[0] === "set" && c[1] === "strokeStyle").map((c) => c[2]));
  assert.ok(colours.has(receptionColor(0.4, theme)) && colours.has(receptionColor(0.9, theme)));
  assert.ok(ctx.calls.some((c) => c[0] === "fillText" && c[1] === "90"));
  const plain = draw({ selected: 4 });
  assert.ok(!plain.ctx.calls.some((c) => c[0] === "set" && c[1] === "strokeStyle" && c[2] === receptionColor(0.9, theme)));
});

test("the user's own colours replace the stops, nudged to 3:1; null keeps the theme's", () => {
  for (const background of ["#ffffff", "#111111"]) {
    const own = resolveTheme({ background });
    const stops = background === "#ffffff" ? RECEPTION_STOPS.light : RECEPTION_STOPS.dark;
    assert.equal(receptionColor(0, own), stops[0], "the theme's red at the weakest end");
    // Okabe-Ito blue, orange and vermillion for a red-green colour blind user; the middle stays the theme's.
    const custom = resolveTheme({ background, receptionStops: ["#0072b2", null, "#e69f00"] });
    for (const r of [0, 0.25, 0.5, 0.75, 1]) {
      assert.ok(contrastRatio(parseColor(receptionColor(r, custom)), parseColor(background)) >= 3 - 1e-9, `${background} ${r}`);
    }
    assert.equal(receptionColor(0.5, custom), receptionColor(0.5, own), "the middle stop is the theme's");
    assert.notEqual(receptionColor(0, custom), receptionColor(0, own));
    if (background === "#ffffff") assert.equal(receptionColor(0, custom), "#0072b2", "kept where it reaches 3:1");
    // A colour too close to the background is nudged until it reaches 3:1.
    const pale = resolveTheme({ background, receptionStops: [background, background, background] });
    assert.ok(contrastRatio(parseColor(receptionColor(1, pale)), parseColor(background)) >= 3 - 1e-9);
    // Junk is the theme's own.
    const junk = resolveTheme({ background, receptionStops: ["red; x", 5, {}] });
    assert.deepEqual([0, 0.5, 1].map((r) => receptionColor(r, junk)), [0, 0.5, 1].map((r) => receptionColor(r, own)));
  }
});

test("hover dims the rest and previews; debug shows every lane with its value", () => {
  const { ctx, stats } = draw({ hovered: 4 });
  assert.ok(ctx.calls.some((c) => c[0] === "set" && c[1] === "globalAlpha" && c[2] === DIM), "dimmed");
  assert.equal(stats.paths.hops, 2, "e1's way up");
  assert.ok(!ctx.calls.some((c) => c[0] === "set" && c[1] === "lineWidth" && c[2] === BAND.width), "hover: no band");
  const debug = draw({ debug: true });
  for (const v of ["200", "120", "90", "60"]) {
    assert.ok(debug.ctx.calls.some((c) => c[0] === "fillText" && c[1].startsWith(`${v} ←`)), v);
  }
  assert.ok(debug.ctx.calls.some((c) => c[0] === "fillText" && c[1] === "Parent"), "implied lanes carry their value");
});

test("text beside a lane stays clear of it, on its right", () => {
  for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1], [2, 1]]) {
    const lane = laneGeometry(0, 0, 300 * dx, 300 * dy, 32, 32, 3);
    const [tx, ty] = textBeside(lane, 40, 14);
    assert.ok(cross(lane.ux, lane.uy, tx - lane.mx, ty - lane.my) > 0);
    // The text box does not reach the lane: its half extent along the normal is less than the distance.
    const reach = Math.abs(lane.nx) * 20 + Math.abs(lane.ny) * 7;
    assert.ok(Math.hypot(tx - lane.mx, ty - lane.my) > reach);
  }
});

test("legend entries follow the stage: the classes it draws, RX, the scale while coloured; debug all (board M7)", () => {
  const ids = (o) => legendEntries(theme, o).map((e) => e.id);
  // Every class whatever the stage; the glyph rows with the heard option under the routing table.
  const classes = ["coordinator", "assumed", "route", "discovery", "heard", "up-path"];
  assert.deepEqual(ids(), [...classes, "rx"]);
  assert.deepEqual(ids({ paths: "all" }), [...classes, "rx"]);
  assert.deepEqual(ids({ heard: true, paths: "table" }), [...classes, "not-listed", "no-table", "rx"]);
  assert.deepEqual(ids({ heard: true }), [...classes, "rx"], "a stored heard = true draws no glyphs outside that view");
  assert.deepEqual(ids({ heard: true, paths: "all" }), [...classes, "rx"]);
  assert.deepEqual(ids({ debug: true }), ["coordinator", "assumed", "route", "discovery", "heard", "up-path", "implied",
    "width", "not-listed", "no-table", "path-end", "rx"]);
  const band = legendEntries(theme).find((e) => e.id === "up-path");
  assert.deepEqual([band.kind, band.alpha, band.width], ["band", BAND.alpha, BAND.width]);
  assert.deepEqual(ids({ paths: "junk" }), ids(), "an unknown stage is the default");
  const entries = legendEntries(theme, { heard: true, paths: "table", sourceRoute: "assume", colored: true });
  assert.equal(entries.at(-1).id, "reception");
  assert.deepEqual(entries.at(-1).colors, [0, 0.25, 0.5, 0.75, 1].map((r) => receptionColor(r, theme)));
  assert.deepEqual(entries.find((e) => e.id === "route").style.dash, [6, 3, 1.5, 3]);
  assert.deepEqual(entries.find((e) => e.id === "route").stage, [2, 3], "routes: the views routing table and all");
  assert.deepEqual(entries.find((e) => e.id === "coordinator").stage, [1, 3], "up and down: not in the routing table");
  // A hop only a computed route discovery takes: the same dash-dot in the lighter grey, never in a reception colour.
  const discovery = entries.find((e) => e.id === "discovery");
  assert.deepEqual([discovery.style.dash, discovery.style.color, discovery.stage], [[6, 3, 1.5, 3], theme.muted, 3]);
  assert.notEqual(entries.find((e) => e.id === "route").style.color, theme.muted);
  assert.equal(classStyle("route", 0.1, theme, { colored: true, predicted: true }).color, theme.muted);
  assert.equal(entries.find((e) => e.id === "heard").option, "heard");
  const assumed = entries.find((e) => e.id === "assumed").style;
  assert.ok(assumed.dash.length && assumed.head, "dotted, with an arrowhead");
  assert.equal(entries.find((e) => e.id === "not-listed").text, "–");
});
