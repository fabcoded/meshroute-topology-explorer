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
  assert.equal(t("legend.link.reception"), "coloured: lower · middle · higher reception rank");
  assert.deepEqual(["bad", "medium", "good"].map((k) => t(`view.${k}`)), ["lower", "middle", "higher"]);
  assert.equal(t("view.color_bad_label"), "Colour for lower reception rank");
});

test("1.4a: the rank names the comparison basis the model used", () => {
  assert.equal(t("rank.basis_reporter", { reporter: "Router 12" }), "rank among the readings of Router 12");
  assert.match(t("rank.basis_vendor", { vendor: "IKEA", reporter: "Router 12" }), /^rank within the IKEA group/);
  assert.match(t("details.rank_note"), /vendor group/);
});

test("1.4b: no 'weakest RX' summary: the heading names hop counts and the markers, and the function is gone", async () => {
  assert.ok(!/weakest/i.test(en["details.theory_head"]), en["details.theory_head"]);
  assert.match(en["details.theory_head"], /^Hops: \u2192 outbound \u00B7 \u2190 return\. Expand a device for readings and missing values\.$/);
  const details = await import("../custom_components/meshroute_topology_explorer/frontend/engines/zigbee/ui/details.js");
  assert.equal("weakestHop" in details, false);
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
  assert.equal(en["view.colors_info"], "Colour shows the relative reception rank, not connection reliability.");
  assert.equal(en["view.assumed_info"], "The return path is assumed to follow the outbound path in reverse. It has not been verified.");
  assert.equal(en["view.density_info"], "Spacing helps arrange the network. It does not show physical distance.");
  assert.match(en["view.zha_reload_info"], /^Reloads the tables currently held by ZHA\. It does not start a radio scan\./);
  assert.ok(Object.keys(notes).length >= 4, JSON.stringify(Object.keys(notes)));
  const buttons = all.filter((n) => n.tag === "button" && /-info$/.test(n.attrs.id || ""));
  assert.equal(new Set(buttons.map((b) => b.attrs.id)).size, buttons.length, "no duplicate buttons");
});

test("1.3: the legend explains RX, computed and assumed paths and missing values in place", () => {
  assert.equal(en["legend.rx"], "RX (LQI): reception at the arrowhead. Receiver scales may differ.");
    assert.match(en["legend.link.assumed"], /follow the outbound path in reverse; not verified/);
  assert.equal(en["legend.link.discovery"], "Computed path: a candidate, not observed traffic.");
  for (const key of ["legend.link.not-listed", "legend.link.no-table"]) {
    assert.match(en[key], /No reception value in this direction.*does not indicate a weak link/, key);
  }
});

test("1.3: 'Read data again' only re-reads zha/devices: the reload path never sends zha/topology/update", async () => {
  const { readFile } = await import("node:fs/promises");
  const dir = new URL("../custom_components/meshroute_topology_explorer/frontend/", import.meta.url);
  const controller = await readFile(new URL("ui/controller.js", dir), "utf8");
  assert.ok(!controller.includes("zha/topology/update"));
  const panel = await readFile(new URL("panel.js", dir), "utf8");
  assert.match(panel, /onReload: \(\) => this\._controller\.reload\(\)/);
});

test("1.5/1.6: one term per kind of path: computed, assumed, measured; a neighbour hop is not an observed route", () => {
  assert.match(en["legend.link.discovery"], /^Computed path: a candidate/);
  assert.equal(en["legend.stage_computed"], "(computed, view {n})");
  assert.equal(t("details.how_discovery"), "route discovery (computed)");
  assert.equal(t("details.how_neighbour"), "direct neighbour (from the neighbour table)");
  assert.equal(en["details.theory_note"], "Possible paths from the available tables; actual traffic may differ.");
  assert.equal(en["details.paths_assumed_note"], "Return path assumed: the outbound path reversed. The actual return path is not available in these data.");
  assert.match(en["legend.link.assumed"], /assumed/);
  // No evidence levels 0-4 and no "predicted" / "calculated" synonyms in the active texts.
  for (const [key, text] of Object.entries(en)) {
    if (!/^(legend|details|view)\./.test(key)) continue;
    assert.ok(!/\b(calculated|predicted|evidence level)\b/i.test(text.replace("not a prediction", "")), `${key}: ${text}`);
  }
});
