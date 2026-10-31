// SPDX-License-Identifier: MIT
// Tests of the link rendering (spec 7.1, 8, 9.3; decision by Fabian Schwamborn, 2026-10-31): lanes on the right of
// their travel in every quadrant, classes by dash and weight, glyphs for directions without a reading, drawing
// order, the selection's up-path band, values on the right of the selection's lanes, legend entries.
// node --test "tests/**/*.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import {
  BAND, CLASSES, DIM, LANE_GAP, laneGeometry, laneStyle, legendEntries, unknownGlyph, widthStep, textBeside, WIDTHS,
} from "../custom_components/meshroute_topology_explorer/frontend/graph/links.js";
import { GRID, OUTER, OUTER_RADIUS } from "../custom_components/meshroute_topology_explorer/frontend/graph/symbols.js";
import { buildScene, drawScene } from "../custom_components/meshroute_topology_explorer/frontend/graph/renderer.js";
import { resolveTheme } from "../custom_components/meshroute_topology_explorer/frontend/graph/palette.js";
import { recordingContext, labelWidth } from "./graph-fakes.mjs";

const cross = (ax, ay, bx, by) => ax * by - ay * bx;
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
  const up = laneStyle("up", "measured", 0.9, theme);
  const route = laneStyle("route", "measured", 0.9, theme);
  const heard = laneStyle("heard", "measured", 0.9, theme);
  const implied = laneStyle("up", "implied", null, theme);
  assert.deepEqual(up.dash, []);
  assert.equal(route.cap, "round");
  assert.ok(route.dash[0] < 0.1 && route.dash[1] > route.width, "round dots");
  assert.ok(heard.dash[0] >= 4, "dashes");
  assert.equal(up.color, theme.foreground);
  assert.equal(route.color, theme.foreground);
  assert.equal(heard.color, theme.muted);
  assert.ok(up.width > route.width && route.width > heard.width, "up path strongest, heard only thinnest");
  assert.equal(implied.head, false);
  assert.equal(implied.color, theme.muted);
  for (const cls of ["up", "route", "heard"]) assert.ok(WIDTHS[cls][0] < WIDTHS[cls][2]);
});

test("glyphs: '–' where the hearer's table does not list the sender, '?' where there is no table or LQI 0", () => {
  for (const reason of ["table full (16/16)", "table nearly full (14/16), link probably weak",
    "table has space, link probably weak or aged out", "capacity unknown"]) assert.equal(unknownGlyph(reason), "–");
  for (const reason of ["end device (no table)", "table missing or stale", "lqi 0", null, undefined]) {
    assert.equal(unknownGlyph(reason), "?");
  }
});

// A small network with explicit pairs: c (coordinator) - r1 up path, r1 - r2 route only, r2 - r3 heard only (r3 does
// not list r2: table full), e1 end device under r1 (parent link, end device has no table).
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
      ba: dir("unknown", null, null, null, "table full (16/16)") },
  ],
};
// Positions (screen = layout at zoom 1, centred): c left, r1 middle, r2 right, r3 below r2, e1 above r1.
const POS = { x: [-300, 0, 300, 300, 0], y: [0, 0, 0, 250, -250], pinned: [0, 0, 0, 0, 0], mesh: [1, 1, 1, 1, 1] };

function draw({ selected = -1, hovered = -1, debug = false } = {}) {
  const scene = buildScene(NET, labelWidth);
  const ctx = recordingContext({ props: true });
  const stats = drawScene(ctx, scene, POS, { cam: { k: 1, cx: 0, cy: 0 }, width: 1000, height: 800, dpr: 1,
    labelZoom: 1, debug, selected, hovered, fps: null, fill: "reception" }, theme, labelWidth);
  return { scene, ctx, stats };
}

test("classes on a small network; a direction without a reading gets a glyph mid-way along its missing lane", () => {
  const { scene, ctx, stats } = draw();
  const cls = Object.fromEntries(scene.pairs.map((p) => [`${scene.nodes[p.a].id}-${scene.nodes[p.b].id}`, p.cls]));
  assert.deepEqual(cls, { "c-r1": "up", "e1-r1": "up", "r1-r2": "route", "r2-r3": "heard" });
  assert.equal(stats.glyphs, 1);
  // r2 -> r3 is unknown (r3 hears r2: not listed): travel from r2 (300, 0) down to r3 (300, 250); right of "down"
  // is to the left on screen, so the glyph sits at x = 500 + 300 - 3 = 797, half way between the symbol contours.
  const glyph = ctx.calls.find((c) => c[0] === "fillText" && c[1] === "–");
  assert.ok(glyph, "the glyph is drawn");
  assert.ok(Math.abs(glyph[2] - 797) < 1e-9 && Math.abs(glyph[3] - (400 + 125)) < 1e-9, `${glyph[2]}, ${glyph[3]}`);
});

test("drawing order: heard only, then other routes, then up paths, on top", () => {
  const { stats } = draw();
  const rank = stats.order.map((c) => CLASSES.indexOf(c));
  assert.deepEqual(rank, [...rank].sort((a, b) => a - b));
  assert.deepEqual(stats.classes, { heard: 1, route: 1, up: 2 });
});

test("selection: dims what does not touch it, draws its up path as a band under its lanes, values on the right", () => {
  const e1 = 4;
  const { ctx } = draw({ selected: e1 });
  const calls = ctx.calls;
  // The band: alpha 0.18, width 7, through e1 -> r1 -> c.
  const bandAt = calls.findIndex((c, j) => c[0] === "set" && c[1] === "lineWidth" && c[2] === BAND.width &&
    calls.slice(Math.max(0, j - 3), j).some((x) => x[0] === "set" && x[1] === "globalAlpha" && x[2] === BAND.alpha));
  assert.ok(bandAt > 0, "a band is drawn");
  const bandPath = calls.slice(bandAt).filter((c) => c[0] === "moveTo" || c[0] === "lineTo").slice(0, 3)
    .map((c) => [c[1], c[2]]);
  assert.deepEqual(bandPath, [[500, 150], [500, 400], [200, 400]], "e1, r1, coordinator");
  // Pairs not touching e1 are drawn dimmed, before the band; e1's own lanes after it, at full opacity.
  const dimAt = calls.findIndex((c) => c[0] === "set" && c[1] === "globalAlpha" && c[2] === DIM);
  assert.ok(dimAt >= 0 && dimAt < bandAt);
  // Values of e1's lanes: "Parent" for the implied direction, 90 for r1 hearing e1, each on the right of its lane.
  const text = (t) => calls.find((c) => c[0] === "fillText" && c[1] === t);
  const parent = text("Parent");
  const value = text("90");
  assert.ok(parent && value);
  // "e1 hears r1" is implied ("Parent") and travels r1 -> e1, up the screen: its right is x > 500. "r1 hears e1"
  // (LQI 90) travels e1 -> r1, down the screen: its right is x < 500.
  assert.ok(parent[2] > 500, `Parent at x ${parent[2]}`);
  assert.ok(value[2] < 500, `90 at x ${value[2]}`);
  // Nothing else carries values while only e1 is selected.
  assert.equal(text("200"), undefined);
});

test("hover previews the same without the band; debug shows every value", () => {
  const { ctx } = draw({ hovered: 4 });
  assert.ok(!ctx.calls.some((c) => c[0] === "set" && c[1] === "lineWidth" && c[2] === BAND.width), "no band");
  assert.ok(ctx.calls.some((c) => c[0] === "set" && c[1] === "globalAlpha" && c[2] === DIM), "dimmed");
  const debug = draw({ debug: true });
  for (const v of ["200", "120", "90", "60"]) {
    assert.ok(debug.ctx.calls.some((c) => c[0] === "fillText" && c[1].startsWith(`${v} ←`)), v);
  }
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

test("legend entries name every class, the implied lane, both glyphs, the width steps and the band", () => {
  const entries = legendEntries(theme);
  assert.deepEqual(entries.map((e) => e.id),
    ["up", "route", "heard", "implied", "width", "not-listed", "no-table", "up-path"]);
  assert.equal(entries.find((e) => e.id === "route").style.cap, "round");
  assert.equal(entries.find((e) => e.id === "not-listed").text, "–");
});
