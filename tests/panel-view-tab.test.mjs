// SPDX-License-Identifier: MIT
// The View tab's "Communication paths" (decision by Fabian Schwamborn, 2026-11-01, board M11): two radios (the stages)
// and one checkbox ("heard only (best 3)") whose state follows the settings and whose change is reported at once.
// A minimal fake DOM stands in for the browser; the tab is rendered by the real renderView.
// node --test tests/
import test from "node:test";
import assert from "node:assert/strict";

class FakeNode {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.listeners = {}; this.style = {}; this.className = "";
    this.classList = { add: (c) => { this.className = `${this.className} ${c}`.trim(); } }; }
  append(...kids) { this.children.push(...kids); }
  replaceChildren(...kids) { this.children = kids; }
  setAttribute(k, v) { this.attrs[k] = v; }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  fire(type) { for (const fn of this.listeners[type] || []) fn({ target: this }); }
  walk(out = []) { out.push(this); for (const c of this.children) if (c instanceof FakeNode) c.walk(out); return out; }
}
globalThis.Node = FakeNode;
globalThis.document = { createElement: (tag) => new FakeNode(tag), createElementNS: (ns, tag) => new FakeNode(tag),
  createTextNode: (text) => ({ text }) };

const { renderView } = await import("../custom_components/meshroute_topology_explorer/frontend/ui/view-tab.js");
const { sanitizeSettings } = await import("../custom_components/meshroute_topology_explorer/frontend/ui/settings.js");
const { translator } = await import("../custom_components/meshroute_topology_explorer/frontend/ui/i18n.js");

function render(stored) {
  const patches = [];
  const container = new FakeNode("div");
  renderView(container, { t: translator("en"), settings: sanitizeSettings(stored), openOnSelect: false, dark: false,
    debug: false, pinCount: 0, scan: null, client: { mode: "stored" }, idPrefix: "v", onChange: (p) => patches.push(p),
    onOpenDetails() {}, onDebug() {}, onReload() {}, onReleaseAll() {}, onScan() {}, onScanStop() {}, onInfo() {} });
  const all = container.walk();
  const radios = all.filter((n) => n.tag === "input" && n.type === "radio" && n.name === "v-paths");
  const box = all.find((n) => n.tag === "input" && n.type === "checkbox" && n.attrs.id === "v-paths-heard");
  return { radios, box, patches, all };
}

test("View tab: two stage radios and one heard-only checkbox, calm by default", () => {
  const { radios, box } = render({});
  assert.deepEqual(radios.map((r) => [r.value, r.checked]), [["coordinator", true], ["all", false]]);
  assert.ok(box, "the checkbox exists");
  assert.equal(box.checked, false);
});

test("View tab: the checkbox follows the settings, in both stages, and migrates from the old third stage", () => {
  for (const [stored, stage, heard] of [[{ paths: "all", heard: true }, "all", true],
    [{ paths: "coordinator", heard: true }, "coordinator", true], [{ paths: "heard" }, "all", true]]) {
    const { radios, box } = render(stored);
    assert.equal(radios.find((r) => r.checked).value, stage, JSON.stringify(stored));
    assert.equal(box.checked, heard, JSON.stringify(stored));
  }
});

test("View tab: the info note about heard only appears in stage 2 only", () => {
  const info = (stored) => render(stored).all.filter((n) => n.attrs.id === "v-heard-info" || n.attrs.id === "v-heard-note");
  assert.equal(info({ paths: "coordinator" }).length, 0);
  assert.equal(info({ paths: "all" }).length, 2, "button and note");
});

test("View tab: a change of the checkbox or a radio is reported at once, as one setting", () => {
  const { radios, box, patches } = render({});
  box.checked = true;
  box.fire("change");
  radios[1].fire("change");
  assert.deepEqual(patches, [{ heard: true }, { paths: "all" }]);
});

test("View tab: three source-route stages, 'Read from zigpy' enabled with its tag (brief a4w)", () => {
  const sr = (stored) => {
    const { all, patches } = render(stored);
    return { radios: all.filter((n) => n.tag === "input" && n.type === "radio" && n.name === "v-sourceRoute"), all, patches };
  };
  const { radios, all, patches } = sr({});
  assert.deepEqual(radios.map((r) => [r.value, r.checked, Boolean(r.disabled)]),
    [["off", false, false], ["assume", true, false], ["zigpy", false, false]]);
  assert.ok(all.some((n) => n.className === "tag" && n.textContent === "experimental"));
  radios[2].fire("change");
  assert.deepEqual(patches, [{ sourceRoute: "zigpy" }]);
  assert.equal(sr({ sourceRoute: "zigpy" }).radios.find((r) => r.checked).value, "zigpy");
});
