// SPDX-License-Identifier: MIT
// Loader of dev/graph.html (not shipped): builds a Network from the sample capture, a chosen capture file or a
// synthetic network, and wires the switches to a GraphView. See dev/graph.html for how to serve and the query keys.

import { GraphView } from "../custom_components/meshroute_topology_explorer/frontend/graph/graph-view.js";
import { LIGHT, DARK } from "../custom_components/meshroute_topology_explorer/frontend/graph/palette.js";
import { zhaToNetwork } from "./zha-network.js";
import { syntheticNetwork } from "./synthetic-network.js";

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

function findId(network, key) {
  if (!key) return null;
  const d = network.devices.find((x) => x.id === key || x.label === key);
  return d ? d.id : null;
}

function show(network) {
  view.setNetwork(network);
  const pinId = findId(network, q.get("pin"));
  if (pinId) {
    // Demonstrate a pinned device: settle first, then move it a little and pin it there.
    while (!view.layout.settled) view.layout.run({ budgetMs: 50 });
    const at = view.layout.position(pinId);
    const K = view.layout.K; // pin() takes base lengths
    view.pin(pinId, (at.x + 120) / K, (at.y - 80) / K);
  }
  view.select(findId(network, q.get("select")));
  const zoom = Number(q.get("zoom"));
  if (zoom) view.zoomBy(zoom, { animate: false });
  log(`${network.devices.length} devices, ${network.readings.length} readings`);
  if (q.get("bench") === "1") bench(network);
}

/** Pan in 60 steps and time each full frame (spec 12: 30 frames per second while panning). */
function bench(network) {
  while (!view.layout.settled) view.layout.run({ budgetMs: 50 });
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
  return zhaToNetwork(await res.json());
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
    show(zhaToNetwork(JSON.parse(await file.text()), file.name));
  } catch (err) {
    log(`Not a capture: ${err}`);
  }
});
for (const type of ["select", "details-request", "hover", "pin-change"]) {
  view.addEventListener(type, (e) => log(`${type} ${JSON.stringify(e.detail)}`));
}
