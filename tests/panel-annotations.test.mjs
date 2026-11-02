// SPDX-License-Identifier: MIT
// Wording of the panel's short annotations: relative ranks are not
// reliability, terms are used the same way everywhere, notes exist with their keys. Texts are English only.
// npm test
import test from "node:test";
import assert from "node:assert/strict";
import { STRINGS, translator } from "../custom_components/meshroute_topology_explorer/frontend/ui/i18n.js";

const en = STRINGS;
const t = translator("en");

test("1.4a: relative ranks never read as reliability: no bad / medium / good in the active English texts", () => {
  for (const [key, text] of Object.entries(en)) {
    if (!/^(view\.(bad|medium|good|color_)|legend\.link\.reception|rank\.)/.test(key)) continue;
    assert.ok(!/\b(bad|good|poor|medium)\b/i.test(text), `${key}: ${text}`);
  }
  assert.match(t("legend.link.reception"), /lower · middle · higher reception rank/);
  assert.deepEqual(["bad", "medium", "good"].map((k) => t(`view.${k}`)), ["lower", "middle", "higher"]);
});

test("1.4a: the rank names the comparison basis the model used", () => {
  assert.match(t("rank.basis_reporter", { reporter: "Router 12" }), /Router 12/);
  assert.match(t("rank.basis_vendor", { vendor: "IKEA", reporter: "Router 12" }), /IKEA.*Router 12|Router 12.*IKEA/);
});

test("1.4b: no 'weakest RX' summary in the theoretical-paths heading", () => {
  assert.ok(!/weakest/i.test(en["details.theory_head"]), en["details.theory_head"]);
});

test("1.4c: the status line gives exact router-table counts, not a completeness percentage", async () => {
  const { statusParts } = await import("../custom_components/meshroute_topology_explorer/frontend/engines/zigbee/status.js");
  const { sampleNetwork } = await import("./panel-fixture.mjs");
  const network = sampleNetwork();
  for (const compact of [false, true]) {
    const text = statusParts(network, { compact }).map(([key, params]) => t(key, params)).join(" · ");
    assert.match(text, /Router tables:? 29\/29/);
    assert.ok(!/%|complete/i.test(text), text);
  }
  assert.ok(!("status.complete" in en) && !("status.short_complete" in en));
});

test("1.3: the View tab carries one info note per group at most, with the agreed texts", async () => {
  class Node { constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.style = {}; this.className = "";
    this.classList = { add() {} }; }
    append(...k) { this.children.push(...k); } replaceChildren(...k) { this.children = k; }
    setAttribute(k, v) { this.attrs[k] = v; } addEventListener() {}
    walk(out = []) { out.push(this); for (const c of this.children) if (c instanceof Node) c.walk(out); return out; } }
  globalThis.Node = Node;
  globalThis.document = { createElement: (tag) => new Node(tag), createElementNS: (ns, tag) => new Node(tag), createTextNode: (text) => ({ text }) };
  const { renderView } = await import("../custom_components/meshroute_topology_explorer/frontend/ui/view-tab.js");
  const { sanitizeSettings } = await import("../custom_components/meshroute_topology_explorer/frontend/ui/settings.js");
  const { ENGINES } = await import("../custom_components/meshroute_topology_explorer/frontend/engines/index.js");
  const { sampleNetwork } = await import("./panel-fixture.mjs");
  const container = new Node("div");
  const settings = sanitizeSettings({ paths: "all" }, ENGINES.zigbee.settings);
  renderView(container, { t, settings, groups: ENGINES.zigbee.options(sampleNetwork(), settings), openOnSelect: false,
    dark: false, debug: false, pinCount: 0,
    scan: null, client: { mode: "stored" }, idPrefix: "v", info: {}, reloadInfo: "view.zha_reload_info",
    onChange() {}, onOpenDetails() {}, onDebug() {}, onReload() {},
    onReleaseAll() {}, onScan() {}, onScanStop() {}, onInfo() {} });
  const all = container.walk();
  const notes = Object.fromEntries(all.filter((n) => /^v-.*-note$/.test(n.attrs.id || "")).map((n) => [n.attrs.id, n.attrs.text ?? n.text]));
  for (const key of ["colors", "assumed", "density", "reload"]) {
    assert.ok(all.some((n) => n.attrs.id === `v-${key}-info` && n.attrs["aria-controls"] === `v-${key}-note`), `${key} button`);
  }
  assert.match(en["view.colors_info"], /relative reception rank, not connection reliability/);
  assert.match(en["view.assumed_info"], /not been verified/);
  assert.match(en["view.zha_reload_info"], /does not start a radio scan/);
  assert.ok(Object.keys(notes).length >= 4, JSON.stringify(Object.keys(notes)));
  const buttons = all.filter((n) => n.tag === "button" && /-info$/.test(n.attrs.id || ""));
  assert.equal(new Set(buttons.map((b) => b.attrs.id)).size, buttons.length, "no duplicate buttons");
});

test("1.3: the legend explains RX, computed and assumed paths and missing values in place", () => {
  assert.match(en["legend.rx"], /reception at the arrowhead/);
  assert.match(en["legend.link.derived"], /assumed.*not verified/);
  assert.match(en["legend.link.discovery"], /a candidate, not observed traffic/);
  for (const key of ["legend.link.not-listed", "legend.link.no-table"]) {
    assert.match(en[key], /No reception value in this direction.*does not indicate a weak link/, key);
  }
});

test("1.3: 'Read data again' only re-reads: the reload path never sends zha/topology/update", async () => {
  const { PanelController } = await import("../custom_components/meshroute_topology_explorer/frontend/ui/controller.js");
  const { responses } = await import("./panel-fixture.mjs");
  const sent = [];
  const hass = { user: { is_admin: true }, connected: true, callWS: async (msg) => {
    sent.push(msg.type);
    if (msg.type in responses) return responses[msg.type];
    throw { code: "not_supported", message: msg.type };
  } };
  const controller = new PanelController();
  controller.setHass(hass);
  await controller.reload();
  assert.equal(controller.state.phase, "ready");
  assert.ok(sent.includes("zha/devices"));
  assert.ok(!sent.includes("zha/topology/update"));
});

test("1.5/1.6: one term per kind of path: computed, assumed, measured; a neighbour hop is not an observed route", () => {
  assert.match(en["legend.link.discovery"], /^Computed path: a candidate/);
  assert.equal(t("details.how_discovery"), "route discovery (computed)");
  assert.equal(t("details.how_neighbour"), "direct to a neighbour (no table entry needed)");
  assert.match(en["legend.link.derived"], /^Assumed or derived/);
  // No evidence levels 0-4 and no "predicted" / "calculated" synonyms in the active texts.
  for (const [key, text] of Object.entries(en)) {
    if (!/^(legend|details|view)\./.test(key)) continue;
    assert.ok(!/\b(calculated|predicted|evidence level)\b/i.test(text.replace("not a prediction", "")), `${key}: ${text}`);
  }
});
