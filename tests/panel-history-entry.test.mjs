// SPDX-License-Identifier: MIT
// One-click entries to the path history window (owner 2026-11-05, spec 9.2, 9.5): the partner rules of the History
// button (coordinator / strongest border router; an anchor itself: its strongest neighbour), the button and the
// "history ↗" links in Details, the window's partner menu (order, search, tab and range kept) and the terms: no
// user-visible "Lane". Pill hit area and click are in graph-badges.test.mjs. Fake DOM, committed samples. npm test
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FakeEl, installFakeDom } from "./dom-fake.mjs";
import { recordingContext } from "./graph-fakes.mjs";
import { callWsFor, sampleHistory } from "./history-ui-fixture.mjs";

installFakeDom();
FakeEl.prototype.getContext = function getContext() { return (this.ctx ||= recordingContext({ props: true })); };
FakeEl.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, width: 600, height: 300 });
FakeEl.prototype.remove = function remove() { this.removed = true; };
FakeEl.prototype.focus = function focus() {};
Object.defineProperty(FakeEl.prototype, "isConnected", { get() { return !this.removed; } });
const flush = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setImmediate(r)); };

const F = "../custom_components/meshroute_topology_explorer/frontend/";
const { createLoader } = await import(`${F}ui/history-loader.js`);
const { HistoryHost } = await import(`${F}ui/history-host.js`);
const { openHistoryWindow, forgetTab } = await import(`${F}ui/history-window.js`);
const { renderDetails } = await import(`${F}engines/zigbee/ui/details-tab.js`);
const { renderThreadDetails } = await import(`${F}engines/thread/details.js`);
const { buildThreadNetwork } = await import(`${F}engines/thread/model.js`);
const { defaultPartner, neighboursByReception, partnerChoices } = await import(`${F}ui/history-partners.js`);
const { HISTORY_TEXTS } = await import(`${F}ui/history-texts.js`);
const { ENGINES, historyCaps } = await import(`${F}engines/index.js`);
const { translator } = await import(`${F}ui/i18n.js`);
const { resolveTheme } = await import(`${F}graph/palette.js`);

const t = translator("en");
const theme = resolveTheme({});
const { network, response, last } = sampleHistory();
const now = last + 3600;
const text = (el) => el.textContent;
const cls = (e) => e.className || e.attrs.class || "";
const find = (root, test) => root.find(test);
const buttons = (root) => find(root, (e) => e.tag === "button");
const label = (id) => network.devices.find((d) => d.id === id).label;
const anchorRole = historyCaps(network).anchorRole;
const coordinator = network.devices.find((d) => d.role === "coordinator").id;
const router = network.devices.find((d) => d.role === "router").id;

const matter = JSON.parse(readFileSync(new URL("./fixtures/matter-sample.json", import.meta.url), "utf8")).responses["matter/network_topology"];
const threadNet = buildThreadNetwork(matter);

test("partner of the History button: the coordinator; the coordinator itself: its strongest neighbour by reception", () => {
  assert.equal(defaultPartner(network, router, anchorRole), coordinator);
  const best = neighboursByReception(network, coordinator);
  assert.ok(best.length > 2);
  assert.ok(best.every((n, i) => !i || best[i - 1].score >= n.score), "sorted by reception, strongest first");
  assert.equal(defaultPartner(network, coordinator, anchorRole), best[0].id);
  assert.equal(defaultPartner(network, "nobody", anchorRole), null);
});

test("Thread: the border router with the strongest link; a border router itself: its strongest neighbour", () => {
  const role = historyCaps(threadNet).anchorRole;
  const brs = threadNet.devices.filter((d) => d.role === role);
  assert.ok(brs.length >= 1);
  const plain = threadNet.devices.find((d) => d.role !== role && neighboursByReception(threadNet, d.id).length);
  const chosen = defaultPartner(threadNet, plain.id, role);
  assert.ok(brs.some((b) => b.id === chosen));
  // Two border routers, one with a measured link and a better one: the better wins (a net built for the rule).
  const dev = (id, r) => ({ id, label: id, role: r });
  const dir = (lqi, rssi) => ({ state: "measured", lqi, rssi });
  const net = { devices: [dev("x", "router"), dev("b1", "border router"), dev("b2", "border router")],
    pairs: [{ a: "b1", b: "x", ab: dir(1, -80), ba: dir(1, -82) }, { a: "b2", b: "x", ab: dir(3, -60), ba: dir(2, -70) }] };
  assert.equal(defaultPartner(net, "x", "border router"), "b2");
  assert.equal(defaultPartner(net, "b1", "border router"), "x", "a border router: its only neighbour");
  assert.equal(defaultPartner({ devices: [dev("x", "router")], pairs: [] }, "x", "border router"), null, "no border router: no button");
});

function detailsCtx(net, id, extra = {}) {
  return { network: net, t, id, debug: false, raw: new Map(), stage: "coordinator", returnRoutes: false, sourceRoute: "off", sub: "communication",
    idPrefix: "d", pinned: false, onSub() {}, onSelect() {}, onRelease() {}, onCluster() {}, onFindings() {}, ...extra };
}

test("Details: a History button next to the name opens the pair; path lines carry 'history ↗'; none without a history host", () => {
  const opened = [];
  const history = { fill() {}, open: (a, b) => opened.push([a, b]) };
  const box = new FakeEl("div");
  renderDetails(box, detailsCtx(network, router, { history }));
  const [btn] = find(box, (e) => cls(e).includes("history-button"));
  assert.equal(text(btn), "History");
  assert.equal(btn.title, `History: ${label(router)} ⇄ ${label(coordinator)}`);
  btn.click({ currentTarget: btn });
  assert.deepEqual(opened.pop(), [router, coordinator]);
  const links = find(box, (e) => cls(e).includes("history-link"));
  assert.ok(links.length >= 1 && links.every((l) => text(l) === "history ↗"), "up and down path lines");
  links[0].click({ currentTarget: links[0] });
  assert.deepEqual(opened.pop(), [router, coordinator]);
  // The coordinator's button: its strongest neighbour.
  const cbox = new FakeEl("div");
  renderDetails(cbox, detailsCtx(network, coordinator, { history }));
  find(cbox, (e) => cls(e).includes("history-button"))[0].click({ currentTarget: cbox });
  assert.equal(opened.pop()[1], neighboursByReception(network, coordinator)[0].id);
  // Non-administrators get no history host: no button and no links.
  const plain = new FakeEl("div");
  renderDetails(plain, detailsCtx(network, router, { history: null }));
  assert.equal(find(plain, (e) => cls(e).includes("history-button") || cls(e).includes("history-link")).length, 0);
});

test("Details of a Thread device: the button pairs it with its border router", () => {
  const role = historyCaps(threadNet).anchorRole;
  const plain = threadNet.devices.find((d) => d.role !== role && neighboursByReception(threadNet, d.id).length);
  const opened = [];
  const box = new FakeEl("div");
  renderThreadDetails(box, { network: threadNet, t, id: plain.id, onSelect() {}, onFindings() {}, history: { open: (a, b) => opened.push([a, b]) } });
  const [btn] = find(box, (e) => cls(e).includes("history-button"));
  btn.click({ currentTarget: btn });
  assert.equal(opened[0][0], plain.id);
  assert.equal(threadNet.devices.find((d) => d.id === opened[0][1]).role, role);
});

async function openWindow(pair, tab) {
  const { callWS } = callWsFor(response, { record: true, keep_days: 90, last_error: null });
  const loader = createLoader({ callWS, network: () => network, now: () => now });
  const w = openHistoryWindow({ root: new FakeEl("div"), t, theme: () => theme, loader, network: () => network, a: pair[0], b: pair[1], tab,
    now: () => now, zone: "UTC", positionOf: () => ({ x: 0, y: 0 }), timers: globalThis });
  await flush();
  return w;
}
const partnerButton = (w) => find(w.el, (e) => cls(e).includes("hist-partner"))[0];
const choices = (w) => find(w.el, (e) => cls(e).split(" ").includes("hist-choice"));
const titleOf = (w) => text(find(w.el, (e) => cls(e) === "hist-title")[0]);

test("partner menu: coordinator first, then the first device's neighbours by reception, a search over all; keeps tab and range", async () => {
  forgetTab();
  const w = await openWindow([router, coordinator], "route");
  assert.equal(w.state.tab, "route");
  find(w.el, (e) => e.tag === "button" && text(e) === "30 d")[0].click();
  await flush();
  assert.equal(w.state.range, "30d");
  partnerButton(w).click();
  const expected = [coordinator, ...neighboursByReception(network, router).map((n) => n.id).filter((id) => id !== coordinator)].slice(0, 13);
  assert.deepEqual(choices(w).map((c) => text(c.children[0])), expected.map(label), "anchor first, then neighbours, strongest first");
  assert.equal(text(choices(w)[0]).trim(), "Coordinator", "no duplicate role beside a name equal to it (#5)");
  // Search over all devices, not only neighbours.
  const stranger = network.devices.find((d) => d.id !== router && !expected.includes(d.id) && !neighboursByReception(network, router).some((n) => n.id === d.id));
  const search = find(w.el, (e) => e.tag === "input")[0];
  search.value = stranger.label;
  search.listeners.input[0]();
  assert.ok(choices(w).some((c) => text(c.children[0]) === stranger.label));
  const pick = choices(w).find((c) => text(c.children[0]) === stranger.label);
  pick.click();
  await flush();
  assert.equal(titleOf(w), `${label(router)} ⇄ ${stranger.label} ▾`);
  assert.equal(w.state.tab, "route", "the tab stays");
  assert.equal(w.state.range, "30d", "the range stays");
  assert.deepEqual([w.state.lane.x, w.state.lane.y], [router, stranger.id]);
  w.close();
});

test("partner menu (#5): an anchor whose role differs from its name still shows the role, case and spaces ignored when equal", async () => {
  forgetTab();
  const dev = network.devices.find((d) => d.id === coordinator);
  const saved = dev.label;
  try {
    dev.label = "Main gateway";
    let w = await openWindow([router, coordinator], "route");
    partnerButton(w).click();
    assert.equal(text(choices(w)[0]), "Main gatewayCoordinator", "different name: role shown");
    w.close();
    dev.label = "  coordinator ";
    w = await openWindow([router, coordinator], "route");
    partnerButton(w).click();
    assert.equal(text(choices(w)[0]).trim(), "coordinator", "same up to case and spaces: role hidden");
    w.close();
  } finally {
    dev.label = saved;
  }
});

test("partnerChoices: the device itself is never offered; a query filters by name", () => {
  const all = partnerChoices(network, router, anchorRole, "");
  assert.ok(all.every((c) => c.id !== router));
  assert.equal(all[0].group, "anchor");
  const q = label(coordinator).slice(0, 4).toLowerCase();
  assert.ok(partnerChoices(network, router, anchorRole, q).every((c) => label(c.id).toLowerCase().includes(q)));
});

test("terms: the window tab is 'Direct link'; no user-visible 'Lane' in the texts or on any tab", async () => {
  const words = (v) => /\blanes?\b/i.test(v);
  for (const [k, v] of Object.entries({ ...HISTORY_TEXTS, ...ENGINES.zigbee.texts, ...ENGINES.thread.texts })) {
    assert.ok(!words(v), `${k}: "${v}"`);
  }
  for (const tab of ["timeline", "route", "lane"]) {
    const w = await openWindow([router, coordinator], tab);
    assert.ok(!words(text(w.el)), `tab ${tab}: ${text(w.el).match(/.{0,20}\blanes?\b.{0,20}/i)}`);
    assert.ok(buttons(w.el).some((b) => text(b) === "Direct link"));
    w.close();
  }
});

// ---- the pill's small Direct link card (owner 2026-11-05, spec 9.5, board M37b B) -----------------------------------

function cardHost(info = { record: true, keep_days: 90, last_error: null }, answer = response) {
  const { callWS } = callWsFor(answer, info);
  const root = new FakeEl("div");
  const host = new HistoryHost({ root: () => root, callWS, network: () => network, theme: () => theme, t: () => t, view: () => null,
    now: () => now, zone: "UTC", timers: globalThis });
  const map = new FakeEl("div");
  const links = [{ sender: router, hearer: coordinator, text: "64", lqi: 64, rssi: null, rankPct: 45 },
    { sender: coordinator, hearer: router, text: "120", lqi: 120, rssi: null, rankPct: null }];
  return { host, map, links, show: (at = { x: 100, y: 80 }) => host.showCard(map, at, router, coordinator, links) };
}
const keydown = (el, key) => el.listeners.keydown[0]({ key, preventDefault() {}, stopPropagation() {} });

test("the pill card: title, both directions in one line each with a 48 h line, no window yet", async () => {
  const { host, show } = cardHost();
  show();
  await flush();
  const card = host.card.el;
  assert.equal(host.window, null, "a card first, not the window");
  assert.ok(text(card).includes(`Direct link: ${label(router)} ⇄ ${label(coordinator)}`));
  assert.ok(text(card).includes(`${label(coordinator)} hears ${label(router)} · 64 · rank 45 %`));
  assert.ok(text(card).includes(`${label(router)} hears ${label(coordinator)} · 120`) && !text(card).includes("120 · rank"));
  assert.ok(find(card, (e) => cls(e) === "spark").length >= 1, "a sparkline once the history is loaded");
});

test("the card's buttons open the window on Direct link (last 48 h) or on Timeline, for the same pair, and close the card", async () => {
  const { host, show } = cardHost();
  show();
  await flush();
  const [direct, route] = find(host.card.el, (e) => cls(e).includes("button") && e.tag === "button");
  assert.equal(text(direct), "Direct link history ⇄");
  assert.equal(text(route), "Route history");
  direct.click();
  await flush();
  assert.equal(host.card, null);
  assert.equal(host.window.state.tab, "lane");
  assert.equal(host.window.state.range, "48h");
  assert.deepEqual([host.window.state.lane.x, host.window.state.lane.y], [router, coordinator]);
  show();
  find(host.card.el, (e) => cls(e).includes("button") && e.tag === "button")[1].click();
  await flush();
  assert.equal(host.window.state.tab, "timeline");
  assert.equal(host.card, null);
});

test("the card closes with the x button, Escape and closeCard (a tap on the map); a second pill replaces it", async () => {
  const { host, map, show } = cardHost();
  show();
  const first = host.card;
  find(first.el, (e) => cls(e).includes("card-close"))[0].click();
  assert.equal(host.card, null);
  assert.ok(first.el.removed);
  show();
  keydown(host.card.el, "Escape");
  assert.equal(host.card, null);
  show();
  host.closeCard();
  assert.equal(host.card, null);
  show();
  const older = host.card;
  show({ x: 300, y: 200 });
  assert.ok(older.el.removed, "one card at a time");
  assert.notEqual(host.card, older);
  assert.equal(map.children.filter((c) => !c.removed).length, 1, "only the new card is left");
});

test("the card without a recording shows the values and says why there is no line", async () => {
  const { host, show } = cardHost({ record: false, keep_days: null, last_error: null }, { k: response.k, records: [] });
  show();
  await flush();
  assert.ok(text(host.card.el).includes("64"));
  assert.ok(text(host.card.el).includes("Reception history is not recorded."));
  assert.equal(find(host.card.el, (e) => cls(e) === "spark").length, 0);
});
