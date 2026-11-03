// SPDX-License-Identifier: MIT
// The path history window and its entry points (spec 9.5, boards M36, M35) in the fake DOM: tabs and the remembered
// tab, the ranges "Keep for" allows, the states without data, a click on a pill opening the Lane tab for that hop
// (also a ghost's) with the two nodes ringed, the lane strip's text, Thread pills stacked, the sparkline rows of
// Details. Real loader over the committed samples; times injected. npm test
import test from "node:test";
import assert from "node:assert/strict";
import { FakeEl, installFakeDom } from "./dom-fake.mjs";
import { recordingContext } from "./graph-fakes.mjs";
import { callWsFor, sampleHistory } from "./history-ui-fixture.mjs";
import { readFileSync } from "node:fs";

installFakeDom();
// What the window needs beyond dom-fake: a canvas context, geometry, removal.
FakeEl.prototype.getContext = function getContext() { return (this.ctx ||= recordingContext({ props: true })); };
FakeEl.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, width: 600, height: 300 });
FakeEl.prototype.remove = function remove() { this.removed = true; };
FakeEl.prototype.focus = function focus() {};
Object.defineProperty(FakeEl.prototype, "isConnected", { get() { return !this.removed; } });
const flush = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setImmediate(r)); };

const F = "../custom_components/meshroute_topology_explorer/frontend/";
const { createLoader } = await import(`${F}ui/history-loader.js`);
const { openHistoryWindow, forgetTab, rememberedTab } = await import(`${F}ui/history-window.js`);
const { HistoryHost } = await import(`${F}ui/history-host.js`);
const { renderDetails } = await import(`${F}engines/zigbee/ui/details-tab.js`);
const { buildThreadNetwork } = await import(`${F}engines/thread/model.js`);
const { translator } = await import(`${F}ui/i18n.js`);
const { resolveTheme } = await import(`${F}graph/palette.js`);
const { INTEGRATION_PATH } = await import(`${F}ui/ha-links.js`);
const { timeText } = await import(`${F}ui/history-chart.js`);
const { routeAt } = await import(`${F}ui/history-route.js`);
const { historyCaps, pairHops: pairHopsOf } = await import(`${F}engines/index.js`);

const t = translator("en");
const theme = resolveTheme({});
const { network, response, last } = sampleHistory();
const now = last + 3600;
const text = (el) => el.textContent;
const find = (root, test) => root.find(test);
const cls = (e) => e.className || e.attrs.class || "";
const buttons = (root) => find(root, (e) => e.tag === "button");
const button = (root, label) => buttons(root).find((b) => text(b) === label);
const click = (el, init) => el.click(init);

function loaderOf(info = { record: true, keep_days: 30, last_error: null }, resp = response, net = network) {
  const { callWS, calls } = callWsFor(resp, info);
  return { calls, loader: createLoader({ callWS, network: () => net, now: () => now }) };
}

/** Open the window on the pair with the changing route; `extra` overrides the context. */
async function open({ info, tab, lane, net = network, resp = response, pair } = {}) {
  const { loader, calls } = loaderOf(info, resp, net);
  const root = new FakeEl("div");
  const [a, b] = pair || changingPair();
  const w = openHistoryWindow({ root, t, theme: () => theme, loader, network: () => net, a, b, tab, lane, now: () => now, zone: "UTC",
    positionOf: (id) => { const i = net.devices.findIndex((d) => d.id === id); return { x: i * 7 % 50, y: i * 13 % 40 }; }, timers: globalThis });
  await flush();
  return { w, root, calls, a, b };
}

let cached = null;
/** A pair whose route changes in the sample (so the last record has earlier routes: ghosts). */
function changingPair() {
  if (cached) return cached;
  const ids = network.devices.map((d) => d.id);
  const { createHistory } = globalThis.__createHistory;
  const history = createHistory({ response, live: network.live });
  for (const a of ids) for (const b of ids) {
    if (a >= b) continue;
    const tl = history.timeline(a, b);
    const lastSpan = tl.spans.at(-1);
    if (tl.spans.length < 2 || !lastSpan.there.complete || !lastSpan.back.complete || !lastSpan.there.hops.length) continue;
    const route = routeAt({ caps: historyCaps(network), tl, index: tl.points.length - 1, t });
    if (route.items.some((i) => i.ghost)) return (cached = [a, b]);
  }
  throw new Error("no changing pair");
}
globalThis.__createHistory = await import(`${F}engines/zigbee/history.js`);

test("the window: header 'A ⇄ B', the tabs, ranges limited to Keep for, close removes it", async () => {
  forgetTab();
  const { w, root, a, b } = await open({ info: { record: true, keep_days: 7, last_error: null } });
  const label = (id) => network.devices.find((d) => d.id === id).label;
  assert.equal(text(find(w.el, (e) => cls(e) === "hist-title")[0]), `${label(a)} ⇄ ${label(b)}`);
  const tabs = find(w.el, (e) => cls(e).startsWith("htab")).map(text);
  assert.deepEqual(tabs, ["Timeline", "Route", "Lane"]);
  assert.equal(w.state.tab, "timeline");
  const ranges = find(w.el, (e) => cls(e).startsWith("seg") && e.tag === "button").map(text);
  assert.deepEqual(ranges, ["48 h", "7 d"], "keep 7 days: no 30 d or 90 d");
  assert.deepEqual(find(w.el, (e) => e.tag === "svg" && cls(e) === "hist-timeline").length, 2, "one chart per direction");
  w.close();
  assert.ok(w.el.removed);
  assert.equal(root.children.length, 1);
});

test("the window remembers the tab it was last used on", async () => {
  forgetTab();
  const first = await open();
  click(button(first.w.el, "Route"));
  await flush();
  assert.equal(first.w.state.tab, "route");
  first.w.close();
  const second = await open();
  assert.equal(second.w.state.tab, "route", "the badge opens on the last tab");
  assert.equal(rememberedTab(), "route");
});

test("states without data: not recorded (with the Settings link), no records yet, source not supported, failed", async () => {
  const empty = { ...response, records: [] };
  const off = await open({ info: { record: false, keep_days: 30, last_error: null }, resp: empty });
  assert.match(text(off.w.el), /Reception history is not recorded\./);
  const link = find(off.w.el, (e) => e.tag === "a")[0];
  assert.equal(link.href, INTEGRATION_PATH);
  assert.match(text(link), /Settings/);
  assert.equal(find(off.w.el, (e) => e.tag === "svg" && cls(e) === "hist-timeline").length, 0);
  assert.match(text((await open({ resp: empty })).w.el), /No records in this range yet\./);
  const bad = await open({ info: { record: true, keep_days: 30, last_error: "zha/devices: handler missing" }, resp: empty });
  assert.match(text(bad.w.el), /cannot be recorded for this source: zha\/devices: handler missing/);
  const failing = createLoader({ callWS: async () => { throw { message: "Unauthorized" }; }, network: () => network, now: () => now });
  const root = new FakeEl("div");
  const [a, b] = changingPair();
  const w = openHistoryWindow({ root, t, theme: () => theme, loader: failing, network: () => network, a, b, now: () => now });
  await flush();
  assert.match(text(w.el), /could not be read: Unauthorized/);
});

test("fewer than 3 records in the range: a note, points only", async () => {
  const { w } = await open();
  assert.match(text(w.el), /Fewer than 3 records: points only/);
});

/** Open on the Route tab, 7 d, and give the hits of the last drawing. */
async function routeTab() {
  forgetTab();
  const o = await open({ tab: "route" });
  click(button(o.w.el, "7 d"));
  await flush();
  return { ...o, view: () => o.w.routeView() };
}
const canvasOf = (o) => find(o.w.el, (e) => e.tag === "canvas")[0];
const clickPill = (o, hit) => canvasOf(o).listeners.click[0]({ clientX: hit.x, clientY: hit.y });

test("a click on a pill opens the Lane tab for that hop, centred on the record shown, its two nodes ringed", async () => {
  const o = await routeTab();
  const hits = o.view().hits();
  assert.ok(hits.length >= 2);
  const hit = hits.find((h) => !h.item.ghost && h.item.dir === "back") || hits.find((h) => !h.item.ghost);
  const item = hit.item;
  clickPill(o, hit);
  await flush();
  const lane = o.w.state.lane;
  assert.equal(o.w.state.tab, "lane");
  assert.deepEqual([lane.x, lane.y], [item.sender, item.hearer], "X = the hop's sender, Y = its hearer (blue: Y hears X)");
  const c = lane.context;
  assert.deepEqual([c.direction, c.hopIndex, c.sender, c.hearer, c.ghost], [item.dir, item.hopIndex, item.sender, item.hearer, false]);
  assert.equal(c.index, o.w.state.route.index, "the record the slider showed");
  assert.deepEqual(o.w.state.route.sel, { dir: item.dir, sender: item.sender, hearer: item.hearer });
  const label = (id) => network.devices.find((d) => d.id === id).label;
  assert.match(text(find(o.w.el, (e) => cls(e) === "hist-lane-title")[0]), new RegExp(`^Lane: ${label(item.sender)} ⇄ ${label(item.hearer)}$`));
  const from = text(find(o.w.el, (e) => cls(e).includes("hist-lane-from"))[0]);
  assert.equal(from, `${item.dir === "back" ? "way back" : "way there"}, ${timeText(c.t, "en", "UTC")}: hop ${c.hopIndex + 1} of ${c.hopCount}`);
  const ringed = find(o.w.el, (e) => cls(e).includes("strip-node") && cls(e).includes("ringed")).map((e) => e.getAttribute("data-id"));
  assert.deepEqual(ringed.sort(), [item.sender, item.hearer].sort(), "the lane's two nodes, nothing else");
  assert.match(text(o.w.el), /Show as table/);
  // The window choices of a pill click, and the chart's dashed line at the clicked record.
  assert.deepEqual(find(o.w.el, (e) => cls(e).startsWith("seg") && e.tag === "button").map(text), ["±24 h", "±48 h", "±7 d", "±30 d"]);
  assert.equal(find(o.w.el, (e) => cls(e) === "clicked").length, 1);
  // Back on Route: the clicked pill's nodes are ringed (accent outline), two stations in its row.
  click(button(o.w.el, "Route"));
  await flush();
  const ctx = canvasOf(o).getContext("2d");
  const rings = ctx.calls.filter((x) => x[0] === "roundRect");
  assert.equal(rings.length, 2, "two ringed stations in the Metro-Map");
});

test("a ghost's pill opens its lane too, marked as a ghost", async () => {
  const o = await routeTab();
  const ghost = o.view().hits().find((h) => h.item.ghost);
  assert.ok(ghost, "the last record of a changing pair has earlier routes");
  clickPill(o, ghost);
  await flush();
  assert.equal(o.w.state.lane.context.ghost, true);
});

test("the lane from a Details row: last 48 h, no window choices, the strip shows just the two", async () => {
  const [a, b] = changingPair();
  forgetTab();
  const o = await open({ lane: { x: a, y: b } });
  assert.equal(o.w.state.tab, "lane");
  assert.deepEqual(find(o.w.el, (e) => cls(e).split(" ").includes("seg")).map(text), ["last 48 h"]);
  assert.equal(find(o.w.el, (e) => cls(e).includes("strip-node")).length, 2);
  assert.equal(text(find(o.w.el, (e) => cls(e).includes("hist-lane-from"))[0]), "last 48 h");
});

// ---- Thread -----------------------------------------------------------------------------------------------------

const matter = JSON.parse(readFileSync(new URL("./fixtures/matter-sample.json", import.meta.url), "utf8")).responses["matter/network_topology"];
const threadNet = buildThreadNetwork(matter);

test("Thread pair: pills stacked RSSI over LQI, no route bands, no weakest hop", async () => {
  const [a, b] = threadNet.devices.map((d) => d.id);
  const stamps = [now - 3 * 86400, now - 2 * 86400, now - 86400, now - 3600];
  const c = threadNet.devices[2].id;
  const resp = { k: [a, b, c], records: stamps.map((s, i) => ({ t: s, e: [[0, 1, 3 - (i % 2), -70 - i], [1, 0, 2, -80 + i], [0, 2, 1, -90]] })) };
  const { loader } = loaderOf({ record: true, keep_days: 30, last_error: null }, resp, threadNet);
  const root = new FakeEl("div");
  const w = openHistoryWindow({ root, t, theme: () => theme, loader, network: () => threadNet, a, b, now: () => now, zone: "UTC", tab: "timeline",
    positionOf: (id) => ({ x: id === a ? 0 : 20, y: id === a ? 0 : 10 }) });
  await flush();
  click(button(w.el, "7 d"));
  await flush();
  assert.match(text(w.el), /Thread has no routing table/);
  assert.equal(find(w.el, (e) => e.tag === "svg" && cls(e) === "hist-timeline").length, 0, "no bands");
  click(button(w.el, "Route"));
  await flush();
  const hits = w.routeView().hits();
  assert.deepEqual(hits.map((h) => h.item.dir).sort(), ["back", "there"], "the direct link both ways");
  for (const h of hits) assert.match(h.item.text, /^−\d+ dBm\nLQI \d$/);
  assert.ok(hits.every((h) => h.h > 20), "taller pills for two lines");
  assert.match(text(w.el), /Neighbours in this record: .*\(\u221290 dBm, LQI 1\)/, "the Metro-Map lists the neighbours, the Mesh draws them");
  click(button(w.el, "Mesh"));
  assert.equal(w.routeView().hits().length >= 2, true);
  clickPill({ w }, w.routeView().hits()[0]);
  await flush();
  assert.equal(w.state.tab, "lane");
  assert.equal(find(w.el, (e) => e.tag === "svg" && cls(e) === "hist-chart").length, 2, "LQI chart and RSSI chart: never one chart with two axes");
});

// ---- Details rows ------------------------------------------------------------------------------------------------

test("Details: every 'Heard by · hears' row has a sparkline cell the host fills; a click opens the lane on the last 48 h", async () => {
  const container = new FakeEl("div");
  const coordinator = network.devices.find((d) => d.role === "coordinator").id;
  const { loader } = loaderOf();
  const root = new FakeEl("div");
  const host = new HistoryHost({ root: () => root, callWS: null, network: () => network, theme: () => theme, t: () => t, view: () => null, now: () => now, zone: "UTC" });
  host.loader = loader;
  let slots = null;
  let note = null;
  renderDetails(container, { network, t, id: coordinator, debug: false, raw: new Map(), stage: "coordinator", returnRoutes: false, sourceRoute: "off",
    sub: "communication", idPrefix: "d", pinned: false, onSub() {}, onSelect() {}, onRelease() {}, onCluster() {}, onFindings() {},
    history: { fill: (s, n) => { slots = s; note = n; } } });
  assert.ok(slots && slots.length > 0);
  assert.ok(slots.every((s) => (s.kind === "heardBy" || s.kind === "hears") && s.cell.className === "reading-spark"));
  assert.ok(slots.some((s) => s.kind === "heardBy"));
  await host.fillRows(coordinator, slots, note);
  const filled = slots.filter((s) => s.cell.children.length);
  assert.ok(filled.length > 0, "rows with records get a sparkline");
  const first = filled[0];
  const [btn] = first.cell.children;
  assert.match(text(btn), /^48 h -?\d+–-?\d+$/);
  assert.ok(find(btn, (e) => e.tag === "svg").length === 1);
  click(btn, { currentTarget: btn });
  await flush();
  assert.equal(host.window.state.tab, "lane");
  assert.deepEqual([host.window.state.lane.x, host.window.state.lane.y, host.window.state.lane.fromRow], [coordinator, first.other, true]);
  host.window.close();
});

test("Details: with recording off one line replaces the sparklines; Details without history keep their rows as before", async () => {
  const coordinator = network.devices.find((d) => d.role === "coordinator").id;
  const { loader } = loaderOf({ record: false, keep_days: 30, last_error: null }, { ...response, records: [] });
  const host = new HistoryHost({ root: () => new FakeEl("div"), callWS: null, network: () => network, theme: () => theme, t: () => t, view: () => null, now: () => now });
  host.loader = loader;
  const slot = { cell: new FakeEl("span"), other: network.devices[1].id, kind: "heardBy" };
  const note = new FakeEl("p");
  await host.fillRows(coordinator, [slot], note);
  assert.match(text(note), /Reception history is not recorded\./);
  assert.equal(slot.cell.children.length, 0);
  const plain = new FakeEl("div");
  renderDetails(plain, { network, t, id: coordinator, debug: false, raw: new Map(), stage: "coordinator", returnRoutes: false, sourceRoute: "off",
    sub: "communication", idPrefix: "d", pinned: false, onSub() {}, onSelect() {}, onRelease() {}, onCluster() {}, onFindings() {}, history: null });
  assert.equal(find(plain, (e) => cls(e) === "reading-spark").length, 0, "no cell without a history host");
});

test("badge tooltip: 'Path history with {selected}' and the hop counts of the live network, singular for one hop", () => {
  const host = new HistoryHost({ root: () => new FakeEl("div"), callWS: null, network: () => network, theme: () => theme, t: () => t, view: () => null });
  const coordinator = network.devices.find((d) => d.role === "coordinator");
  const other = network.devices.find((d) => d.id !== coordinator.id && d.role === "router");
  const [title, hops] = host.badgeText(coordinator.id, other.id).split("\n");
  assert.equal(title, "Path history with Coordinator");
  assert.match(hops, /^there \d+ hops? · back \d+ hops?$/);
  const word = (n) => (n === 1 ? "1 hop" : `${n} hops`);
  const walk = (a, b) => pairHopsOf(network, a, b);
  assert.equal(hops, `there ${word(walk(coordinator.id, other.id).there)} · back ${word(walk(coordinator.id, other.id).back)}`);
  const threadHost = new HistoryHost({ root: () => new FakeEl("div"), callWS: null, network: () => threadNet, theme: () => theme, t: () => t, view: () => null });
  const [x, y] = threadNet.devices.map((d) => d.id);
  assert.equal(threadHost.badgeText(x, y).split("\n").length, 1, "no routing table: no hop counts");
});

test("Lane: a direction without any value says why, an end device keeps no neighbour table", async () => {
  const [a, b] = changingPair();
  const end = network.devices.find((d) => d.role === "end device" && network.devices.some((p) => p.id === d.parent));
  const parent = end.parent;
  const o = await open({ lane: { x: parent, y: end.id }, pair: [parent, end.id] });
  const label = (id) => network.devices.find((d) => d.id === id).label;
  const legend = text(find(o.w.el, (e) => cls(e) === "hist-legend small")[0]);
  assert.match(legend, new RegExp(`no values: ${label(end.id)} is an end device and keeps no neighbour table`));
  assert.ok(!legend.includes(`no values: ${label(parent)}`), "the direction that has values says nothing");
  void a; void b;
});
