// SPDX-License-Identifier: MIT
// Tests of the label rules (spec 8) with realistic glyph widths: cuts only at word starts, never into the part that
// tells similar names apart; everyone labelled from the working scale up, below it only the coordinator, the focus
// and its neighbours; labels move around devices before they are left out.  node --test "tests/**/*.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  shortenName, displayLabels, labelsForAll, labelLines, haLabels, DEFAULT_LABELS, ELLIPSIS, MAX_LABEL_WIDTH,
} from "../custom_components/meshroute_topology_explorer/frontend/graph/labels.js";
import { buildScene, drawScene, typeShown } from "../custom_components/meshroute_topology_explorer/frontend/graph/renderer.js";
import { resolveTheme } from "../custom_components/meshroute_topology_explorer/frontend/graph/palette.js";
import { buildNetwork } from "../custom_components/meshroute_topology_explorer/frontend/engines/zigbee/model.js";
import { asZigbee, recordingContext, labelWidth as measure } from "./graph-fakes.mjs";

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
function labelsAt(network, pos, k, { selected = -1, width = 4000, height = 400, cx = 1500, cy = 0, labels, kinds, typeZoom } = {}) {
  const scene = buildScene(asZigbee(network), measure);
  const ctx = recordingContext({ props: true });
  const stats = drawScene(ctx, scene, pos, { cam: { k, cx, cy }, width, height, dpr: 1, labelZoom: 1,
    debug: false, selected, hovered: -1, fps: null, labels, typeZoom, texts: kinds ? { kinds } : undefined }, resolveTheme({}), measure);
  // Each text with the font and colour it was drawn in.
  const texts = [];
  let font = null;
  let color = null;
  for (const c of ctx.calls) {
    if (c[0] === "set" && c[1] === "font") font = c[2];
    if (c[0] === "set" && c[1] === "fillStyle") color = c[2];
    if (c[0] === "fillText") texts.push({ text: c[1], x: c[2], y: c[3], font, color });
  }
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

test("a label block: type above, readable name below, the Home Assistant name under it only on request", () => {
  const kinds = { light: "Light", hub: "Hub" };
  const node = { kind: "light", label: "Kitchen", haLabel: "IKEA of Sweden TRADFRI bulb" };
  assert.deepEqual(DEFAULTS_OK(DEFAULT_LABELS), true);
  assert.deepEqual(labelLines(node, DEFAULT_LABELS, kinds), { above: [{ text: "Light", role: "type" }],
    below: [{ text: "Kitchen", role: "name" }] });
  assert.deepEqual(labelLines(node, { type: true, name: true, haName: true }, kinds).below,
    [{ text: "Kitchen", role: "name" }, { text: "IKEA of Sweden TRADFRI bulb", role: "ha" }]);
  assert.deepEqual(labelLines(node, { type: false, name: false, haName: true }, kinds),
    { above: [], below: [{ text: "IKEA of Sweden TRADFRI bulb", role: "ha" }] });
  assert.deepEqual(labelLines({ ...node, kind: null }, DEFAULT_LABELS, kinds).above, [], "unknown kind: no type line");
  assert.deepEqual(labelLines({ ...node, kind: "lock" }, DEFAULT_LABELS, kinds).above, [], "no word for it: none");
  assert.deepEqual(labelLines({ ...node, kind: "__proto__" }, DEFAULT_LABELS, kinds).above, [], "only own words");
  assert.deepEqual(labelLines({ ...node, haLabel: null }, { type: false, name: true, haName: true }, kinds).below,
    [{ text: "Kitchen", role: "name" }], "the same name twice is shown once");
});

/** The defaults of spec 11: type and name on, the Home Assistant name off. */
function DEFAULTS_OK(d) { return d.type === true && d.name === true && d.haName === false; }

test("Home Assistant names are shown only where they differ from the readable one, shortened like it", () => {
  const devices = [
    { id: "a", label: "Kitchen", haName: "IKEA of Sweden TRADFRI bulb E27 WS globe opal 1055lm" },
    { id: "b", label: "IKEA of Sweden TRADFRI bulb GU10", haName: "IKEA of Sweden TRADFRI bulb GU10" },
    { id: "c", label: "Hall", haName: "IKEA of Sweden TRADFRI bulb E27 WW 806lm" },
    { id: "d", label: "Desk", haName: "  " },
  ];
  const out = haLabels(devices, measure);
  assert.equal(out[1], null, "equal to the readable name: nothing to add");
  assert.equal(out[3], null, "no name");
  assert.ok(out[0].startsWith(ELLIPSIS) && out[0].endsWith("opal 1055lm"), out[0]);
  assert.ok(out[2].endsWith("WW 806lm") && out[0] !== out[2], "shortened against each other, still apart");
  // The sample: every device carries the registry's name; it differs from the readable one for each.
  const responses = JSON.parse(readFileSync(new URL("./fixtures/zha-sample.json", import.meta.url), "utf8")).responses;
  const sample = buildNetwork(responses["zha/devices"], { deviceRegistry: responses["config/device_registry/list"] });
  assert.ok(sample.devices.every((d) => typeof d.haName === "string" && d.haName), "the model carries haName");
  const coordinator = sample.devices.find((d) => d.role === "coordinator");
  assert.equal(coordinator.haName, "Texas Instruments CC2652");
});

test("on the map: the type sits above the symbol in grey, the name below, the Home Assistant name smaller under it", () => {
  const network = { devices: [{ id: "a", label: "Kitchen", haName: "IKEA FLOALT panel", role: "router",
    kind: "light" }], readings: [] };
  const pos = { x: [0], y: [0], pinned: [0], mesh: [0] };
  const kinds = { light: "Light" };
  const theme = resolveTheme({});
  const at = (labels) => labelsAt(network, pos, 1, { width: 400, height: 400, cx: 0, cy: 0, labels, kinds });
  const { texts } = at({ type: true, name: true, haName: true });
  const type = texts.find((t) => t.text === "Light");
  const name = texts.find((t) => t.text === "Kitchen");
  const ha = texts.find((t) => t.text === "IKEA FLOALT panel");
  assert.ok(type && name && ha, JSON.stringify(texts));
  assert.ok(type.y < 200 && name.y > 200 && ha.y > name.y, "type above the symbol, names below, HA name last");
  assert.equal(type.color, theme.muted);
  assert.equal(name.color, theme.foreground);
  assert.equal(ha.color, theme.muted);
  assert.match(ha.font, /^10px/, "a smaller line");
  assert.match(name.font, /^12px/);
  // Defaults: no HA name; switched off lines are not drawn; no type line without words for the kinds.
  assert.deepEqual(at(undefined).texts.map((t) => t.text).sort(), ["Kitchen", "Light"]);
  assert.deepEqual(at({ type: false, name: true, haName: false }).texts.map((t) => t.text), ["Kitchen"]);
  assert.deepEqual(at({ type: false, name: false, haName: false }).texts, [], "all lines off: no label");
  assert.deepEqual(labelsAt(network, pos, 1, { width: 400, height: 400, cx: 0, cy: 0 }).texts.map((t) => t.text),
    ["Kitchen"]);
});

test("a label block moves as a whole and never covers another device or label", () => {
  const kinds = { light: "Light" };
  const labels = { type: true, name: true, haName: true };
  // b sits right above a: a's type line cannot go above, so the whole block goes below (type first).
  const network = { devices: [{ id: "a", label: "Alpha", haName: "Vendor Alpha", role: "router", kind: "light" },
    { id: "b", label: "Beta", role: "router" }], readings: [] };
  const pos = { x: [0, 0], y: [0, -20], pinned: [0, 0], mesh: [0, 0] };
  const { texts } = labelsAt(network, pos, 1, { width: 400, height: 400, cx: 0, cy: 0, labels, kinds });
  const [type, name, ha] = ["Light", "Alpha", "Vendor Alpha"].map((x) => texts.find((t) => t.text === x));
  assert.ok(type && name && ha, JSON.stringify(texts.map((t) => t.text)));
  assert.ok(type.y > 200 && name.y > type.y && ha.y > name.y, "the whole block below, in its order");
  // Every drawn line keeps clear of every symbol but its own and of the other lines.
  const crowd = { devices: Array.from({ length: 9 }, (_, i) => ({ id: `d${i}`, label: `Name ${i}`, haName: `Vendor model ${i}`,
    role: "router", kind: "light" })), readings: [] };
  const cpos = { x: [], y: [], pinned: [], mesh: [] };
  for (let i = 0; i < 9; i++) { cpos.x.push((i % 3) * 70); cpos.y.push(Math.floor(i / 3) * 60); cpos.pinned.push(0); cpos.mesh.push(0); }
  const { texts: ct, stats } = labelsAt(crowd, cpos, 1, { width: 600, height: 600, cx: 70, cy: 60, labels, kinds });
  const boxes = ct.map((t) => ({ ...t, w: measure(t.text) * (/^10px/.test(t.font) ? 10 / 12 : 1), h: 12 }));
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      const overlap = Math.abs(a.x - b.x) * 2 < a.w + b.w && Math.abs(a.y - b.y) * 2 < a.h + b.h;
      assert.ok(!overlap, `${a.text} and ${b.text}`);
    }
  }
  assert.equal(stats.labels + stats.dropped, 9, "every device placed or counted as left out");
});

test("the type line shows only from the working scale up; the overview stays calm", () => {
  assert.equal(typeShown(1, 1), true);
  assert.equal(typeShown(0.99, 1), false);
  assert.equal(typeShown(0.2, undefined), true, "without a working scale: always");
  const network = { devices: [{ id: "a", label: "Kitchen", role: "router", kind: "light" }], readings: [] };
  const pos = { x: [0], y: [0], pinned: [0], mesh: [0] };
  const at = (k, typeZoom) => labelsAt(network, pos, k, { width: 400, height: 400, cx: 0, cy: 0, kinds: { light: "Light" }, typeZoom })
    .texts.map((t) => t.text).sort();
  assert.deepEqual(at(1, 2), ["Kitchen"], "below the working scale: the name only");
  assert.deepEqual(at(2, 2), ["Kitchen", "Light"], "at the working scale: type and name");
  assert.deepEqual(at(3, 2), ["Kitchen", "Light"]);
});
