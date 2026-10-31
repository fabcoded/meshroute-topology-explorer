// SPDX-License-Identifier: MIT
// Tests of the gesture model (spec 9.3) with synthetic pointer records and a fake clock: tap below 8 px, drag above,
// long press at 500 ms cancelled by moving, double tap, pinch, cancel; wheel steps and the camera's zoom clamp.
// node --test "tests/**/*.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import {
  GestureRecognizer, TAP_SLOP, LONG_PRESS_MS,
} from "../custom_components/meshroute_topology_explorer/frontend/graph/gestures.js";
import {
  wheelFactor, zoomAt, toWorld, fitCamera, panBy,
} from "../custom_components/meshroute_topology_explorer/frontend/graph/camera.js";
import { fakeEnv } from "./graph-fakes.mjs";

/** Recognizer whose hit test finds a node at (100, 100) within 12 px; returns it and the list of calls. */
function harness() {
  const env = fakeEnv();
  const calls = [];
  const rec = (name) => (...args) => calls.push([name, ...args]);
  const g = new GestureRecognizer({
    hitTest: (x, y) => (Math.hypot(x - 100, y - 100) <= 12 ? { kind: "node", id: "n" } : { kind: "background" }),
    tap: rec("tap"), doubleTap: rec("doubleTap"), longPress: rec("longPress"), dragStart: rec("dragStart"),
    drag: rec("drag"), dragEnd: rec("dragEnd"), pinch: rec("pinch"),
  }, env);
  const names = () => calls.map((c) => c[0]);
  return { g, env, calls, names };
}

test("a press that moves at most 8 px is a tap on what was under it", () => {
  const { g, env, calls, names } = harness();
  g.down({ pointerId: 1, x: 100, y: 100, t: 0 });
  g.move({ pointerId: 1, x: 100 + TAP_SLOP, y: 100, t: 50 });
  env.advance(100);
  g.up({ pointerId: 1, x: 100 + TAP_SLOP, y: 100, t: 100 });
  assert.deepEqual(names(), ["tap"]);
  assert.deepEqual(calls[0][1], { kind: "node", id: "n" });
});

test("more than 8 px is a drag: on a node it moves the node, the first step covers the whole way", () => {
  const { g, calls, names } = harness();
  g.down({ pointerId: 1, x: 100, y: 100, t: 0 });
  g.move({ pointerId: 1, x: 105, y: 100, t: 10 });
  g.move({ pointerId: 1, x: 109, y: 100, t: 20 }); // 9 px from the press
  g.move({ pointerId: 1, x: 120, y: 110, t: 30 });
  g.up({ pointerId: 1, x: 120, y: 110, t: 40 });
  assert.deepEqual(names(), ["dragStart", "drag", "drag", "dragEnd"]);
  assert.equal(calls[1][1].kind, "node");
  assert.deepEqual(calls[1].slice(3), [9, 0]);
  assert.deepEqual(calls[2].slice(3), [11, 10]);
});

test("a drag on the background pans", () => {
  const { g, calls, names } = harness();
  g.down({ pointerId: 1, x: 300, y: 300, t: 0 });
  g.move({ pointerId: 1, x: 300, y: 340, t: 10 });
  g.up({ pointerId: 1, x: 300, y: 340, t: 20 });
  assert.deepEqual(names(), ["dragStart", "drag", "dragEnd"]);
  assert.equal(calls[0][1].kind, "background");
});

test("long press after 500 ms without moving 8 px; no tap on release", () => {
  const { g, env, names } = harness();
  g.down({ pointerId: 1, x: 100, y: 100, t: 0 });
  g.move({ pointerId: 1, x: 106, y: 104, t: 200 });
  env.advance(LONG_PRESS_MS - 1);
  assert.deepEqual(names(), []);
  env.advance(1);
  assert.deepEqual(names(), ["longPress"]);
  g.move({ pointerId: 1, x: 140, y: 100, t: 700 });
  g.up({ pointerId: 1, x: 140, y: 100, t: 800 });
  assert.deepEqual(names(), ["longPress"]);
});

test("moving more than 8 px before 500 ms cancels the long press", () => {
  const { g, env, names } = harness();
  g.down({ pointerId: 1, x: 100, y: 100, t: 0 });
  env.advance(300);
  g.move({ pointerId: 1, x: 100, y: 109, t: 300 });
  env.advance(1000);
  g.up({ pointerId: 1, x: 100, y: 109, t: 1300 });
  assert.deepEqual(names(), ["dragStart", "drag", "dragEnd"]);
});

test("two taps on the same target are a double tap; a cancelled press is nothing", () => {
  const { g, names } = harness();
  for (const t of [0, 200]) {
    g.down({ pointerId: 1, x: 100, y: 100, t });
    g.up({ pointerId: 1, x: 101, y: 100, t: t + 50 });
  }
  assert.deepEqual(names(), ["tap", "tap", "doubleTap"]);
  g.down({ pointerId: 2, x: 100, y: 100, t: 1000 });
  g.cancel({ pointerId: 2, x: 100, y: 100, t: 1010 });
  assert.deepEqual(names(), ["tap", "tap", "doubleTap"]);
});

test("two pointers pinch: factor is the change of their distance, around their centre", () => {
  const { g, calls, names } = harness();
  g.down({ pointerId: 1, x: 200, y: 200, t: 0 });
  g.down({ pointerId: 2, x: 300, y: 200, t: 5 });
  g.move({ pointerId: 2, x: 400, y: 200, t: 10 });
  const pinch = calls.find((c) => c[0] === "pinch");
  assert.equal(pinch[1], 2);
  assert.deepEqual(pinch.slice(2), [300, 200, 50, 0]);
  g.up({ pointerId: 2, x: 400, y: 200, t: 20 });
  g.up({ pointerId: 1, x: 200, y: 200, t: 30 });
  assert.ok(!names().includes("tap"), "a pinch never ends in a tap");
});

test("wheel: x 1.2 per notch in every delta mode, smooth for touchpads", () => {
  assert.ok(Math.abs(wheelFactor(-100, 0) - 1.2) < 1e-12);
  assert.ok(Math.abs(wheelFactor(100, 0) - 1 / 1.2) < 1e-12);
  assert.ok(Math.abs(wheelFactor(-3, 1) - 1.2) < 1e-12);
  assert.ok(Math.abs(wheelFactor(-1, 2) - 1.2) < 1e-12);
  assert.ok(wheelFactor(-10, 0) > 1 && wheelFactor(-10, 0) < 1.2);
});

test("zoom keeps the point under the pointer and stays within 0.1-8 x the fitted view", () => {
  const fit = fitCamera({ minX: -500, minY: -300, maxX: 500, maxY: 300 }, 800, 600, 50);
  const cam = zoomAt(fit, 1.2, 123, 456, 800, 600, fit.k * 0.1, fit.k * 8);
  const before = toWorld(fit, 123, 456, 800, 600);
  const after = toWorld(cam, 123, 456, 800, 600);
  assert.ok(Math.abs(before[0] - after[0]) < 1e-9 && Math.abs(before[1] - after[1]) < 1e-9);
  assert.equal(zoomAt(fit, 1e6, 0, 0, 800, 600, fit.k * 0.1, fit.k * 8).k, fit.k * 8);
  assert.equal(zoomAt(fit, 1e-6, 0, 0, 800, 600, fit.k * 0.1, fit.k * 8).k, fit.k * 0.1);
  const moved = panBy(fit, 30, -20);
  assert.ok(Math.abs((fit.cx - moved.cx) * fit.k - 30) < 1e-9);
});
