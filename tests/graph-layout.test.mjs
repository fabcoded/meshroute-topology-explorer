// SPDX-License-Identifier: MIT
// Tests of the quality-view layout (spec 7.1, 12): spring curve, determinism, fidelity on the sample in every
// density, speed on a synthetic network, the ring of devices without readings, pinning, Barnes-Hut.
// node --test "tests/**/*.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  Layout, DENSITY, SETTLE_MOVE, springFactor, baseLength, seededRandom,
} from "../custom_components/meshroute_topology_explorer/frontend/graph/layout.js";
import { buildQuadtree, quadtreeForce } from "../custom_components/meshroute_topology_explorer/frontend/graph/quadtree.js";
import { displayLabels } from "../custom_components/meshroute_topology_explorer/frontend/graph/labels.js";
import { NODE_DIAMETER } from "../custom_components/meshroute_topology_explorer/frontend/graph/renderer.js";
import { zhaToNetwork } from "../dev/zha-network.js";
import { syntheticNetwork } from "../dev/synthetic-network.js";
import { fidelity, spearman } from "../dev/fidelity.js";

const sample = zhaToNetwork(JSON.parse(readFileSync(new URL("./fixtures/zha-sample.json", import.meta.url), "utf8")));
const measure = (text) => text.length * 7; // fixed character width instead of a canvas
const l0Of = (network) => baseLength(displayLabels(network.devices, measure), measure, NODE_DIAMETER);
const report = (t, msg) => (t.diagnostic ? t.diagnostic(msg) : console.log(msg));

test("spring factor follows f(q) = 1 + 5 (1 - q)^2, unknown 1.5", () => {
  assert.equal(springFactor(255), 1);
  assert.equal(springFactor(127.5), 1 + 5 * 0.25);
  assert.ok(Math.abs(springFactor(1) - (1 + 5 * (254 / 255) ** 2)) < 1e-12);
  for (const unknown of [0, null, undefined, NaN, "157", -3]) assert.equal(springFactor(unknown), 1.5);
  for (let v = 1; v < 255; v++) assert.ok(springFactor(v) > springFactor(v + 1), "strictly falling");
});

test("L0 is node diameter plus mean label width, with an injected measure", () => {
  assert.equal(baseLength(["ab", "abcd"], measure, 16), 16 + 21);
  assert.equal(baseLength([], measure, 16), 16);
});

test("same network and seed give the same layout, whatever the input order; another seed differs", () => {
  const a = new Layout(sample, { baseLength: 90, seed: 3 });
  a.run();
  const rnd = seededRandom(99);
  const shuffle = (list) => list.map((v) => [rnd(), v]).sort((p, q) => p[0] - q[0]).map((p) => p[1]);
  const b = new Layout({ ...sample, devices: shuffle(sample.devices), readings: shuffle(sample.readings) },
    { baseLength: 90, seed: 3 });
  b.run();
  assert.deepEqual([...a.x], [...b.x]);
  assert.deepEqual([...a.y], [...b.y]);
  const c = new Layout(sample, { baseLength: 90, seed: 4 });
  c.run();
  assert.notDeepEqual([...a.x], [...c.x]);
});

test("fidelity on the sample: rank correlation of drawn length and LQI <= -0.75 in every density (seed 1)", (t) => {
  const l0 = l0Of(sample);
  for (const [name, d] of Object.entries(DENSITY)) {
    const layout = new Layout(sample, { baseLength: l0, density: d, seed: 1 });
    layout.run();
    const rho = fidelity(layout);
    report(t, `fidelity ${name} (D=${d}, L0=${l0.toFixed(1)}): ${rho.toFixed(3)} after ${layout.steps} steps`);
    assert.ok(layout.lastMove < SETTLE_MOVE, "settled by movement, not by the step budget");
    assert.ok(layout.temperature > SETTLE_MOVE, "by balance: the cooling cap was not what stopped it");
    assert.ok(rho <= -0.75, `${name}: ${rho}`);
  }
});

test("Spearman helper: perfect, inverse and tied ranks", () => {
  assert.equal(spearman([1, 2, 3], [10, 20, 30]), 1);
  assert.equal(spearman([1, 2, 3], [30, 20, 10]), -1);
  assert.ok(Math.abs(spearman([1, 1, 2, 3], [1, 2, 3, 4]) - 0.9486832980505138) < 1e-12);
});

test("speed: 300 devices and 3 000 readings settle within 5 s", (t) => {
  const net = syntheticNetwork({ devices: 300, readings: 3000, seed: 7 });
  assert.equal(net.devices.length, 300);
  assert.equal(net.readings.length, 3000);
  const start = performance.now();
  const layout = new Layout(net, { baseLength: l0Of(net), seed: 1 });
  layout.run();
  const ms = performance.now() - start;
  report(t, `synthetic 300/3000: settled in ${ms.toFixed(0)} ms, ${layout.steps} steps, ` +
    `largest last move ${layout.lastMove.toFixed(3)}, fidelity ${fidelity(layout).toFixed(3)}`);
  assert.ok(layout.lastMove < SETTLE_MOVE, "settled by movement, not by the step budget");
  assert.ok(layout.temperature > SETTLE_MOVE, "by balance: the cooling cap was not what stopped it");
  assert.ok(ms < 5000, `${ms} ms`);
});

test("devices without readings sit evenly on a ring just outside the mesh, in id order from the top", () => {
  const net = {
    devices: ["a", "b", "c", "d", "x3", "x1", "x2"].map((id) => ({ id })),
    readings: [
      { reporter: "a", subject: "b", lqi: 200 }, { reporter: "b", subject: "c", lqi: 90 },
      { reporter: "c", subject: "d", lqi: 0 }, { reporter: "d", subject: "a", lqi: null },
      { reporter: "a", subject: "ghost", lqi: 50 }, // unknown device: ignored, does not make "a" special
    ],
  };
  const layout = new Layout(net, { baseLength: 80, seed: 2 });
  layout.run();
  assert.deepEqual(layout.ringIds(), ["x1", "x2", "x3"]);
  const { x: cx, y: cy, r } = layout.ringCentre;
  const meshReach = Math.max(...layout.meshIds().map((id) => {
    const p = layout.position(id);
    return Math.hypot(p.x - cx, p.y - cy);
  }));
  const angles = layout.ringIds().map((id) => {
    const p = layout.position(id);
    assert.ok(Math.abs(Math.hypot(p.x - cx, p.y - cy) - r) < 1e-9, "on the ring");
    return Math.atan2(p.y - cy, p.x - cx);
  });
  assert.ok(r > meshReach && r <= meshReach + layout.K + 1e-9, "just outside the mesh");
  assert.ok(Math.abs(angles[0] + Math.PI / 2) < 1e-9, "first one at the top");
  const step = (2 * Math.PI) / 3;
  for (let i = 1; i < angles.length; i++) {
    const gap = (angles[i] - angles[i - 1] + 2 * Math.PI) % (2 * Math.PI);
    assert.ok(Math.abs(gap - step) < 1e-9, "evenly spaced");
  }
});

test("pinned devices stay where they are, the others still settle", () => {
  const ids = sample.devices.map((d) => d.id).sort();
  const pinned = new Map([[ids[1], { x: 500, y: -300 }], [ids[5], { x: -200, y: 40 }]]);
  const layout = new Layout(sample, { baseLength: 90, seed: 1, pinned });
  layout.run();
  for (const [id, p] of pinned) {
    assert.deepEqual(layout.position(id), p);
    assert.ok(layout.isPinned(id));
  }
  // Pin after settling, reheat: the pinned device keeps its place, its neighbours move.
  const before = ids.map((id) => layout.position(id));
  layout.pin(ids[10], 900, 900);
  layout.reheat();
  layout.run();
  assert.deepEqual(layout.position(ids[10]), { x: 900, y: 900 });
  assert.ok(ids.some((id, i) => id !== ids[10] && !pinned.has(id) &&
    Math.hypot(layout.position(id).x - before[i].x, layout.position(id).y - before[i].y) > 1));
  layout.unpin(ids[10]);
  assert.equal(layout.isPinned(ids[10]), false);
});

test("duplicate readings keep the better value; self and unknown readings are dropped", () => {
  const layout = new Layout({
    devices: [{ id: "a" }, { id: "b" }],
    readings: [
      { reporter: "a", subject: "b", lqi: 0 }, { reporter: "a", subject: "b", lqi: 180 },
      { reporter: "a", subject: "b", lqi: 20 }, { reporter: "a", subject: "a", lqi: 255 },
      { reporter: "b", subject: "z", lqi: 255 }, null,
    ],
  }, { baseLength: 100 });
  assert.equal(layout.rest.length, 1);
  assert.equal(layout.springLqi[0], 180);
  assert.equal(layout.rest[0], 100 * springFactor(180));
});

test("Barnes-Hut: exact at theta 0, and a forced Barnes-Hut layout still settles faithfully", () => {
  const rnd = seededRandom(5);
  const xs = Float64Array.from({ length: 200 }, () => rnd() * 1000);
  const ys = Float64Array.from({ length: 200 }, () => rnd() * 1000);
  const idx = [...xs.keys()];
  const tree = buildQuadtree(idx, xs, ys);
  for (const i of [0, 17, 199]) {
    let ex = 0; let ey = 0;
    for (const j of idx) {
      if (j === i) continue;
      const dx = xs[i] - xs[j]; const dy = ys[i] - ys[j]; const d2 = dx * dx + dy * dy;
      ex += (dx * 50) / d2; ey += (dy * 50) / d2;
    }
    const [fx, fy] = quadtreeForce(tree, i, xs[i], ys[i], 50, 0);
    assert.ok(Math.abs(fx - ex) < 1e-9 && Math.abs(fy - ey) < 1e-9);
    const [ax, ay] = quadtreeForce(tree, i, xs[i], ys[i], 50, 0.8);
    assert.ok(Math.hypot(ax - ex, ay - ey) < 0.1 * Math.hypot(ex, ey) + 1e-6, "approximation within 10 %");
  }
  const net = syntheticNetwork({ devices: 300, readings: 3000, seed: 7 });
  const layout = new Layout(net, { baseLength: l0Of(net), seed: 1, params: { exactBelow: 0 } });
  layout.run();
  assert.ok(layout.lastMove < SETTLE_MOVE);
  assert.ok(fidelity(layout) <= -0.75);
});
