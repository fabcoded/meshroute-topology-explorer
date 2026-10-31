// SPDX-License-Identifier: MIT
// Loader of dev/graph.html (not shipped): builds a Network with the data model (buildNetwork) from the sample capture
// or a chosen capture file, or takes the synthetic test network, and wires the switches to a GraphView.
// See dev/graph.html for how to serve and the query keys.

import { GraphView } from "../custom_components/meshroute_topology_explorer/frontend/graph/graph-view.js";
import { LIGHT, DARK } from "../custom_components/meshroute_topology_explorer/frontend/graph/palette.js";
import { buildNetwork } from "../custom_components/meshroute_topology_explorer/frontend/model/index.js";
import { syntheticNetwork } from "../tests/synthetic-network.mjs";

const q = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const log = (text) => { $("log").textContent = text; };

function applyTheme(dark) {
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  return dark ? DARK : LIGHT;
}

const dark = q.get("theme") === "dark";
$("dark").checked = dark;
const density = Number(q.get("density")) || 1;
$("density").value = String(density);
$("debug").checked = q.get("debug") === "1";

const view = new GraphView($("map"), {
  theme: applyTheme(dark), density, debug: $("debug").checked, seed: Number(q.get("seed")) || 1,
});

// A stand-in for the panel's drawer, so reveal() can be seen keeping the selection clear of it.
const drawer = Number(q.get("drawer")) || 0;
if (drawer) {
  $("drawer").hidden = false;
  $("drawer").style.width = `${drawer}px`;
  view.setInsets({ right: drawer });
}

/** Network from a capture: { responses: { "zha/devices": ..., ... } } as written by tools/anonymize_capture.py. */
function fromCapture(capture) {
  const r = capture.responses || capture;
  return buildNetwork(r["zha/devices"], { deviceRegistry: r["config/device_registry/list"],
    areaRegistry: r["config/area_registry/list"], configEntries: r["config_entries/get"] });
}

function findId(network, key) {
  if (!key) return null;
  const d = network.devices.find((x) => x.id === key || x.label === key);
  return d ? d.id : null;
}

function settle() {
  while (!view.layout.settled) view.layout.run({ budgetMs: 50 });
  view._sync();
}

function show(network) {
  view.setNetwork(network);
  const pinId = findId(network, q.get("pin"));
  if (pinId) {
    // Demonstrate a pinned device: settle first, then move it a little and pin it there.
    settle();
    const at = view.layout.position(pinId);
    const K = view.layout.K; // pin() takes base lengths
    view.pin(pinId, (at.x + 120) / K, (at.y - 80) / K);
  }
  const selectId = findId(network, q.get("select"));
  view.select(selectId);
  if (selectId && q.get("reveal") === "1") {
    settle();
    view.reveal(selectId, view.insets, { zoom: true, animate: false });
  }
  const zoom = Number(q.get("zoom"));
  if (zoom) view.zoomBy(zoom, { animate: false });
  log(`${network.devices.length} devices, ${network.readings.length} readings`);
  if (q.get("bench") === "1") bench(network);
  else if (q.get("stats") === "1") stats(network);
}

/** After the layout settles: what the frame shows (lines, labels placed and left out), for the report. */
function stats(network) {
  settle();
  view.fit({ animate: false });
  view.draw();
  const s = view.lastDraw;
  log(`${network.devices.length} devices, ${view.scene.pairs.length} pairs; lines ${s.lines}, ` +
    `lanes ${s.lanes}, labels ${s.labels}, left out ${s.dropped}, zoom ${view.cam.k.toFixed(3)}, ` +
    `working zoom ${view.workingZoom.toFixed(3)}`);
}

/** Pan in 60 steps and time each full frame (spec 12: 30 frames per second while panning). */
function bench(network) {
  settle();
  view.draw(); // warm-up: the first frame pays for fonts and caches
  const times = [];
  for (let i = 0; i < 60; i++) {
    view.cam = { ...view.cam, cx: view.cam.cx + 5 / view.cam.k };
    const t0 = performance.now();
    view.draw();
    view.ctx.getImageData(0, 0, 1, 1); // wait until the frame is really drawn, not just queued
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  log(`${network.devices.length} devices, ${network.readings.length} readings; pan: draw median ` +
    `${times[30].toFixed(1)} ms, 90th percentile ${times[54].toFixed(1)} ms over 60 frames (dpr ${devicePixelRatio})`);
}

async function loadInitial() {
  const n = Number(q.get("synthetic"));
  if (n) return syntheticNetwork({ devices: n, readings: n * 10 });
  const res = await fetch("../tests/fixtures/zha-sample.json");
  return fromCapture(await res.json());
}

loadInitial().then(show, (err) => log(`Could not load the sample: ${err}`));

$("density").addEventListener("change", (e) => view.setDensity(Number(e.target.value)));
$("debug").addEventListener("change", (e) => view.setDebug(e.target.checked));
$("dark").addEventListener("change", (e) => view.setTheme(applyTheme(e.target.checked)));
$("zoom-in").addEventListener("click", () => view.zoomIn());
$("zoom-out").addEventListener("click", () => view.zoomOut());
$("fit").addEventListener("click", () => view.fit());
$("file").addEventListener("change", async (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  try {
    show(fromCapture(JSON.parse(await file.text())));
  } catch (err) {
    log(`Not a capture: ${err}`);
  }
});
for (const type of ["select", "details-request", "hover", "pin-change"]) {
  view.addEventListener(type, (e) => log(`${type} ${JSON.stringify(e.detail)}`));
}
