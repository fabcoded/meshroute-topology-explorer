// SPDX-License-Identifier: MIT
// The fitted view per network engine (spec 9.3): a Thread map
// "contains" every device and its label in the window at every density and at phone width, after load and after
// "fit"; a Zigbee map keeps its fit at density factor 1, so at medium density it reaches past the window,
// and its camera does not depend on the engine cut.
// npm test
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GraphView } from "../custom_components/meshroute_topology_explorer/frontend/graph/graph-view.js";
import { DENSITY } from "../custom_components/meshroute_topology_explorer/frontend/graph/layout.js";
import { bounds, fitCamera } from "../custom_components/meshroute_topology_explorer/frontend/graph/camera.js";
import { symbolSize } from "../custom_components/meshroute_topology_explorer/frontend/graph/symbols.js";
import { ENGINES } from "../custom_components/meshroute_topology_explorer/frontend/engines/index.js";
import { FakeCanvas, fakeEnv, labelWidth } from "./graph-fakes.mjs";
import { sampleNetwork } from "./panel-fixture.mjs";

const topology = JSON.parse(readFileSync(new URL("./fixtures/matter-sample.json", import.meta.url), "utf8"))
  .responses["matter/network_topology"];
const threadNet = ENGINES.thread.build(topology, {});
const zigbeeNet = sampleNetwork();
/** Desktop, the dev page's phone frame and a large screen. */
const SIZES = [[1280, 767], [390, 800], [1920, 1040]];

/** A settled view of the network on a w x h canvas at the density, without animation. */
function show(network, [w, h], density) {
  const canvas = new FakeCanvas(w, h);
  const env = fakeEnv({ dpr: 1, reducedMotion: true });
  const view = new GraphView(canvas, { env, density });
  view.setNetwork(network);
  env.flush();
  return { view, canvas, env };
}

/** Every device inside the window with its whole symbol, and every text the frame drew inside it as well. */
function assertContained(view, canvas, tag) {
  const [w, h] = [view.width, view.height];
  const half = symbolSize(view.cam.k) / 2;
  for (let i = 0; i < view.scene.nodes.length; i++) {
    const [x, y] = view._screenOf(i);
    assert.ok(x - half >= 0 && x + half <= w && y - half >= 0 && y + half <= h,
      `${tag}: ${view.scene.nodes[i].label} at ${x.toFixed(0)},${y.toFixed(0)} in ${w}x${h}`);
  }
  canvas.ctx.calls.length = 0;
  view.draw();
  const texts = canvas.ctx.calls.filter((c) => c[0] === "fillText");
  assert.ok(texts.length >= view.scene.nodes.length, `${tag}: every device labelled`);
  for (const [, text, x, y] of texts) {
    const tw = labelWidth(text);
    assert.ok(x - tw / 2 >= 0 && x + tw / 2 <= w && y >= 0 && y <= h, `${tag}: "${text}" at ${x.toFixed(0)},${y.toFixed(0)}`);
  }
}

test("Thread: the fitted view contains every device and its label, after load and after fit, at every density", () => {
  assert.equal(ENGINES.thread.scene.fit, "contain");
  for (const size of SIZES) for (const [name, density] of Object.entries(DENSITY)) {
    const { view, canvas, env } = show(threadNet, size, density);
    assertContained(view, canvas, `${size.join("x")} ${name} load`);
    view.zoomBy(3, { animate: false }); // the user moves away, then asks for the fit again
    view.fit({ animate: false });
    env.flush();
    assertContained(view, canvas, `${size.join("x")} ${name} fit`);
  }
});

test("Thread: a density change refits a view the user has not moved; a moved one keeps its zoom", () => {
  const { view, canvas, env } = show(threadNet, SIZES[0], DENSITY.dense);
  view.setDensity(DENSITY.spread);
  env.flush();
  assertContained(view, canvas, "dense -> spread");
  view.zoomBy(2, { animate: false });
  const k = view.cam.k;
  view.setDensity(DENSITY.medium);
  assert.equal(view.cam.k, k, "a moved view keeps its zoom");
});

test("Zigbee: the fit stays at density factor 1 (medium reaches past the window), whatever the screen", () => {
  assert.equal(ENGINES.zigbee.scene.fit, "base");
  for (const size of SIZES) for (const density of Object.values(DENSITY)) {
    const { view } = show(zigbeeNet, size, density);
    const box = bounds(view.pos.x, view.pos.y);
    const base = { minX: box.minX / density, minY: box.minY / density, maxX: box.maxX / density, maxY: box.maxY / density };
    const fit = fitCamera(base, size[0], size[1], 56);
    assert.deepEqual(view.cam, { k: fit.k, cx: fit.cx * density, cy: fit.cy * density }, `${size} ${density}`);
  }
  const { view } = show(zigbeeNet, SIZES[0], DENSITY.medium);
  const outside = view.scene.nodes.filter((n, i) => {
    const [x, y] = view._screenOf(i);
    return x < 0 || x > view.width || y < 0 || y > view.height;
  });
  assert.ok(outside.length > 0, "medium density reaches past the window");
});

test("custom factors at the range ends: Thread still contains the map, Zigbee keeps its fit at factor 1", () => {
  for (const size of SIZES) for (const density of [0.6, 8]) {
    const t = show(threadNet, size, density);
    assertContained(t.view, t.canvas, `thread ${size} ${density}`);
    const { view } = show(zigbeeNet, size, density);
    const box = bounds(view.pos.x, view.pos.y);
    const base = { minX: box.minX / density, minY: box.minY / density, maxX: box.maxX / density, maxY: box.maxY / density };
    const fit = fitCamera(base, size[0], size[1], 56);
    assert.equal(view.cam.k, fit.k, `zigbee ${size} ${density}`);
  }
});

test("Thread: stepping the custom factor refits an unmoved view", () => {
  const { view, canvas, env } = show(threadNet, SIZES[0], DENSITY.medium);
  for (const d of [1.8, 2.25, 2.8125, 2.25, 1.8]) {
    view.setDensity(d);
    env.flush();
    assertContained(view, canvas, `step ${d}`);
  }
});
