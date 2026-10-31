// SPDX-License-Identifier: MIT
// Tests of the label rules (spec 8): cut shared beginnings and keep the distinguishing end, identical names get the
// address, and below the zoom threshold only the focus and its neighbours are labelled.
// node --test "tests/**/*.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  shortenName, displayLabels, uniqueNames, labelsForAll, LABEL_ZOOM, ELLIPSIS,
} from "../custom_components/meshroute_topology_explorer/frontend/graph/labels.js";
import { buildScene, drawScene } from "../custom_components/meshroute_topology_explorer/frontend/graph/renderer.js";
import { resolveTheme } from "../custom_components/meshroute_topology_explorer/frontend/graph/palette.js";
import { zhaToNetwork } from "../dev/zha-network.js";
import { recordingContext } from "./graph-fakes.mjs";

const measure = (text) => text.length * 7;

test("similar names lose their shared beginning and keep the end", () => {
  const names = ["Living room ceiling lamp left", "Living room ceiling lamp right", "Hall"];
  const out = names.map((n) => shortenName(n, names, measure, 84));
  assert.deepEqual(out, [`${ELLIPSIS}lamp left`, `${ELLIPSIS}lamp right`, "Hall"]);
  assert.ok(out.every((label) => measure(label) <= 84));
});

test("the distinguishing part is never cut, even if the label gets wider than the limit", () => {
  const names = ["Garden path light number one left", "Garden path light number one right side"];
  const out = names.map((n) => shortenName(n, names, measure, 42));
  assert.deepEqual(out, [`${ELLIPSIS}left`, `${ELLIPSIS}right side`]);
  assert.ok(measure(out[1]) > 42, "wider than the limit rather than cut");
  // A shared end: "…ceiling lamp" would fit but could be either lamp; the cut moves back to the deciding word.
  const lamps = ["Kitchen ceiling lamp", "Living room ceiling lamp"];
  assert.deepEqual(lamps.map((n) => shortenName(n, lamps, measure, 98)), ["Kitchen ceiling lamp", `${ELLIPSIS}room ceiling lamp`]);
  // A unique long name without similar names is cut from the start, keeping the end.
  assert.equal(shortenName("Texas Instruments CC2652", ["Router 01", "Texas Instruments CC2652"], measure, 140),
    `${ELLIPSIS}Instruments CC2652`);
});

test("names that fit stay whole; cuts prefer a nearby word start", () => {
  assert.equal(shortenName("Router 01", ["Router 01", "Router 02"], measure, 128), "Router 01");
  const names = ["IKEA of Sweden TRADFRI SHORTCUT Button", "IKEA of Sweden TRADFRI on/off switch"];
  assert.equal(shortenName(names[0], names, measure, 120), `${ELLIPSIS}SHORTCUT Button`);
});

test("identical names get the network address, or the end of the IEEE address without one", () => {
  const devices = [
    { id: "aa:bb:cc:dd:00:00:00:12", label: "Lamp", nwk: 0x1a2b },
    { id: "aa:bb:cc:dd:00:00:00:13", label: "Lamp " },
    { id: "aa:bb:cc:dd:00:00:00:14", label: "Sensor" },
    { id: "aa:bb:cc:dd:00:00:00:15", label: "" },
  ];
  assert.deepEqual(uniqueNames(devices), ["Lamp (0x1A2B)", "Lamp (00:13)", "Sensor", "aa:bb:cc:dd:00:00:00:15"]);
});

test("every label of the sample is distinct after shortening", () => {
  const sample = zhaToNetwork(JSON.parse(readFileSync(new URL("./fixtures/zha-sample.json", import.meta.url), "utf8")));
  const labels = displayLabels(sample.devices, measure);
  assert.equal(new Set(labels).size, labels.length);
});

test("below the zoom threshold only the selection and its neighbours carry labels", () => {
  assert.equal(labelsForAll(LABEL_ZOOM, 1), true);
  assert.equal(labelsForAll(LABEL_ZOOM * 0.99, 1), false);
  assert.equal(labelsForAll(LABEL_ZOOM / 1.5, 1.5), true, "threshold scales with the density");
  // Four devices far apart (no overlap): a-b, b-c linked; d alone. Select a at a low zoom: a and b are labelled.
  const network = {
    devices: ["a", "b", "c", "d"].map((id) => ({ id, label: `Device ${id}`, role: "router" })),
    readings: [{ reporter: "a", subject: "b", lqi: 100 }, { reporter: "b", subject: "c", lqi: 100 }],
  };
  const scene = buildScene(network, measure);
  const pos = { x: [0, 1000, 2000, 3000], y: [0, 0, 0, 0], pinned: [0, 0, 0, 0], mesh: [1, 1, 1, 0] };
  const draw = (k, selected) => {
    const ctx = recordingContext();
    drawScene(ctx, scene, pos, { cam: { k, cx: 1500, cy: 0 }, width: 4000, height: 400, dpr: 1, density: 1,
      debug: false, selected, hovered: -1, fps: null }, resolveTheme({}), measure);
    return ctx.calls.filter((c) => c[0] === "fillText").map((c) => c[1]).filter((t) => t.startsWith("Device"));
  };
  assert.deepEqual(draw(0.2, 0).sort(), ["Device a", "Device b"]);
  assert.deepEqual(draw(0.2, -1), []);
  assert.deepEqual(draw(1, -1).sort(), ["Device a", "Device b", "Device c", "Device d"]);
});
