// SPDX-License-Identifier: MIT
// The value pill (spec 7.1) drawn by the renderer's drawPill, which the map and the path history window share: the
// single-line output equals what the map drew before the function was extracted (an opaque plate 4 px larger, a 1 px
// outline in the lane's colour, the text upright at y + 0.5), and the stacked form puts one text line per row. npm test
import test from "node:test";
import assert from "node:assert/strict";
import { drawPill } from "../custom_components/meshroute_topology_explorer/frontend/graph/renderer.js";
import { recordingContext } from "./graph-fakes.mjs";

const theme = { background: "#ffffff", foreground: "#212121", font: "12px sans-serif" };

test("a one-line pill is drawn as the map drew it before", () => {
  const ctx = recordingContext({ props: true });
  drawPill(ctx, { x: 50, y: 40, w: 30, h: 16, text: "174", color: "#2a78d6", alpha: 0.5 }, theme);
  const sets = ctx.calls.filter((c) => c[0] === "set");
  const named = (key) => sets.filter((c) => c[1] === key).map((c) => c[2]);
  assert.deepEqual(named("fillStyle"), ["#ffffff", "#212121"], "plate in the background, then the text colour");
  assert.deepEqual(named("globalAlpha"), [1, 0.5, 1], "the plate is opaque, the outline takes the lane's alpha");
  assert.deepEqual(named("lineWidth"), [1]);
  assert.deepEqual(named("strokeStyle"), ["#2a78d6"]);
  assert.deepEqual(named("font"), ["11.5px sans-serif", "12px sans-serif"], "value font, then back to the label font");
  const moves = ctx.calls.filter((c) => c[0] === "moveTo");
  assert.deepEqual(moves[0].slice(1), [50 - 17 + 10, 40 - 10], "plate 34 x 20 (the pill plus 4 px), rounded ends of radius 10");
  assert.deepEqual(ctx.calls.filter((c) => c[0] === "fillText"), [["fillText", "174", 50, 40.5]]);
  assert.equal(ctx.calls.filter((c) => c[0] === "fill").length, 1, "only the plate is filled");
});

test("a stacked pill writes one line per row, evenly, inside the pill", () => {
  const ctx = recordingContext();
  drawPill(ctx, { x: 10, y: 100, w: 50, h: 28, text: "−75 dBm\nLQI 3", color: "#eb6834" }, theme);
  const texts = ctx.calls.filter((c) => c[0] === "fillText");
  assert.deepEqual(texts.map((c) => c[1]), ["−75 dBm", "LQI 3"]);
  assert.deepEqual(texts.map((c) => c[3]), [100 - 14 + 7 + 0.5, 100 - 14 + 21 + 0.5]);
});
