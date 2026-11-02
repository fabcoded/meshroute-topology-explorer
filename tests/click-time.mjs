// SPDX-License-Identifier: MIT
// Test helper, not shipped and not a test file of its own: the model time of a click in the view "all" on the sample
// (spec 12, Speed), run by model-theoretical.test.mjs in a child process with V8's --single-threaded flag:
// without background compiler and garbage collector threads,
// process.cpuUsage() counts the click's own work, not helper threads that run longer when the machine is busy. Two
// warm-up rounds over the four clicks compile the code; each click counts its best of three fresh networks (no
// cached lookups or discovery trees). Prints { worst, clicks: { label: ms } } as JSON.
// Run alone: node --single-threaded tests/click-time.mjs
import { sampleNetwork } from "./panel-fixture.mjs";
import { nodePaths } from "../custom_components/meshroute_topology_explorer/frontend/engines/zigbee/node-paths.js";

const LABELS = ["Router 11", "Router 13", "Router 03", "End device 06"];
const click = (network, label) => nodePaths(network, network.devices.find((d) => d.label === label).id, "all");

for (let round = 0; round < 2; round++) for (const label of LABELS) click(sampleNetwork(), label);
const clicks = {};
for (const label of LABELS) {
  let best = Infinity;
  for (let i = 0; i < 3; i++) {
    const network = sampleNetwork();
    const cpu = process.cpuUsage();
    click(network, label);
    const used = process.cpuUsage(cpu);
    best = Math.min(best, (used.user + used.system) / 1000);
  }
  clicks[label] = Math.round(best * 10) / 10;
}
process.stdout.write(JSON.stringify({ worst: Math.max(...Object.values(clicks)), clicks }));
