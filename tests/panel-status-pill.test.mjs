// SPDX-License-Identifier: MIT
// The status pill (spec 6, 9.1): the dot's three states with their words, the order of its parts, the menu (networks,
// data state, Settings link), the link's target and navigation, administrators only, the View tab's link, and the
// phone rule in the styles. Run: npm test
import test from "node:test";
import assert from "node:assert/strict";
import { FakeEl, installFakeDom } from "./dom-fake.mjs";
import { pillModel, statusPill } from "../custom_components/meshroute_topology_explorer/frontend/ui/status-pill.js";
import { INTEGRATION_PATH } from "../custom_components/meshroute_topology_explorer/frontend/ui/ha-links.js";
import { renderView } from "../custom_components/meshroute_topology_explorer/frontend/ui/view-tab.js";
import { ENGINES } from "../custom_components/meshroute_topology_explorer/frontend/engines/index.js";
import { buildThreadNetwork } from "../custom_components/meshroute_topology_explorer/frontend/engines/thread/model.js";
import { healthLevel, OLD_AFTER_MS } from "../custom_components/meshroute_topology_explorer/frontend/engines/thread/status.js";
import { STYLES } from "../custom_components/meshroute_topology_explorer/frontend/ui/styles.js";
import { translator } from "../custom_components/meshroute_topology_explorer/frontend/ui/i18n.js";
import { readFileSync } from "node:fs";
import { sampleNetwork } from "./panel-fixture.mjs";

installFakeDom();
const t = translator("en");
const zigbee = ENGINES.zigbee;
const thread = ENGINES.thread;
const threadNet = buildThreadNetwork(JSON.parse(readFileSync(new URL("./fixtures/matter-sample.json", import.meta.url), "utf8"))
  .responses["matter/network_topology"]);

/** The model of a Zigbee network as the panel builds it. */
function zigbeeModel(network, extra = {}) {
  const base = { unchangedSince: "15:50", settings: { sourceRoute: "assume", paths: "coordinator" } };
  return pillModel({ t, status: zigbee.status(network, base), short: zigbee.status(network, { ...base, compact: true }),
    choices: [{ key: "zha", available: true }], active: "zha", admin: true, ...extra });
}

test("green: all router tables read; the second line says so, and the menu holds the full state", () => {
  const m = zigbeeModel(sampleNetwork());
  assert.equal(m.level, "ok");
  assert.equal(m.name, "Zigbee (ZHA)");
  assert.equal(m.shortName, "Zigbee");
  assert.equal(m.line, "29/29 router tables · unchanged since 15:50");
  assert.deepEqual(m.state.map((s) => s.text), ["Router tables: 29/29", "unchanged since 15:50",
    "Return paths assumed for 8 devices (source route)"]);
});

test("amber: a table missing; the words say 28/29, not only the colour", () => {
  const m = zigbeeModel(sampleNetwork("minus1"));
  assert.equal(m.level, "warn");
  assert.match(m.line, /^28\/29 router tables/);
});

test("red: connection lost; the second line says it", () => {
  const m = zigbeeModel(sampleNetwork(), { lost: true });
  assert.equal(m.level, "error");
  assert.equal(m.line, "connection to Home Assistant lost");
});

test("Thread: amber for one-way links, no border router or a snapshot of 4 hours and older", () => {
  const now = Date.parse(threadNet.collectedAt) + 60000;
  const oneWay = { ...threadNet, status: { ...threadNet.status, linksBoth: 3, links: 5 } };
  assert.equal(healthLevel(oneWay, now), "warn", "the sample has pairs measured one way only");
  const clean = { ...threadNet, status: { ...threadNet.status, linksBoth: 5, links: 5, borderRouters: 1 } };
  assert.equal(healthLevel(clean, now), "ok");
  assert.equal(healthLevel(clean, now + OLD_AFTER_MS), "warn");
  assert.equal(healthLevel({ ...clean, status: { ...clean.status, borderRouters: 0 } }, now), "warn");
  assert.equal(thread.status(clean, { now }).level, "ok");
});

test("the pill: arrow button first, two lines, the dot last; the whole pill is the menu button", () => {
  const [pill] = statusPill({ t, model: zigbeeModel(sampleNetwork("minus1")), open: false, onToggle() {} });
  assert.equal(pill.tag, "button");
  assert.equal(pill.attrs["aria-haspopup"], "menu");
  assert.equal(pill.attrs["aria-expanded"], "false");
  assert.deepEqual(pill.children.map((c) => c.className.split(" ")[0]), ["pill-arrow", "pill-text", "pill-dot"]);
  assert.match(pill.attrs["aria-label"], /Zigbee \(ZHA\), 28\/29 router tables/);
  assert.match(pill.className, /level-warn/);
  const [open] = statusPill({ t, model: zigbeeModel(sampleNetwork()), open: true, onToggle() {} });
  assert.equal(open.attrs["aria-expanded"], "true");
});

test("menu: networks (two or more), then the data state, then Settings; one network has no network section", () => {
  const two = { ...zigbeeModel(sampleNetwork()), networks: [
    { key: "zha", label: "Zigbee (ZHA)", available: true }, { key: "thread", label: "Thread (Matter)", available: false, why: "x" }] };
  const chosen = [];
  const [, menu] = statusPill({ t, model: two, open: true, onToggle() {}, onChoose: (k) => chosen.push(k) });
  const rows = menu.children.map((c) => c.className.split(" ")[0] || c.attrs.role);
  assert.deepEqual(rows, ["menu-title", "menu-row", "menu-row", "menu-sep", "menu-state", "menu-sep", "menu-row"]);
  const radios = menu.find((e) => e.attrs.role === "menuitemradio");
  radios[0].click();
  radios[1].click();
  assert.deepEqual(chosen, ["zha"], "a greyed network cannot be chosen");
  assert.equal(radios[1].attrs["aria-disabled"], "true");
  const [, single] = statusPill({ t, model: zigbeeModel(sampleNetwork()), open: true, onToggle() {} });
  assert.deepEqual(single.children.map((c) => c.className.split(" ")[0]), ["menu-state", "menu-sep", "menu-row"],
    "the pill still opens the menu with one network");
});

test("Settings: a link to the integration's page in Home Assistant, kept inside the app; administrators only", () => {
  assert.equal(INTEGRATION_PATH, "/config/integrations/integration/meshroute_topology_explorer");
  const [, menu] = statusPill({ t, model: zigbeeModel(sampleNetwork()), open: true, onToggle() {} });
  const [link] = menu.find((e) => e.tag === "a");
  assert.equal(link.href, INTEGRATION_PATH);
  assert.equal(link.textContent, "Settings");
  const pushed = [];
  const events = [];
  globalThis.history = { pushState: (...a) => pushed.push(a) };
  globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init.detail; } };
  globalThis.window = { dispatchEvent: (e) => events.push(e) };
  let prevented = false;
  link.click({ preventDefault: () => { prevented = true; } });
  assert.deepEqual(pushed, [[null, "", INTEGRATION_PATH]]);
  assert.deepEqual(events.map((e) => e.type), ["location-changed"]);
  assert.equal(prevented, true);
  link.click({ metaKey: true });
  assert.equal(pushed.length, 1, "a modified click keeps the browser's behaviour");
  assert.equal(zigbeeModel(sampleNetwork(), { admin: false }).settings, null);
  const [, plain] = statusPill({ t, model: zigbeeModel(sampleNetwork(), { admin: false }), open: true, onToggle() {} });
  assert.equal(plain.find((e) => e.tag === "a").length, 0, "no link for others");
});

test("View tab: the link ends the tab, with its grey line; without administrator rights it is not there", () => {
  const ctx = (canSettings) => ({ t, canSettings, settings: { density: "medium", fill: "none", labels: {}, pathColors: {} },
    groups: [], client: { mode: "stored" }, onChange() {} });
  const tab = new FakeEl("div");
  renderView(tab, ctx(true));
  const last = tab.children.at(-1);
  assert.equal(last.className, "view-settings");
  assert.equal(last.find((e) => e.tag === "a")[0].href, INTEGRATION_PATH);
  assert.equal(last.find((e) => e.tag === "a")[0].textContent, "Settings (Home Assistant)");
  assert.equal(last.children.at(-1).textContent, "Integration options in Home Assistant");
  const other = new FakeEl("div");
  renderView(other, ctx(false));
  assert.equal(other.find((e) => e.className === "view-settings").length, 0);
});

test("phone width of the map: second line hidden, the short name, the dot stays", () => {
  const rule = STYLES.match(/@container \(max-width: 600px\) \{([\s\S]*?\n)\}/);
  assert.ok(rule, "a container rule at 600 px");
  assert.match(rule[1], /\.pill-line, \.pill-full \{ display: none; \}/);
  assert.match(rule[1], /\.pill-short \{ display: inline; \}/);
  assert.ok(!/pill-dot/.test(rule[1]), "the dot is not hidden");
  assert.match(STYLES, /\.pill-short \{ display: none; \}/);
  assert.match(STYLES, /\.status-pill \{[^}]*max-width: calc\(100% - var\(--inset-left\) - var\(--inset-right\) - 144px\)/,
    "room left and right for the zoom group");
});
