// SPDX-License-Identifier: MIT
// The Details tab and the status line in the view "routing table" (main session decisions, 2026-11-01, brief a4z): the
// coordinator shows only the "Routing table" card, other devices keep the card with the coordinator above it; the
// status line leaves the source-route part out in that view, which draws no assumed or recorded return path.
// A minimal fake DOM stands in for the browser; the tab is rendered by the real renderDetails. node --test tests/
import test from "node:test";
import assert from "node:assert/strict";

class FakeNode {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.listeners = {}; this.style = {}; this.className = "";
    this.classList = { add: (c) => { this.className = `${this.className} ${c}`.trim(); }, toggle: () => {} }; }
  append(...kids) { this.children.push(...kids); }
  replaceChildren(...kids) { this.children = kids; }
  setAttribute(k, v) { this.attrs[k] = v; }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  walk(out = []) { out.push(this); for (const c of this.children) if (c instanceof FakeNode) c.walk(out); return out; }
}
globalThis.Node = FakeNode;
globalThis.document = { createElement: (tag) => new FakeNode(tag), createElementNS: (ns, tag) => new FakeNode(tag),
  createTextNode: (text) => ({ text }) };

const { renderDetails } = await import("../custom_components/meshroute_topology_explorer/frontend/engines/zigbee/ui/details-tab.js");
const { sourceRoutePart } = await import("../custom_components/meshroute_topology_explorer/frontend/engines/zigbee/status.js");
const { sourceRouteSummary } = await import("../custom_components/meshroute_topology_explorer/frontend/engines/zigbee/source-routes.js");
const { translator } = await import("../custom_components/meshroute_topology_explorer/frontend/ui/i18n.js");
const { sampleNetwork } = await import("./panel-fixture.mjs");

const t = translator("en");
const network = sampleNetwork();
const idOf = (label) => network.devices.find((d) => d.label === label).id;

/** The card titles the Communication sub-tab shows for a device in a view. */
function titles(label, nodeView) {
  const container = new FakeNode("div");
  renderDetails(container, { network, t, id: idOf(label), debug: false, raw: new Map(), nodeView, returnRoutes: true,
    sourceRoute: "assume", sub: "communication", idPrefix: "d", pinned: false, onSub() {}, onSelect() {},
    onRelease() {}, onCluster() {}, onFindings() {} });
  return container.walk().filter((n) => n.className && n.className.split(" ").includes("card-title")).map((n) => n.textContent);
}

test("Details in the routing table: the coordinator shows only the table card, other devices keep the card with the coordinator", () => {
  const coordinator = titles("Coordinator", "table");
  assert.ok(coordinator.includes("Routing table · 30"), coordinator.join(" | "));
  assert.ok(!coordinator.some((x) => /^All paths|^Communication path with the coordinator/.test(x)), coordinator.join(" | "));
  const router = titles("Router 13", "table");
  const at = (x) => router.findIndex((y) => y.startsWith(x));
  assert.ok(at("Communication path with the coordinator") >= 0 && at("Communication path with the coordinator") < at("Routing table · 5"),
    router.join(" | "));
  assert.ok(titles("Coordinator", "coordinator").some((x) => x.startsWith("All paths")), "view 1 keeps the coordinator's list");
});

test("status line: no source-route part in the routing table; views 1 and 3 keep it, the zigpy variant included", () => {
  const summary = sourceRouteSummary(network, "assume");
  assert.ok(summary && summary.count > 0);
  assert.ok(sourceRoutePart(summary, false, "coordinator"));
  assert.ok(sourceRoutePart(summary, true, "all"));
  assert.equal(sourceRoutePart(summary, false, "table"), null);
  assert.equal(sourceRoutePart(summary, true, "table"), null);
  const failed = { mode: "zigpy", count: 3, recorded: 0, zigpy: { status: "error", reason: "no_gateway" } };
  assert.ok(sourceRoutePart(failed, false, "all"));
  assert.equal(sourceRoutePart(failed, false, "table"), null);
});
