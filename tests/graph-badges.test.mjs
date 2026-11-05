// SPDX-License-Identifier: MIT
// The entry badges of the path history (spec 9.5, board M36 E): shown at every other device while one is selected, off
// without a selection or when switched off, hover and tap on a badge (the selection stays, the pair window is asked
// for), a tap beside it behaves as before. Fake canvas and clock. npm test
import test from "node:test";
import assert from "node:assert/strict";
import { GraphView } from "../custom_components/meshroute_topology_explorer/frontend/graph/graph-view.js";
import { BADGE, badgeCentre, pillAt, PILL_HIT } from "../custom_components/meshroute_topology_explorer/frontend/graph/renderer.js";
import { symbolSize } from "../custom_components/meshroute_topology_explorer/frontend/graph/symbols.js";
import { FakeCanvas, asZigbee, fakeEnv, domEvent } from "./graph-fakes.mjs";

const NETWORK = asZigbee({ source: "zha", id: "t", devices: [
  { id: "c", role: "coordinator", label: "Coordinator", available: true, rating: null },
  { id: "r1", role: "router", label: "Hall lamp", available: true, rating: 0.8 },
  { id: "e1", role: "end device", label: "Door sensor", available: true, rating: 0.1, parent: "r1", parentLqi: 90 }],
readings: [{ reporter: "c", subject: "r1", lqi: 200 }, { reporter: "r1", subject: "c", lqi: 180 }, { reporter: "r1", subject: "e1", lqi: 90 }] });

function setup() {
  const canvas = new FakeCanvas(800, 600);
  const env = fakeEnv({ dpr: 1 });
  const view = new GraphView(canvas, { env });
  view.setNetwork(NETWORK);
  env.flush();
  const events = [];
  for (const type of ["select", "pair-history", "badge-hover", "pill-click", "map-tap"]) view.addEventListener(type, (e) => events.push([type, e.detail]));
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

// ---- value pills (owner 2026-11-05): a click on any drawn pill opens the pair window ----------------------------------

test("the frame reports every drawn pill; the hit area is at least 24 px around it", () => {
  const { view, tap, at, env } = setup();
  view.setPairBadges(true);
  tap(...at("e1")); env.flush(); view.draw();
  const pills = view.lastDraw.pills;
  assert.ok(pills.length >= 1, "the selection's lanes carry pills");
  const p = pills[0];
  assert.equal(pillAt(pills, p.x + Math.max(p.w / 2, 12) - 0.5, p.y), p, "inside the 24 px reach");
  assert.equal(pillAt(pills, p.x + Math.max(p.w / 2, 12) + 20, p.y + 40), null, "beyond it");
  assert.equal(pillAt(pills, p.x, p.y + 11.5), p, "even above a 16 px tall pill the reach is 12 px each way");
  assert.ok(PILL_HIT >= 24);
});

test("a tap on a pill asks for its card (both devices, the pill's place) and leaves the selection; hover shows a pointer and reports the pair", () => {
  const { view, tap, at, env, fire, events, canvas } = setup();
  view.setPairBadges(true);
  const hovers = [];
  view.addEventListener("pill-hover", (e) => hovers.push(e.detail));
  tap(...at("e1")); env.flush(); view.draw();
  const p = view.lastDraw.pills.find((q) => q.pair.map((i) => view.scene.nodes[i].id).includes("e1"));
  fire("pointermove", p.x, p.y, { buttons: 0 });
  assert.equal(canvas.style.cursor, "pointer");
  assert.deepEqual(hovers.at(-1), { a: "e1", b: "r1" }, "the selected device first");
  events.length = 0;
  tap(p.x, p.y);
  assert.deepEqual(events.filter(([type]) => type === "pill-click").map(([, d]) => d), [{ a: "e1", b: "r1", x: p.x, y: p.y }]);
  assert.equal(events.filter(([type]) => type === "pair-history" || type === "select" || type === "map-tap").length, 0, "no window, no selection change");
  assert.equal(view.selectedId, "e1", "the selection stays");
  tap(5, 5);
  assert.equal(events.filter(([type]) => type === "map-tap").length, 1, "a tap on the empty map is reported (closes the card)");
  fire("pointermove", 3, 3, { buttons: 0 });
  assert.deepEqual(hovers.at(-1), { a: null, b: null });
  view.setPairBadges(false);
  fire("pointermove", p.x, p.y, { buttons: 0 });
  assert.equal(view._pillAt(p.x, p.y, -1), null, "non-administrators: no pill target");
});

test("pairLinks gives both directions of a pair as the pills show them, the hearer's value and rank", () => {
  const { view } = setup();
  const [aHearsB, bHearsA] = view.pairLinks("c", "r1");
  assert.deepEqual([aHearsB.sender, aHearsB.hearer, aHearsB.lqi, bHearsA.sender, bHearsA.hearer, bHearsA.lqi], ["r1", "c", 200, "c", "r1", 180]);
  assert.equal(aHearsB.text, "200");
});
