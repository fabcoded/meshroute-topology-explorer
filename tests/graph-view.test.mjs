// SPDX-License-Identifier: MIT
// Tests of the map view (spec 9.2, 9.3) in a fake-event harness: synthetic pointer, wheel, key and context-menu
// events on a fake canvas, a fake clock and frames; checks the emitted events, pinning, pan and zoom, hit areas.
// node --test "tests/**/*.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import { GraphView } from "../custom_components/meshroute_topology_explorer/frontend/graph/graph-view.js";
import { hitRadius, MARKERS, MIN_HIT } from "../custom_components/meshroute_topology_explorer/frontend/graph/renderer.js";
import { FakeCanvas, fakeEnv, domEvent, labelWidth } from "./graph-fakes.mjs";

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
  const K = view.layout.K; // events carry base lengths
  assert.ok(Math.abs(pin[1].x * K - (before.x + 40 / k)) < 1e-6 && Math.abs(pin[1].y * K - (before.y + 30 / k)) < 1e-6);
  const now = view.layout.position("r1");
  assert.ok(Math.abs(now.x - pin[1].x * K) < 1e-9 && Math.abs(now.y - pin[1].y * K) < 1e-9, "stays after the layout settles again");
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

test("density: an overview stays fitted; a zoomed view keeps its zoom; pinned devices scale with the map", () => {
  const { view, at, tap } = setup();
  view.pin("r2", 1, -2);
  const K = view.layout.K;
  view.setDensity(1.5);
  assert.equal(view.autoFit, true, "the overview is refitted");
  assert.ok(Math.abs(view.layout.K / K - 1.5) < 1e-12);
  assert.deepEqual(view.layout.position("r2"), { x: view.layout.K, y: -2 * view.layout.K });
  view.zoomBy(2, { animate: false });
  tap(...at("r1"));
  const k = view.cam.k;
  const before = at("r1");
  view.setDensity(0.7);
  assert.equal(view.cam.k, k, "same zoom: the map tightens on screen");
  const after = at("r1");
  assert.ok(Math.hypot(after[0] - before[0], after[1] - before[1]) < 1e-6, "the selection stays where it was");
});

/** Median distance from each mesh device to its nearest neighbour on screen, as the working scale defines it. */
function medianNearest(view) {
  const ids = [...view.pos.mesh.keys()].filter((i) => view.pos.mesh[i]);
  const d = ids.map((i) => Math.min(...ids.filter((j) => j !== i)
    .map((j) => Math.hypot(view.pos.x[j] - view.pos.x[i], view.pos.y[j] - view.pos.y[i]))) * view.cam.k)
    .sort((a, b) => a - b);
  const m = d.length >> 1;
  return d.length % 2 ? d[m] : (d[m - 1] + d[m]) / 2;
}

test("reveal with zoom goes to the working scale: median nearest-neighbour distance = D x mean label width", () => {
  for (const density of [0.7, 1, 1.5]) {
    const canvas = new FakeCanvas(240, 180); // small: the overview is below the working scale
    const env = fakeEnv();
    const view = new GraphView(canvas, { env, density });
    view.setNetwork(NETWORK);
    env.flush();
    assert.ok(view.fitK < view.workingZoom);
    view.reveal("e1", { right: 40 }, { zoom: true, animate: false });
    const meanLabel = view.scene.labels.reduce((s, l) => s + labelWidth(l), 0) / view.scene.labels.length;
    assert.ok(Math.abs(medianNearest(view) - density * meanLabel) < 1e-6, `D=${density}`);
    const i = view.scene.index.get("e1");
    const [x, y] = [(view.pos.x[i] - view.cam.cx) * view.cam.k + 120, (view.pos.y[i] - view.cam.cy) * view.cam.k + 90];
    assert.ok(Math.abs(x - 100) < 1e-6 && Math.abs(y - 90) < 1e-6, "centred in the part the drawer leaves free");
  }
  // A large canvas already shows more room than the working scale: revealing does not zoom out past the overview.
  const { view } = setup();
  const fit = view.cam.k;
  view.reveal("e1", {}, { zoom: true, animate: false });
  assert.equal(view.cam.k, Math.max(view.workingZoom, fit));
});

test("the selection is kept clear of the drawer; double click and Enter zoom to the working scale", () => {
  const { canvas, env, view, events, at, tap, advanceTime } = setup();
  tap(...at("r2"));
  view.setInsets({ right: 760 }); // a drawer over almost everything: ignored, there is no room left
  env.flush();
  view.setInsets({ right: 500 });
  env.flush();
  const [x] = at("r2");
  assert.ok(x <= 800 - 500 - 48 + 1e-6, `r2 at ${x} is left of the drawer`);
  advanceTime(1000);
  tap(...at("c"));
  tap(...at("c"));
  env.flush();
  const target = Math.max(view.workingZoom, view.fitK);
  assert.ok(Math.abs(view.cam.k - target) < 1e-9, "double click: working scale (not below the overview)");
  assert.equal(events.filter((e) => e[0] === "pin-change").length, 0, "nothing was pinned, nothing released");
  view.fit({ animate: false });
  canvas.dispatchEvent(domEvent("keydown", { key: "Enter", timeStamp: 9000 }));
  env.flush();
  assert.ok(Math.abs(view.cam.k - target) < 1e-9, "Enter: working scale");
});

test("a hidden canvas keeps its buffer and draws nothing; a new pixel ratio resizes it", () => {
  const canvas = new FakeCanvas(800, 600);
  const env = fakeEnv();
  let ratio = 2;
  let notify = null;
  env.devicePixelRatio = () => ratio;
  env.watchResolution = (fn) => { notify = fn; return () => { notify = null; }; };
  const view = new GraphView(canvas, { env });
  view.setNetwork(NETWORK);
  env.flush();
  assert.equal(canvas.width, 1600);
  canvas.clientWidth = 0; // display: none
  canvas.clientHeight = 0;
  for (let i = 0; i < 3; i++) view.resize();
  assert.equal(canvas.width, 1600, "the buffer is left alone while hidden");
  const drawn = canvas.ctx.calls.length;
  view.zoomIn();
  env.flush();
  assert.equal(canvas.ctx.calls.length, drawn, "no drawing while hidden");
  canvas.clientWidth = 800;
  canvas.clientHeight = 600;
  view.resize();
  env.flush();
  assert.ok(canvas.ctx.calls.length > drawn, "drawing resumes");
  ratio = 3;
  notify();
  assert.equal(canvas.width, 2400);
  view.destroy();
  assert.equal(notify, null, "destroy stops watching");
});

test("an empty network and one without any readings draw without errors", () => {
  const canvas = new FakeCanvas(400, 300);
  const env = fakeEnv();
  const view = new GraphView(canvas, { env });
  view.setNetwork({ source: "zha", id: "empty", devices: [], readings: [] });
  env.flush();
  assert.equal(view.layout.settled, true);
  view.setNetwork({ source: "zha", id: "lonely", devices: [{ id: "a", role: "router" }, { id: "b", role: "bogus" }],
    readings: [] });
  env.flush();
  assert.deepEqual(view.layout.ringIds(), ["a", "b"]);
  const pa = view.layout.position("a");
  const pb = view.layout.position("b");
  assert.ok(Math.hypot(pa.x - pb.x, pa.y - pb.y) > 0, "apart on the ring");
  assert.equal(view.scene.nodes[1].role, "unknown", "an unknown role is drawn as unknown");
});
