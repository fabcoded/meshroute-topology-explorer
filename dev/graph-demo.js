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
    view.pin(pinId, at.x + 120, at.y - 80);
  }
  view.select(findId(network, q.get("select")));
  const zoom = Number(q.get("zoom"));
  if (zoom) view.zoomBy(zoom, { animate: false });
  log(`${network.devices.length} devices, ${network.readings.length} readings`);
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
