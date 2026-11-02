// SPDX-License-Identifier: MIT
// Test helper, not shipped and not a test file of its own: the layout's settling time on the synthetic network of
// spec 12 (Speed: 300 devices, 3 000 readings), run by layout-speed.budget.mjs in a child process with V8's
// --single-threaded flag, as tests/click-time.mjs does for a click: without background compiler and garbage collector threads, process.cpuUsage() counts the layout's own work,
// not helper threads that run longer when the machine is busy. The layout is deterministic (fixed seeds); it runs
// three times from the start and the best CPU time counts. Prints { ms, wallMs, steps, lastMove, temperature,
// fidelity, devices, readings } of the best run as JSON.
// Run alone: node --single-threaded tests/layout-time.mjs
import { Layout, baseLength } from "../custom_components/meshroute_topology_explorer/frontend/graph/layout.js";
import { displayLabels } from "../custom_components/meshroute_topology_explorer/frontend/graph/labels.js";
import { NODE_DIAMETER } from "../custom_components/meshroute_topology_explorer/frontend/graph/renderer.js";
import { syntheticNetwork } from "./synthetic-network.mjs";
import { springQuality as quality } from "../custom_components/meshroute_topology_explorer/frontend/engines/zigbee/lanes.js";
import { fidelity } from "./fidelity.mjs";
import { labelWidth as measure } from "./graph-fakes.mjs";

const net = syntheticNetwork({ devices: 300, readings: 3000, seed: 7 });
const l0 = baseLength(displayLabels(net.devices, measure), measure, NODE_DIAMETER);
let best = null;
for (let run = 0; run < 3; run++) {
  const layout = new Layout(net, { quality, baseLength: l0, seed: 1 });
  const wall = performance.now();
  const cpu = process.cpuUsage();
  layout.run();
  const used = process.cpuUsage(cpu);
  const ms = (used.user + used.system) / 1000;
  if (!best || ms < best.ms) best = { ms, wallMs: performance.now() - wall, layout };
}
const { layout } = best;
process.stdout.write(JSON.stringify({ ms: Math.round(best.ms), wallMs: Math.round(best.wallMs), steps: layout.steps,
  lastMove: layout.lastMove, temperature: layout.temperature, fidelity: fidelity(layout), devices: net.devices.length,
  readings: net.readings.length }));
