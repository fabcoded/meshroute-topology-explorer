// SPDX-License-Identifier: MIT
// Tests of the map view (spec 9.2, 9.3) in a fake-event harness: synthetic pointer, wheel, key and context-menu
// events on a fake canvas, a fake clock and frames; checks the emitted events, pinning, pan and zoom, hit areas.
// node --test "tests/**/*.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import { GraphView } from "../custom_components/meshroute_topology_explorer/frontend/graph/graph-view.js";
import { hitRadius, MARKERS, MIN_HIT } from "../custom_components/meshroute_topology_explorer/frontend/graph/renderer.js";
import { FakeCanvas, fakeEnv, domEvent } from "./graph-fakes.mjs";

const NETWORK = {
  source: "zha",
  id: "test",
  devices: [
    { id: "c", role: "coordinator", label: "Coordinator", available: true, rating: null },
    { id: "r1", role: "router", label: "Hall lamp", available: true, rating: 0.8 },
    { id: "r2", role: "router", label: "Desk lamp", available: true, rating: 0.4 },
    { id: "e1", role: "end device", label: "Door sensor", available: true, rating: 0.1 },
    { id: "u", role: "router", label: "Unplugged", available: false, rating: null },
  ],
  readings: [
    { reporter: "c", subject: "r1", lqi: 200 }, { reporter: "r1", subject: "c", lqi: 180 },
    { reporter: "r1", subject: "r2", lqi: 120 }, { reporter: "r2", subject: "r1", lqi: 100 },
    { reporter: "c", subject: "r2", lqi: 60 }, { reporter: "r2", subject: "e1", lqi: 90 },
  ],
};

function setup(options = {}) {
  const canvas = new FakeCanvas(800, 600);
  const env = fakeEnv(options);
  const view = new GraphView(canvas, { env });
  view.setNetwork(NETWORK);
  env.flush();
  const events = [];
  for (const type of ["select", "details-request", "hover", "pin-change"]) {
    view.addEventListener(type, (e) => events.push([type, e.detail]));
  }
  let t = 1000;
  const fire = (type, x, y, extra = {}) => {
    const e = domEvent(type, { pointerId: 1, clientX: x, clientY: y, timeStamp: (t += 10), button: 0, buttons: 1,
      pointerType: "mouse", deltaY: 0, deltaMode: 0, ...extra });
    canvas.dispatchEvent(e);
    return e;
  };
  const at = (id) => {
    const i = view.scene.index.get(id);
    const { k, cx, cy } = view.cam;
    return [(view.pos.x[i] - cx) * k + view.width / 2, (view.pos.y[i] - cy) * k + view.height / 2];
  };
  const tap = (x, y) => { fire("pointerdown", x, y); fire("pointerup", x, y, { buttons: 0 }); };
  return { canvas, env, view, events, fire, at, tap, advanceTime: (ms) => { t += ms; } };
}

test("the canvas is sized for the device pixel ratio and focusable, gestures stay on the map", () => {
  const { canvas, view } = setup();
  assert.equal(canvas.width, 1600);
  assert.equal(canvas.height, 1200);
  assert.ok(canvas.ctx.calls.some((c) => c[0] === "setTransform" && c[1] === 2 && c[4] === 2));
  assert.equal(canvas.getAttribute("tabindex"), "0");
  assert.equal(canvas.style.touchAction, "none");
  assert.equal(view.layout.ringIds().join(), "u", "a device without readings is on the ring");
});

test("tap selects a device, tap on the background and Esc clear the selection", () => {
  const { canvas, view, events, at, tap } = setup();
  tap(...at("r1"));
  assert.deepEqual(events, [["select", { id: "r1" }]]);
  assert.equal(view.selectedId, "r1");
  tap(5, 5);
  assert.deepEqual(events.at(-1), ["select", { id: null }]);
  tap(...at("r2"));
  canvas.dispatchEvent(domEvent("keydown", { key: "Escape", timeStamp: 1 }));
  assert.deepEqual(events.at(-1), ["select", { id: null }]);
  view.select("e1"); // calls from code do not emit
  assert.equal(events.length, 4);
});

test("right-click opens details on a device only; the browser menu stays elsewhere", () => {
  const { events, fire, at } = setup();
  const onNode = fire("contextmenu", ...at("e1"), { button: 2 });
  assert.equal(onNode.defaultPrevented, true);
  assert.deepEqual(events, [["select", { id: "e1" }], ["details-request", { id: "e1", via: "context-menu" }]]);
  const elsewhere = fire("contextmenu", 5, 5, { button: 2 });
  assert.equal(elsewhere.defaultPrevented, false);
  assert.equal(events.length, 2);
  // A right-button press is not a tap or drag.
  fire("pointerdown", ...at("r1"), { button: 2 });
  fire("pointerup", ...at("r1"), { button: 2, buttons: 0 });
  assert.equal(events.length, 2);
});

test("long press of 500 ms on a device requests details; the release is not a tap", () => {
  const { env, events, fire, at } = setup();
  fire("pointerdown", ...at("r2"));
  env.advance(499);
  assert.deepEqual(events, []);
  env.advance(1);
  assert.deepEqual(events, [["select", { id: "r2" }], ["details-request", { id: "r2", via: "long-press" }]]);
  fire("pointerup", ...at("r2"), { buttons: 0 });
  assert.equal(events.length, 2);
});

test("the menu key opens details of the selection, and its contextmenu event is swallowed", () => {
  const { canvas, events, at, tap } = setup();
  tap(...at("c"));
  const key = domEvent("keydown", { key: "ContextMenu", timeStamp: 5000 });
  canvas.dispatchEvent(key);
  assert.equal(key.defaultPrevented, true);
  assert.deepEqual(events.at(-1), ["details-request", { id: "c", via: "key" }]);
  const menu = domEvent("contextmenu", { clientX: 1, clientY: 1, timeStamp: 5010 });
  canvas.dispatchEvent(menu);
  assert.equal(menu.defaultPrevented, true);
  assert.equal(events.length, 2);
});

test("dragging a device pins it where it is dropped; a double tap releases it", () => {
  const { env, view, events, fire, at, tap, advanceTime } = setup();
  const [x, y] = at("r1");
  const before = view.layout.position("r1");
  fire("pointerdown", x, y);
  fire("pointermove", x + 20, y);
  fire("pointermove", x + 40, y + 30);
  fire("pointerup", x + 40, y + 30, { buttons: 0 });
  env.flush();
  const pin = events.find((e) => e[0] === "pin-change");
  assert.ok(pin && pin[1].id === "r1" && pin[1].pinned === true);
  assert.ok(view.layout.isPinned("r1"));
  const k = view.cam.k;
  assert.ok(Math.abs(pin[1].x - (before.x + 40 / k)) < 1e-6 && Math.abs(pin[1].y - (before.y + 30 / k)) < 1e-6);
  assert.deepEqual(view.layout.position("r1"), { x: pin[1].x, y: pin[1].y }, "stays after the layout settles again");
  assert.ok(view.pinnedPositions().has("r1"));
  advanceTime(1000);
  tap(...at("r1"));
  tap(...at("r1"));
  assert.deepEqual(events.at(-1), ["pin-change", { id: "r1", pinned: false }]);
  assert.equal(view.layout.isPinned("r1"), false);
});

test("dragging the background pans; the wheel zooms x 1.2 around the pointer within 0.1-8 x fit", () => {
  const { view, fire } = setup();
  const cam0 = { ...view.cam };
  fire("pointerdown", 10, 10);
  fire("pointermove", 60, 10);
  fire("pointerup", 60, 10, { buttons: 0 });
  assert.ok(Math.abs((cam0.cx - view.cam.cx) * cam0.k - 50) < 1e-9);
  const k0 = view.cam.k;
  const wheel = fire("wheel", 300, 200, { deltaY: -100 });
  assert.equal(wheel.defaultPrevented, true);
  assert.ok(Math.abs(view.cam.k / k0 - 1.2) < 1e-9);
  for (let i = 0; i < 100; i++) fire("wheel", 300, 200, { deltaY: -100 });
  assert.ok(Math.abs(view.cam.k - 8 * view.fitK) < 1e-9);
  for (let i = 0; i < 200; i++) fire("wheel", 300, 200, { deltaY: 100 });
  assert.ok(Math.abs(view.cam.k - 0.1 * view.fitK) < 1e-9);
});

test("hit areas are at least 24 px across, at every zoom and for every role", () => {
  for (const role of Object.keys(MARKERS)) {
    for (const k of [0.001, 0.01, 0.1, 0.5, 1, 4, 100]) assert.ok(2 * hitRadius(role, k) >= MIN_HIT, `${role} ${k}`);
  }
  const { view, events, at, tap } = setup();
  view.zoomBy(1e-6, { animate: false }); // smallest zoom: markers at their minimum size
  const [x, y] = at("e1");
  tap(x + 11.5, y);
  assert.deepEqual(events.at(-1), ["select", { id: "e1" }]);
});

test("zoom buttons animate, unless the user prefers reduced motion", () => {
  const moving = setup();
  const k0 = moving.view.cam.k;
  moving.view.zoomIn();
  assert.equal(moving.view.cam.k, k0, "starts on the next frame");
  moving.env.flush();
  assert.ok(Math.abs(moving.view.cam.k / k0 - 1.2) < 1e-9);
  const still = setup({ reducedMotion: true });
  const k1 = still.view.cam.k;
  still.view.zoomIn();
  assert.ok(Math.abs(still.view.cam.k / k1 - 1.2) < 1e-9, "jumps at once");
});

test("a data refresh keeps the selection; hover is reported for the mouse", () => {
  const { view, events, fire, at, tap } = setup();
  tap(...at("r2"));
  view.setNetwork({ ...NETWORK, readings: NETWORK.readings.slice(0, 4) });
  assert.equal(view.selectedId, "r2");
  fire("pointermove", ...at("r1"), { buttons: 0, pointerId: 7 });
  assert.deepEqual(events.at(-1), ["hover", { id: "r1" }]);
  fire("pointerleave", 0, 0, { buttons: 0, pointerId: 7 });
  assert.deepEqual(events.at(-1), ["hover", { id: null }]);
});
