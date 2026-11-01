// SPDX-License-Identifier: MIT
// The View tab's "Communication paths" (decision by Fabian Schwamborn, 2026-11-01, board M11; routing-table view by
// owner proposal 2026-11-01): three radios (the views), "include return routes" under the routing table only, and one
// checkbox ("additional heard neighbours (best 3)"), whose states follow the settings and whose changes are reported at
// once.
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
  const returns = all.find((n) => n.tag === "input" && n.type === "checkbox" && n.attrs.id === "v-paths-returns");
  return { radios, box, returns, patches, all };
}

test("View tab: three view radios, the return-route checkbox and the heard checkbox, calm by default", () => {
  const { radios, box, returns } = render({});
  assert.deepEqual(radios.map((r) => [r.value, r.checked]), [["coordinator", true], ["table", false], ["all", false]]);
  assert.ok(box, "the checkbox exists");
  assert.equal(box.checked, false);
  assert.ok(returns, "include return routes exists");
  assert.deepEqual([returns.checked, Boolean(returns.disabled)], [false, true], "off and greyed outside the routing table");
});

test("View tab: 'include return routes' sits under the routing table and works only there (Codex 5)", () => {
  const { all, returns, patches } = render({ paths: "table", returnRoutes: true });
  assert.deepEqual([returns.checked, Boolean(returns.disabled)], [true, false]);
  const ids = all.filter((n) => n.attrs && n.attrs.id).map((n) => n.attrs.id);
  const at = (x) => ids.indexOf(x);
  assert.ok(at("v-paths-table-hint") < at("v-paths-returns") && at("v-paths-returns") < at("v-paths-returns-hint")
    && at("v-paths-returns-hint") < at("v-paths-all-hint"), "between the routing table's hint and the third view");
  returns.checked = false;
  returns.fire("change");
  assert.deepEqual(patches, [{ returnRoutes: false }]);
  assert.equal(render({ paths: "all", returnRoutes: true }).returns.disabled, true, "kept, but greyed in another view");
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
  radios[2].fire("change");
  assert.deepEqual(patches, [{ heard: true }, { paths: "table" }, { paths: "all" }]);
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
