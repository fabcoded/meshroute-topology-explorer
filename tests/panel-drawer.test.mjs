// SPDX-License-Identifier: MIT
// The panels' place and size (spec 9.1) and their promise: they never cover the selected device (the map pans, 9.3).
// Geometry from ui/geometry.js, checked against the real GraphView on a fake canvas.
// node --test "tests/**/*.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import { drawerGeometry, isWide, WIDE_MIN, SIDE_MIN, SIDE_MAX, SHEET_COLLAPSED, MAP_KEEP } from "../custom_components/meshroute_topology_explorer/frontend/ui/geometry.js";
import { GraphView } from "../custom_components/meshroute_topology_explorer/frontend/graph/graph-view.js";
import { FakeCanvas, fakeEnv } from "./graph-fakes.mjs";
import { sampleNetwork } from "./panel-fixture.mjs";

test("side panel on wide screens, bottom sheet on narrow ones; insets only while open", () => {
  assert.equal(isWide(WIDE_MIN), true);
  assert.equal(isWide(WIDE_MIN - 1), false);
  const side = drawerGeometry({ width: 1400, height: 800, open: true, expanded: false });
  assert.equal(side.mode, "side");
  assert.equal(side.size, SIDE_MAX);
  assert.equal(SIDE_MAX, 384, "at most 384 px, as on the boards");
  assert.deepEqual(side.insets, { top: 0, right: SIDE_MAX, bottom: 0, left: 0 });
  assert.equal(drawerGeometry({ width: 720, height: 800, open: true }).size, SIDE_MIN);
  assert.deepEqual(drawerGeometry({ width: 1400, height: 800, open: false }).insets, { top: 0, right: 0, bottom: 0, left: 0 });
  assert.deepEqual(drawerGeometry({ width: 1400, height: 800, open: true, side: "left" }).insets,
    { top: 0, right: 0, bottom: 0, left: SIDE_MAX }, "the left panel on the left");
  const collapsed = drawerGeometry({ width: 390, height: 700, open: true, expanded: false });
  assert.equal(collapsed.mode, "sheet");
  assert.equal(collapsed.size, SHEET_COLLAPSED, "opened collapsed to one line");
  assert.deepEqual(collapsed.insets, { top: 0, right: 0, bottom: SHEET_COLLAPSED, left: 0 });
  const expanded = drawerGeometry({ width: 390, height: 700, open: true, expanded: true });
  assert.equal(expanded.size, 385);
  const short = drawerGeometry({ width: 390, height: 300, open: true, expanded: true });
  assert.equal(short.size, 300 - MAP_KEEP, "the map keeps its share above the sheet");
});

function view(width, height) {
  const canvas = new FakeCanvas(width, height);
  const env = fakeEnv({ dpr: 1, reducedMotion: true });
  const v = new GraphView(canvas, { env });
  v.setNetwork(sampleNetwork());
  for (let i = 0; i < 200 && !v.layout.settled; i++) env.flush(1);
  env.flush();
  return { v, env };
}

const screen = (v, id) => {
  const i = v.scene.index.get(id);
  return [(v.pos.x[i] - v.cam.cx) * v.cam.k + v.width / 2, (v.pos.y[i] - v.cam.cy) * v.cam.k + v.height / 2];
};

test("opening a panel pans the map so the selected device stays clear of it", () => {
  const network = sampleNetwork();
  // Wide: every device, selected at the overview, stays left of the side panel once it opens.
  for (const d of network.devices) {
    const { v } = view(1400, 780);
    v.select(d.id);
    const g = drawerGeometry({ width: 1400, height: 780, open: true });
    v.setInsets(g.insets);
    const [x, y] = screen(v, d.id);
    assert.ok(x <= 1400 - g.insets.right - 40 && x >= 0 && y >= 0 && y <= 780, `${d.label} at ${x.toFixed(0)}`);
  }
  // Wide, both panels: every device stays between them.
  for (const d of network.devices.slice(0, 12)) {
    const { v } = view(1400, 780);
    v.select(d.id);
    const l = drawerGeometry({ width: 1400, height: 780, open: true, side: "left" });
    const r = drawerGeometry({ width: 1400, height: 780, open: true, side: "right" });
    v.setInsets({ ...r.insets, left: l.insets.left });
    const [x] = screen(v, d.id);
    assert.ok(x >= l.size + 20 && x <= 1400 - r.size - 20, `${d.label} at ${x.toFixed(0)}`);
  }
  // Narrow: above the expanded sheet, also after zooming to the device from the list.
  for (const d of network.devices.slice(0, 12)) {
    const { v } = view(390, 700);
    const g = drawerGeometry({ width: 390, height: 700, open: true, expanded: true });
    v.setInsets(g.insets);
    v.select(d.id);
    v.reveal(d.id, v.insets, { zoom: true, animate: false });
    const [x, y] = screen(v, d.id);
    assert.ok(y <= 700 - g.size - 40 && y >= 0 && x >= 0 && x <= 390, `${d.label} at ${y.toFixed(0)}`);
  }
});
