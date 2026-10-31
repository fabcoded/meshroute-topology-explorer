// SPDX-License-Identifier: MIT
// Tests of the device symbols (spec 8; design by Fabian Schwamborn, 2026-10-31): which parts a device gets, the
// router frame and strokes, the shift for right marks, selected and pinned states, the size rule, the contour that
// lanes end at, and the path conversion every drawing goes through.
// node --test "tests/**/*.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import {
  GRID, OUTER, OUTER_RADIUS, FRAME_WIDTH, SELECTED_WIDTH, SYMBOL_SIZE, SYMBOL_GROWTH, SYMBOL_MIN, PICTURES,
  contourExit, drawSymbol, elementPath, parsePath, symbolLayers, symbolParts, symbolSize,
} from "../custom_components/meshroute_topology_explorer/frontend/graph/symbols.js";
import { KINDS } from "../custom_components/meshroute_topology_explorer/frontend/model/kinds.js";
import { NODE_DIAMETER } from "../custom_components/meshroute_topology_explorer/frontend/graph/renderer.js";
import { drawnSymbols, recordingContext } from "./graph-fakes.mjs";
import { sampleNetwork } from "./panel-fixture.mjs";

const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

test("composition: role strokes, radio, cable, crown and bed per device", () => {
  const base = { picture: "unknown", router: false, radio: true, cable: false, mark: null, bed: false };
  assert.deepEqual(symbolParts({ role: "coordinator", kind: "light" }),
    { ...base, picture: "hub", router: true, cable: true, mark: "C" }, "the coordinator is a wired hub with a C");
  assert.deepEqual(symbolParts({ role: "router", kind: "light" }), { ...base, picture: "light", router: true });
  assert.deepEqual(symbolParts({ role: "end device", kind: "button", sleepy: true }),
    { ...base, picture: "button", bed: true });
  assert.deepEqual(symbolParts({ role: "end device", kind: "thermostat", sleepy: false }),
    { ...base, picture: "thermostat" }, "awake end device: no bed");
  assert.deepEqual(symbolParts({ role: "end device", kind: "motion", sleepy: null }), { ...base, picture: "motion" },
    "sleep unknown: no bed (unknown beats wrong)");
  assert.deepEqual(symbolParts({ role: "router", kind: "button", sleepy: true }),
    { ...base, picture: "button", router: true }, "only end devices sleep");
  assert.deepEqual(symbolParts({ role: "unknown", kind: "light" }), { ...base, picture: "light" },
    "unknown role: no router strokes");
  assert.deepEqual(symbolParts({ role: "router", kind: "unknown" }), { ...base, router: true });
  assert.deepEqual(symbolParts({ role: "router", kind: "toString" }), { ...base, router: true }, "only own pictures");
  assert.deepEqual(symbolParts({ role: "border router", kind: "hub", leader: true }),
    { ...base, picture: "hub", router: true, cable: true, mark: "L" }, "Thread: border router, leader");
  assert.deepEqual(symbolParts({ role: "unknown", kind: "switch", radio: false }),
    { ...base, picture: "switch", radio: false, cable: true }, "wired only: cable, no arcs");
});

test("every kind of the data model has a picture, and every picture parses", () => {
  for (const kind of KINDS) assert.ok(PICTURES[kind], kind);
  for (const [name, elements] of Object.entries(PICTURES)) {
    for (const el of elements) assert.ok(parsePath(elementPath(el)).length > 1, `${name}: ${el}`);
  }
});

test("sample: the symbols the map draws (by parts)", () => {
  const count = {};
  for (const d of sampleNetwork().devices) {
    const p = symbolParts(d);
    const key = `${p.picture}${p.router ? " router" : ""}${p.cable ? " cable" : ""}${p.mark ? ` ${p.mark}` : ""}` +
      `${p.bed ? " bed" : ""}`;
    count[key] = (count[key] || 0) + 1;
  }
  assert.deepEqual(count, { "hub router cable C": 1, "light router": 28, "outlet router": 4, "button bed": 7,
    "motion bed": 5 });
});

/** Stroke groups of a symbol by width. */
const byWidth = (layers, width) => layers.strokes.find((g) => near(g.width, width, 1e-3));
const moves = (ops) => ops.filter((op) => op[0] === "M");

test("routers: frame open at 8 places with a stroke in each gap; other roles a closed frame", () => {
  const router = symbolLayers(symbolParts({ role: "router", kind: "light" }));
  const strokes = byWidth(router, 1.2);
  assert.equal(moves(strokes.ops).length, 8, "8 strokes");
  for (const op of moves(strokes.ops)) {
    // Each stroke starts with its round cap at the outer edge (0.7 + 0.6) and sits at 8 or 16.
    assert.ok([op[1], op[2]].some((v) => near(v, OUTER + 0.6) || near(v, GRID - OUTER - 0.6)), `${op}`);
    assert.ok([op[1], op[2]].some((v) => v === 8 || v === 16), `${op}`);
  }
  // 8 gaps: 9 subpaths, since the frame starts and ends where the top-left corner meets the top side.
  assert.equal(moves(byWidth(router, FRAME_WIDTH).ops).length, 9, "the frame open at 8 places");
  const end = symbolLayers(symbolParts({ role: "end device", kind: "button" }));
  assert.equal(byWidth(end, 1.2), undefined, "no strokes");
  assert.equal(moves(byWidth(end, FRAME_WIDTH).ops).length, 1, "one closed frame");
  // The fill reaches the outer edge for every role: one silhouette for lanes to end at.
  assert.deepEqual(router.fill, end.fill);
  assert.deepEqual(router.fill[0], ["M", OUTER + OUTER_RADIUS, OUTER]);
});

test("selected: frame 2.2 grown inwards, the outer edge stays; pinned adds a mark inside", () => {
  for (const role of ["router", "end device"]) {
    const parts = symbolParts({ role, kind: "light" });
    const plain = symbolLayers(parts);
    const selected = symbolLayers(parts, { selected: true });
    assert.equal(byWidth(selected, FRAME_WIDTH), undefined, role);
    // The frame's centre line lies half its width inside the outer edge: 0.7 + w / 2 on the top side.
    const topY = (layers, w) => byWidth(layers, w).ops.find((op) => op[0] === "M")[2];
    assert.ok(near(topY(plain, FRAME_WIDTH) - FRAME_WIDTH / 2, OUTER), role);
    assert.ok(near(topY(selected, SELECTED_WIDTH) - SELECTED_WIDTH / 2, OUTER), role);
  }
  const parts = symbolParts({ role: "router", kind: "light" });
  const ops = (layers) => layers.strokes.reduce((n, g) => n + g.ops.length, 0);
  assert.ok(ops(symbolLayers(parts, { pinned: true })) > ops(symbolLayers(parts)));
  const pinned = symbolLayers(parts, { pinned: true }).strokes.flatMap((g) => g.ops).filter((op) => op[0] !== "Z");
  assert.ok(pinned.every((op) => op.slice(1, 3).every((v) => typeof v !== "number" || (v > OUTER && v < GRID - OUTER))),
    "everything inside the frame");
});

test("a right mark moves picture, arcs and cable 3 units left together (0.92 on the outer grid)", () => {
  const left = (layers, w) => Math.min(...byWidth(layers, w).ops.filter((op) => op[0] === "M").map((op) => op[1]));
  const awake = symbolLayers(symbolParts({ role: "end device", kind: "button", sleepy: false }));
  const sleepy = symbolLayers(symbolParts({ role: "end device", kind: "button", sleepy: true }));
  const picture = 2.1 * 0.46 * 0.92;
  assert.ok(near(left(awake, picture) - left(sleepy, picture), 3 * 0.92), "picture");
  assert.ok(near(left(awake, 0.95 * 0.92) - left(sleepy, 0.95 * 0.92), 3 * 0.92, 1e-3), "arcs");
  // Without a mark the picture is centred: the button's frame spans 4..20 of its grid, centre 12.
  const xs = byWidth(awake, picture).ops.filter((op) => op[0] !== "Z" && op[0] !== "A").map((op) => op[1]);
  assert.ok(near((Math.min(...xs) + Math.max(...xs)) / 2, GRID / 2, 0.2));
});

test("size: 32 px at zoom 1, growing with zoom up to 1.5 times, never below the minimum; layout uses 32", () => {
  assert.equal(symbolSize(1), SYMBOL_SIZE);
  assert.equal(SYMBOL_SIZE, 32);
  assert.equal(NODE_DIAMETER, 32, "L0 is based on the symbol size");
  assert.equal(symbolSize(1.25), 40);
  let last = 0;
  for (let k = 0.01; k < 10; k *= 1.1) {
    const s = symbolSize(k);
    assert.ok(s <= SYMBOL_SIZE * SYMBOL_GROWTH && s >= SYMBOL_MIN && s >= last, `${k}`);
    last = s;
  }
  assert.equal(symbolSize(100), 48);
  assert.equal(symbolSize(0.01), SYMBOL_MIN);
});

test("contour: straight sides at 11.3 of 24, rounded corners, offsets beside the centre", () => {
  const s = 32;
  const h = (s * 11.3) / 24;
  const r = (s * OUTER_RADIUS) / 24;
  assert.ok(near(contourExit(0, 0, 1, 0, s), h));
  assert.ok(near(contourExit(0, 3, -1, 0, s), h), "beside the centre on a straight side");
  assert.ok(near(contourExit(0, 0, 0, -1, 48), (48 * 11.3) / 24));
  const d = Math.SQRT1_2;
  assert.ok(near(contourExit(0, 0, d, d, s), (h - r) * Math.SQRT2 + r), "diagonal ends on the corner circle");
  assert.equal(contourExit(40, 0, 1, 0, s), 0, "a point outside");
  // Every exit point lies on the contour (signed distance 0), whatever the direction and offset.
  for (let a = 0; a < 2 * Math.PI; a += 0.07) {
    const [ux, uy] = [Math.cos(a), Math.sin(a)];
    const [px, py] = [-uy * 3, ux * 3];
    const t = contourExit(px, py, ux, uy, s);
    const [x, y] = [Math.abs(px + ux * t) - (h - r), Math.abs(py + uy * t) - (h - r)];
    const dist = Math.hypot(Math.max(x, 0), Math.max(y, 0)) + Math.min(Math.max(x, y), 0) - r;
    assert.ok(near(dist, 0, 1e-9), `${a}: ${dist}`);
  }
});

test("path conversion: arcs start where the path is and end where SVG says, for every drawing", () => {
  const all = [...Object.values(PICTURES).flat(), ["rect", 1, 2, 3, 4, 0.5], ["circle", 5, 5, 2]];
  let arcs = 0;
  for (const el of all) {
    let at = null;
    const d = elementPath(el);
    const targets = [...d.matchAll(/A\s*[\d.]+ [\d.]+ [\d.]+ [01] [01] (-?[\d.]+) (-?[\d.]+)/g)]
      .map((m) => [Number(m[1]), Number(m[2])]);
    for (const op of parsePath(d)) {
      if (op[0] === "A") {
        const [, cx, cy, r, a0, a1] = op;
        assert.ok(near(cx + r * Math.cos(a0), at[0], 1e-6) && near(cy + r * Math.sin(a0), at[1], 1e-6), `${d}`);
        const end = [cx + r * Math.cos(a1), cy + r * Math.sin(a1)];
        const want = targets.shift();
        assert.ok(near(end[0], want[0], 1e-6) && near(end[1], want[1], 1e-6), `${d}: ${end} vs ${want}`);
        at = end;
        arcs++;
      } else if (op[0] !== "Z") at = op.slice(-2);
    }
  }
  assert.ok(arcs > 20);
  assert.throws(() => parsePath("m1 2 l3 4"), /unsupported/);
});

test("drawing: one transform per symbol, background fill, lines, then back to the dpr transform", () => {
  const ctx = recordingContext({ props: true });
  const layers = symbolLayers(symbolParts({ role: "router", kind: "light" }), { selected: true });
  drawSymbol(ctx, layers, 100, 50, 32, 2, { fill: "#abcdef", stroke: "#111111", slash: false });
  const [sym] = drawnSymbols(ctx.calls, 2);
  assert.deepEqual([sym.x, sym.y, sym.size], [100, 50, 32]);
  assert.ok(ctx.calls.some((c) => c[0] === "set" && c[1] === "fillStyle" && c[2] === "#abcdef"));
  assert.ok(ctx.calls.some((c) => c[0] === "set" && c[1] === "lineWidth" && c[2] === SELECTED_WIDTH));
  assert.equal(ctx.calls.filter((c) => c[0] === "stroke").length, layers.strokes.length, "one stroke per style");
  assert.deepEqual(ctx.calls.filter((c) => c[0] === "setTransform").at(-1), ["setTransform", 2, 0, 0, 2, 0, 0]);
});
