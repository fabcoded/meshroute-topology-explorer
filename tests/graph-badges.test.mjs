// SPDX-License-Identifier: MIT
// The entry badges of the path history (spec 9.5, board M36 E): shown at every other device while one is selected, off
// without a selection or when switched off, hover and tap on a badge (the selection stays, the pair window is asked
// for), a tap beside it behaves as before. Fake canvas and clock. npm test
import test from "node:test";
import assert from "node:assert/strict";
import { GraphView } from "../custom_components/meshroute_topology_explorer/frontend/graph/graph-view.js";
import { BADGE, badgeCentre } from "../custom_components/meshroute_topology_explorer/frontend/graph/renderer.js";
import { symbolSize } from "../custom_components/meshroute_topology_explorer/frontend/graph/symbols.js";
import { FakeCanvas, asZigbee, fakeEnv, domEvent } from "./graph-fakes.mjs";

const NETWORK = asZigbee({ source: "zha", id: "t", devices: [
  { id: "c", role: "coordinator", label: "Coordinator", available: true, rating: null },
  { id: "r1", role: "router", label: "Hall lamp", available: true, rating: 0.8 },
  { id: "e1", role: "end device", label: "Door sensor", available: true, rating: 0.1 }],
readings: [{ reporter: "c", subject: "r1", lqi: 200 }, { reporter: "r1", subject: "c", lqi: 180 }, { reporter: "r1", subject: "e1", lqi: 90 }] });

function setup() {
  const canvas = new FakeCanvas(800, 600);
  const env = fakeEnv({ dpr: 1 });
  const view = new GraphView(canvas, { env });
  view.setNetwork(NETWORK);
  env.flush();
  const events = [];
  for (const type of ["select", "pair-history", "badge-hover"]) view.addEventListener(type, (e) => events.push([type, e.detail]));
  let time = 1000;
  const fire = (type, x, y, extra = {}) => canvas.dispatchEvent(domEvent(type, { pointerId: 1, clientX: x, clientY: y, timeStamp: (time += 10),
    button: 0, buttons: extra.buttons ?? 1, pointerType: "mouse", ...extra }));
  const at = (id) => view._screenOf(view.scene.index.get(id));
  const badge = (id) => badgeCentre(...at(id), symbolSize(view.cam.k));
  const tap = (x, y) => { fire("pointerdown", x, y); fire("pointerup", x, y, { buttons: 0 }); env.advance(500); };
  return { canvas, env, view, events, fire, at, badge, tap };
}

test("badges exist only with a selection and only while switched on", () => {
  const { view, tap, at, badge } = setup();
  view.setPairBadges(true);
  assert.equal(view._badgeAt(...badge("r1")), -1, "nothing selected: no badge");
  tap(...at("c"));
  const r1 = view.scene.index.get("r1");
  assert.equal(view._badgeAt(...badge("r1")), r1);
  assert.equal(view._badgeAt(...badge("c")), -1, "the selected device has none");
  view.setPairBadges(false);
  assert.equal(view._badgeAt(...badge("r1")), -1, "switched off (non-administrators)");
});

test("hover over a badge dims the device hover and reports the badge; leaving reports null", () => {
  const { view, tap, at, badge, fire, events } = setup();
  view.setPairBadges(true);
  tap(...at("c"));
  const [bx, by] = badge("r1");
  fire("pointermove", bx, by, { buttons: 0 });
  const hover = events.filter(([type]) => type === "badge-hover").at(-1)[1];
  assert.deepEqual([hover.id, Math.round(hover.x), Math.round(hover.y)], ["r1", Math.round(bx), Math.round(by)]);
  fire("pointermove", 5, 5, { buttons: 0 });
  assert.equal(events.filter(([type]) => type === "badge-hover").at(-1)[1].id, null);
  assert.ok(BADGE.hit >= 10, "a hit area a finger can find");
});

test("a tap on a badge asks for the pair and keeps the selection; a tap on the device itself still selects", () => {
  const { view, tap, at, badge, events } = setup();
  view.setPairBadges(true);
  tap(...at("c"));
  tap(...badge("e1"));
  const asked = events.filter(([type]) => type === "pair-history");
  assert.deepEqual(asked.map(([, d]) => d), [{ a: "c", b: "e1" }]);
  assert.equal(view.selectedId, "c");
  tap(...at("r1"));
  assert.equal(view.selectedId, "r1");
});

test("the frame draws one badge per other device with a selection, none without", () => {
  const { view, canvas, tap, at, env } = setup();
  view.setPairBadges(true);
  const arcsAtBadge = () => canvas.ctx.calls.filter((c) => c[0] === "arc" && c[3] === BADGE.r).length;
  view.draw(); canvas.ctx.calls.length = 0; view.draw();
  assert.equal(arcsAtBadge(), 0);
  tap(...at("c")); env.flush(); canvas.ctx.calls.length = 0; view.draw();
  const visible = ["r1", "e1"].filter((id) => { const [x, y] = at(id); return x > -40 && x < 840 && y > -40 && y < 640; }).length;
  assert.ok(visible >= 1);
  assert.equal(arcsAtBadge(), visible, "one per other device on screen");
});
