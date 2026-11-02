// SPDX-License-Identifier: MIT
// The cluster dialog's layout contract: the read row (button, progress, note)
// sits directly above the attribute table, the button comes first in keyboard order, and a request goes out only when
// the button is clicked. A minimal fake DOM stands in for the browser; the dialog is the real one.
// npm test
import test from "node:test";
import assert from "node:assert/strict";

class FakeNode {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.listeners = {}; this.style = {}; this.className = "";
    this.textContent = ""; this.classList = { add: (c) => { this.className = `${this.className} ${c}`.trim(); } }; }
  append(...kids) { this.children.push(...kids); }
  replaceChildren(...kids) { this.children = kids; }
  setAttribute(k, v) { this.attrs[k] = v; }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  walk(out = []) { out.push(this); for (const c of this.children) if (c instanceof FakeNode) c.walk(out); return out; }
  focus() {}
  remove() {}
  get open() { return false; }
}
globalThis.Node = FakeNode;
globalThis.document = { createElement: (tag) => new FakeNode(tag), createElementNS: (ns, tag) => new FakeNode(tag),
  createTextNode: (text) => ({ text }) };

const { openClusterDialog } = await import("../custom_components/meshroute_topology_explorer/frontend/engines/zigbee/ui/cluster-dialog.js");
const { translator } = await import("../custom_components/meshroute_topology_explorer/frontend/ui/i18n.js");

function open(callWS) {
  const root = new FakeNode("div");
  const t = translator("en");
  const dlg = openClusterDialog({ root, t, device: { id: "aa:bb:cc:dd:00:00:00:08", label: "Router 03", entities: [] },
    endpoint: 1, profile: 0x0104, cluster: 0x0006, direction: "in", states: () => ({}), callWS, opener: null,
    devicePage: (d, tab) => ({ key: "zha", path: `/config/zha/device/${d.id}/${tab}` }) });
  return { all: dlg.el.walk(), t };
}

test("cluster dialog: the read row precedes the attribute table; the guarded footer stays below", () => {
  const { all, t } = open(async () => "1");
  const index = (pred) => all.findIndex(pred);
  const row = index((n) => /\bread-row\b/.test(n.className));
  const button = index((n) => n.tag === "button" && /\bread-button\b/.test(n.className));
  const table = index((n) => n.tag === "table");
  const manage = index((n) => n.tag === "a");
  assert.ok(row >= 0 && button > row && table > button, `row ${row}, button ${button}, table ${table}`);
  assert.ok(manage > table, "Manage in ZHA stays below the table");
  const rowNode = all[row];
  assert.ok(rowNode.walk().some((n) => n.textContent === t("read.note")), "the note is inside the read row");
  assert.ok(rowNode.walk().some((n) => /\bread-status\b/.test(n.className)), "the progress line is inside the read row");
});

test("cluster dialog: nothing is sent on open; exactly one request per attribute on the button click", async () => {
  const sent = [];
  const { all } = open(async (m) => { sent.push(m.attribute); return "1"; });
  assert.deepEqual(sent, [], "opening the dialog is silent");
  const button = all.find((n) => n.tag === "button" && /\bread-button\b/.test(n.className));
  assert.equal(button.listeners.click.length, 1);
  button.listeners.click[0]({});
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(sent.length >= 1 && new Set(sent).size === sent.length, `one read per attribute: ${sent}`);
});
