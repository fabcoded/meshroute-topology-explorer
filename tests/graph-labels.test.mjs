// SPDX-License-Identifier: MIT
// Tests of the label rules (spec 8) with realistic glyph widths: cuts only at word starts, never into the part that
// tells similar names apart; everyone labelled from the working scale up, below it only the coordinator, the focus
// and its neighbours; labels move around devices before they are left out.  node --test "tests/**/*.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  shortenName, displayLabels, labelsForAll, ELLIPSIS, MAX_LABEL_WIDTH,
} from "../custom_components/meshroute_topology_explorer/frontend/graph/labels.js";
import { buildScene, drawScene } from "../custom_components/meshroute_topology_explorer/frontend/graph/renderer.js";
import { resolveTheme } from "../custom_components/meshroute_topology_explorer/frontend/graph/palette.js";
import { buildNetwork } from "../custom_components/meshroute_topology_explorer/frontend/model/index.js";
import { recordingContext, labelWidth as measure } from "./graph-fakes.mjs";

const cut = (name, others, max = MAX_LABEL_WIDTH) => shortenName(name, others, measure, max);
const startsWord = (name, label) => {
  if (!label.startsWith(ELLIPSIS)) return true;
  const i = name.length - (label.length - 1);
  return name.endsWith(label.slice(1)) && name[i - 1] === " ";
};

test("long names are cut at a word start, keeping the end", () => {
  const names = ["TRADFRI SHORTCUT Button", "TRADFRI on/off switch", "Living room ceiling lamp left",
    "Living room ceiling lamp right", "Signify Netherlands B.V. RWL022", "Hall"];
  const out = names.map((n) => cut(n, names));
  assert.deepEqual(out, [`${ELLIPSIS}SHORTCUT Button`, "TRADFRI on/off switch", `${ELLIPSIS}room ceiling lamp left`,
    `${ELLIPSIS}ceiling lamp right`, `${ELLIPSIS}B.V. RWL022`, "Hall"]);
  for (const [i, label] of out.entries()) {
    assert.ok(startsWord(names[i], label), label);
    assert.ok(measure(label) <= MAX_LABEL_WIDTH, `${label}: ${measure(label)}`);
  }
});

test("the distinguishing part is never cut; without a word start inside it, the previous one is taken", () => {
  const names = ["Garden path light number one left", "Garden path light number one right side"];
  const out = names.map((n) => cut(n, names, 40));
  assert.deepEqual(out, [`${ELLIPSIS}left`, `${ELLIPSIS}right side`]);
  assert.ok(measure(out[1]) > 40, "wider than the limit rather than cut");
  // The difference lies inside a word: the cut goes to that word's start, not into it.
  const bulbs = ["TRADFRIbulbE27WSglobeopal1055lm kitchen", "TRADFRIbulbGU10WS345lm kitchen"];
  assert.deepEqual(bulbs.map((n) => cut(n, bulbs, 60)), bulbs, "no word start before the difference: whole names");
  // A shared end: "…ceiling lamp" would fit but could be either lamp.
  const lamps = ["Kitchen ceiling lamp", "Living room ceiling lamp"];
  assert.deepEqual(lamps.map((n) => cut(n, lamps, 90)), ["Kitchen ceiling lamp", `${ELLIPSIS}room ceiling lamp`]);
});

test("the model's labels are used as they are when they fit", () => {
  const responses = JSON.parse(readFileSync(new URL("./fixtures/zha-sample.json", import.meta.url), "utf8")).responses;
  const sample = buildNetwork(responses["zha/devices"], { deviceRegistry: responses["config/device_registry/list"] });
  const labels = displayLabels(sample.devices, measure);
  assert.equal(new Set(labels).size, labels.length);
  sample.devices.forEach((d, i) => {
    if (measure(d.label) <= MAX_LABEL_WIDTH) assert.equal(labels[i], d.label);
    else assert.ok(startsWord(d.label, labels[i]), labels[i]);
  });
  assert.deepEqual(displayLabels([{ id: "aa:bb", label: "" }], measure), ["aa:bb"], "no label: the id");
});

/** Draw a scene at zoom k (everyone labelled from zoom 1) and return the label texts and their centres. */
function labelsAt(network, pos, k, { selected = -1, width = 4000, height = 400, cx = 1500, cy = 0 } = {}) {
  const scene = buildScene(network, measure);
  const ctx = recordingContext();
  const stats = drawScene(ctx, scene, pos, { cam: { k, cx, cy }, width, height, dpr: 1, labelZoom: 1,
    debug: false, selected, hovered: -1, fps: null }, resolveTheme({}), measure);
  const texts = ctx.calls.filter((c) => c[0] === "fillText").map((c) => ({ text: c[1], x: c[2], y: c[3] }));
  return { texts, stats };
}

test("below the label scale only the coordinator, the selection and the devices on its paths carry labels", () => {
  assert.equal(labelsForAll(1, 1), true);
  assert.equal(labelsForAll(0.99, 1), false);
  // Five devices far apart: a-b, b-c linked; d alone; z the coordinator. a reaches z through b, b directly.
  const network = {
    devices: ["a", "b", "c", "d"].map((id) => ({ id, label: `Device ${id}`, role: "router" }))
      .concat([{ id: "z", label: "Coordinator", role: "coordinator" }]),
    readings: [{ reporter: "a", subject: "b", lqi: 100 }, { reporter: "b", subject: "c", lqi: 100 }],
    routes: [{ owner: "a", destination: "z", nextHop: "b", status: "Active", stale: false },
      { owner: "b", destination: "z", nextHop: "z", status: "Active", stale: false }],
  };
  const pos = { x: [0, 1000, 2000, 3000, 1500], y: [0, 0, 0, 0, 100], pinned: [0, 0, 0, 0, 0], mesh: [1, 1, 1, 0, 0] };
  const deviceLabels = new Set(network.devices.map((d) => d.label));
  const names = (k, selected) => labelsAt(network, pos, k, { selected }).texts.map((t) => t.text)
    .filter((t) => deviceLabels.has(t)).sort(); // lane values of the selection are not labels
  assert.deepEqual(names(0.2, 0), ["Coordinator", "Device a", "Device b"], "a's way up runs through b");
  assert.deepEqual(names(0.2, 1), ["Coordinator", "Device b"], "b's neighbours a and c are on none of its paths");
  assert.deepEqual(names(0.2, -1), ["Coordinator"], "the coordinator, also on a narrow screen");
  assert.deepEqual(names(1, -1), ["Coordinator", "Device a", "Device b", "Device c", "Device d"]);
});

test("a label moves above, right or left of its device before it is left out, never over another device", () => {
  // Device b sits right below a: a's label cannot go below, so it goes above.
  const network = { devices: [{ id: "a", label: "Alpha", role: "router" }, { id: "b", label: "Beta", role: "router" }],
    readings: [] };
  const pos = { x: [0, 0], y: [0, 18], pinned: [0, 0], mesh: [0, 0] };
  const { texts } = labelsAt(network, pos, 1, { width: 400, height: 400, cx: 0, cy: 0 });
  const alpha = texts.find((t) => t.text === "Alpha");
  assert.ok(alpha && alpha.y < 200, "Alpha above its device");
  // Crowded: a device surrounded on all four sides keeps no label, and that is counted.
  const crowd = { devices: ["m", "n", "e", "s", "w"].map((id) => ({ id, label: `Name ${id}`, role: "router" })),
    readings: [] };
  const cpos = { x: [0, 0, 30, 0, -30], y: [0, -18, 0, 18, 0], pinned: [0, 0, 0, 0, 0], mesh: [0, 0, 0, 0, 0] };
  const { texts: ct, stats } = labelsAt(crowd, cpos, 1, { width: 400, height: 400, cx: 0, cy: 0 });
  assert.ok(!ct.some((t) => t.text === "Name m"), "the middle one is left out");
  assert.ok(stats.dropped >= 1);
});
