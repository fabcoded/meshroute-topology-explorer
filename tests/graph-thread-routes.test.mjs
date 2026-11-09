// SPDX-License-Identifier: MIT
// Thread routes on the drawn map (#11, owner rule: every value readable, never silently hidden; board M38): with a
// route selected, no two value pills intersect and no hop number sits on a pill, at the default and the densest
// preset, for the M38-shaped sample (the motion sensor; plug 1 with unused routes on) and the owner-shaped Atelier
// (Klima Flur; sofaunten with unused routes on), also on a phone 412 px wide. The graph view runs in Node on the fakes
// of graph-fakes.mjs. npm test
import test from "node:test";
import assert from "node:assert/strict";
import { GraphView } from "../custom_components/meshroute_topology_explorer/frontend/graph/graph-view.js";
import { DENSITY } from "../custom_components/meshroute_topology_explorer/frontend/graph/layout.js";
import { buildThreadNetwork } from "../custom_components/meshroute_topology_explorer/frontend/engines/thread/model.js";
import { FakeCanvas, fakeEnv } from "./graph-fakes.mjs";
import { idOf, threadRoutesSample } from "./thread-routes-fixture.mjs";

const overlap = (a, b) => Math.max(0, Math.min(a.x + a.w / 2, b.x + b.w / 2) - Math.max(a.x - a.w / 2, b.x - b.w / 2))
  * Math.max(0, Math.min(a.y + a.h / 2, b.y + b.h / 2) - Math.max(a.y - a.h / 2, b.y - b.h / 2));

function drawn(sample, density, key, engineView, width = 1400) {
  const network = buildThreadNetwork(sample.topology, { tables: sample.tables, deviceRegistry: sample.registry });
  const env = fakeEnv({ dpr: 1 });
  const view = new GraphView(new FakeCanvas(width, 860), { env, density });
  view.setNetwork(network);
  env.flush();
  view.setEngineView(engineView);
  view.selected = view.scene.index.get(idOf(key));
  view.draw();
  env.flush();
  return view.lastDraw;
}

const CASES = [["M38-shaped", threadRoutesSample(), [["XS", {}], ["P1", { unusedRoutes: true }]]],
  ["owner-shaped", threadRoutesSample({ atelier: true }), [["KF", {}], ["LU", { unusedRoutes: true }]]]];

for (const [name, sample, selections] of CASES) {
  for (const [densityName, density, width] of [["default", DENSITY.medium, 1400], ["dense", DENSITY.dense, 1400],
    ["phone 412 px", DENSITY.medium, 412]]) {
    for (const [key, engineView] of selections) {
      test(`#11 ${name}, ${densityName}, ${key}${engineView.unusedRoutes ? " with unused routes" : ""}: pills and hop numbers apart`, () => {
        const draw = drawn(sample, density, key, engineView, width);
        const pills = draw.pills;
        const route = draw.paths.values.filter((v) => v.cls === "route");
        assert.ok(route.length >= 2, "the route is drawn");
        // Every value of the route and of its unused alternatives is drawn; grey context values give way where there is
        // no room (Details list every neighbour with both directions).
        const own = draw.paths.values.filter((v) => v.cls === "route" || v.cls === "unused");
        assert.ok(own.every((v) => v.drawn && v.x !== null), own.filter((v) => !v.drawn).map((v) => `${v.s}>${v.h}`).join());
        if (engineView.unusedRoutes) assert.ok(draw.paths.values.some((v) => v.cls === "unused" && v.drawn));
        for (let a = 0; a < pills.length; a++) {
          for (let b = a + 1; b < pills.length; b++) {
            assert.equal(overlap(pills[a], pills[b]), 0, `pills ${JSON.stringify(pills[a])} and ${JSON.stringify(pills[b])}`);
          }
        }
        // No pill on a device symbol (rev11a: symbols are as hard as other values).
        for (let i = 0; i < draw.sx.length; i++) {
          const symbol = { x: draw.sx[i], y: draw.sy[i], w: draw.size, h: draw.size };
          for (const p of pills) assert.equal(overlap(symbol, p), 0, `a pill on device ${i}: ${JSON.stringify(p)}`);
        }
        assert.ok(draw.paths.numbers.length >= 1);
        for (const n of draw.paths.numbers) {
          for (const p of pills) assert.equal(overlap({ x: n.x, y: n.y, w: 14, h: 14 }, p), 0, `hop ${n.text} on a pill`);
        }
      });
    }
  }
}
