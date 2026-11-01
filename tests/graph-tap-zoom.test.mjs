// SPDX-License-Identifier: MIT
// A tap on the map zooms to the working scale only when the selection's focus lanes would be shorter than
// TAP_ZOOM_MIN_LANE on screen (spec 9.3, owner decision 2026-11-01); hover never zooms; no focus lane is skipped
// afterwards. Uses the sample at a phone and a desktop size, stages 1 and 2.
// node --test tests/
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildNetwork } from "../custom_components/meshroute_topology_explorer/frontend/model/index.js";
import { GraphView, TAP_ZOOM_MIN_LANE } from "../custom_components/meshroute_topology_explorer/frontend/graph/graph-view.js";
import { shortestFocusLane } from "../custom_components/meshroute_topology_explorer/frontend/graph/renderer.js";
import { FakeCanvas, fakeEnv, domEvent } from "./graph-fakes.mjs";

const r = JSON.parse(readFileSync(new URL("./fixtures/zha-sample.json", import.meta.url), "utf8")).responses;
const network = buildNetwork(r["zha/devices"], { deviceRegistry: r["config/device_registry/list"],
  areaRegistry: r["config/area_registry/list"], configEntries: r["config_entries/get"] });

/** A view of the sample on a w x h canvas (no animation) and a tap on a device by label. */
function setup(w, h, paths = "coordinator") {
  const canvas = new FakeCanvas(w, h);
  const env = fakeEnv({ dpr: 1, reducedMotion: true });
  const view = new GraphView(canvas, { env, engineView: { paths } });
  view.setNetwork(network);
  env.flush();
  let t = 1000;
  const fire = (type, x, y, extra = {}) => canvas.dispatchEvent(domEvent(type, { pointerId: 1, clientX: x, clientY: y,
    timeStamp: (t += 10), button: 0, buttons: 1, pointerType: "touch", deltaY: 0, deltaMode: 0, ...extra }));
  const device = (label) => network.devices.find((d) => d.label === label).id;
  const tap = (label) => {
    const i = view.scene.index.get(device(label));
    const { k, cx, cy } = view.cam;
    const x = (view.pos.x[i] - cx) * k + view.width / 2;
    const y = (view.pos.y[i] - cy) * k + view.height / 2;
    fire("pointerdown", x, y);
    fire("pointerup", x, y, { buttons: 0 });
    env.flush();
  };
  return { view, tap, device, fire };
}

test("phone: a tap on Router 03 zooms to the working scale, no focus lane is skipped", () => {
  for (const paths of ["coordinator", "all"]) {
    const { view, tap, device } = setup(390, 844, paths);
    const fit = view.cam.k;
    assert.ok(shortestFocusLane(view, view.scene.index.get(device("Router 03")), view.cam) < TAP_ZOOM_MIN_LANE);
    tap("Router 03");
    assert.equal(view.selectedId, device("Router 03"));
    assert.ok(view.cam.k > fit);
    assert.equal(view.cam.k, Math.max(view.workingZoom, view.fitK), paths);
    const len = shortestFocusLane(view, view.selected, view.cam);
    assert.ok(len >= 4, `${paths}: shortest lane ${len} (laneGeometry would drop it below 4)`);
  }
});

test("desktop 1280: a tap on End device 06 keeps the camera (lanes already readable)", () => {
  for (const paths of ["coordinator", "all"]) {
    const { view, tap } = setup(1280, 800, paths);
    const k = view.cam.k;
    tap("End device 06");
    assert.ok(view.selected >= 0);
    assert.equal(view.cam.k, k, paths); // the zoom stays; the usual reveal may pan it clear of the edge
  }
});

test("in a narrow view a tap on a readable device keeps the zoom; hover never zooms", () => {
  const { view, tap, fire } = setup(390, 844);
  const cam = { ...view.cam };
  // End device 07 has long focus lanes even at the phone's fit zoom: readable, so no zoom (the reveal may pan).
  tap("End device 07");
  assert.ok(view.selected >= 0);
  assert.equal(view.cam.k, cam.k);
  tap("Router 07"); // no focus lanes at all: nothing to read, nothing to zoom for
  assert.equal(view.cam.k, cam.k);
  view.fit({ animate: false });
  view.select(null);
  const cam0 = { ...view.cam };
  const i = view.scene.index.get(network.devices.find((d) => d.label === "Router 03").id);
  const { k, cx, cy } = view.cam;
  fire("pointermove", (view.pos.x[i] - cx) * k + view.width / 2, (view.pos.y[i] - cy) * k + view.height / 2,
    { pointerType: "mouse", buttons: 0 });
  assert.deepEqual(view.cam, cam0, "hover leaves the camera alone");
});
