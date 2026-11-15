// SPDX-License-Identifier: MIT
// One-click entries to the path history window (owner 2026-11-05, spec 9.2, 9.5): the partner rule of the "History to
// gateway" button (#24, owner 2026-11-15: the coordinator; Thread the border router of a complete route, else the only
// border router; none on a coordinator or border router itself), the button and the "history ↗" links in Details, the
// window's partner menu (order, search, tab and range kept) and the terms: no user-visible "Lane". Pill hit area and
// click are in graph-badges.test.mjs. Expected partners come from the issue's rules and the fixtures' hand-checked
// routes (tests/thread-routes-fixture.mjs). Fake DOM, committed samples. npm test
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
const { neighboursByReception, partnerChoices } = await import(`${F}ui/history-partners.js`);
const { HISTORY_TEXTS } = await import(`${F}ui/history-texts.js`);
const { partnerOf } = await import(`${F}ui/history-links.js`);
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
const { idOf, threadRoutesSample } = await import("./thread-routes-fixture.mjs");
const routes = threadRoutesSample();
const routed = buildThreadNetwork(routes.topology, { tables: routes.tables, deviceRegistry: routes.registry });
const gateway = (net, id) => historyCaps(net).gateway(net, id);

test("#24 Zigbee: the partner is the coordinator, on every device but the coordinator itself", () => {
  assert.equal(gateway(network, router), coordinator);
  assert.ok(network.devices.filter((d) => d.id !== coordinator).every((d) => gateway(network, d.id) === coordinator));
  assert.equal(gateway(network, coordinator), null, "the coordinator has no single gateway path");
  assert.equal(gateway(network, "nobody"), null);
  // A network without a coordinator, or (malformed) with two: no single gateway.
  const dev = (id, role) => ({ id, label: id, role });
  assert.equal(gateway({ ...network, devices: [dev("x", "router")] }, "x"), null);
  assert.equal(gateway({ ...network, devices: [dev("x", "router"), dev("c1", "coordinator"), dev("c2", "coordinator")] }, "x"), null);
});

test("#24 Thread, two border routers with routes: the border router the route card names", () => {
  // Hand-checked in the fixture: the motion sensor's lowest path cost goes to border router B (4), plug 1's to A (2).
  assert.equal(gateway(routed, idOf("XS")), idOf("BRB"));
  assert.equal(gateway(routed, idOf("P1")), idOf("BRA"));
  assert.equal(routed.routing.defaultRoute(idOf("XS")).to, idOf("BRB"), "the route card's border router");
  for (const br of ["BRA", "BRB"]) assert.equal(gateway(routed, idOf(br)), null, "a border router itself: none");
});

test("#24 Thread, two border routers without a complete route: no button; one border router: that one", () => {
  // Route tables not read: no route at all, two border routers on the map.
  const plain = buildThreadNetwork(routes.topology, { deviceRegistry: routes.registry });
  assert.equal(plain.routing, null);
  assert.equal(gateway(plain, idOf("XS")), null);
  // Plug 2 offline for Matter: the motion sensor's way there stops at its parent; the card still names a border router.
  const s = threadRoutesSample();
  s.tables.nodes.find((x) => x.node_id === 22).available = false;
  const stopped = buildThreadNetwork(s.topology, { tables: s.tables, deviceRegistry: s.registry });
  const r = stopped.routing.defaultRoute(idOf("XS"));
  assert.equal(r.there.complete, false);
  assert.equal(gateway(stopped, idOf("XS")), null, "a stopped route among two border routers is no single path");
  // The Matter sample: one border router, no route tables: it is the partner of every other device.
  const br = threadNet.devices.filter((d) => d.role === "border router");
  assert.equal(br.length, 1);
  assert.equal(threadNet.routing, null);
  assert.ok(threadNet.devices.filter((d) => d.role !== "border router").every((d) => gateway(threadNet, d.id) === br[0].id));
  assert.equal(gateway(threadNet, br[0].id), null, "the border router itself: none");
});

function detailsCtx(net, id, extra = {}) {
  return { network: net, t, id, debug: false, raw: new Map(), stage: "coordinator", returnRoutes: false, sourceRoute: "off", sub: "communication",
    idPrefix: "d", pinned: false, onSub() {}, onSelect() {}, onRelease() {}, onCluster() {}, onFindings() {}, ...extra };
}

test("#24 Thread, a stopped route and one border router: that one; a complete route beside an unheard one: the route's", () => {
  // The #20 fixture's snapshot alone holds one border router (garage); route tables without a node stop every route.
  const fixture = JSON.parse(readFileSync(new URL("./fixtures/thread-border-routers.json", import.meta.url), "utf8")).responses;
  const one = buildThreadNetwork(fixture["matter/network_topology"], { tables: { nodes: [], read_at: 1767268800, observe_seconds: 600 } });
  const end = one.devices.find((d) => d.role === "end device").id;
  const brs = one.devices.filter((d) => d.role === "border router");
  assert.equal(brs.length, 1);
  assert.equal(one.routing.defaultRoute(end).there.complete, false);
  assert.equal(gateway(one, end), brs[0].id);
  // The routes sample plus a border router only Home Assistant lists: three on the map; the sensor's complete route
  // goes to border router B, which is the partner whatever else the map holds.
  const loft = { instance_name: "Border router loft", extended_address: "aabbccdd000000ff", extended_pan_id: "aabbccddeeff0099",
    vendor_name: "OpenThread", model_name: "BorderRouter" };
  const three = buildThreadNetwork(routes.topology, { tables: routes.tables, deviceRegistry: routes.registry,
    haThread: { datasets: null, routers: [loft] } });
  assert.equal(three.devices.filter((d) => d.role === "border router").length, 3);
  assert.equal(three.devices.find((d) => d.label === "Border router loft").inTopology, false);
  assert.equal(three.routing.defaultRoute(idOf("XS")).there.complete, true);
  assert.equal(gateway(three, idOf("XS")), idOf("BRB"));
});

test("#24 Zigbee path lines keep main's partner, the first anchor (of two coordinators the better linked); the button has none", () => {
  const dev = (id, role) => ({ id, label: id, role });
  const dir = (lqi) => ({ state: "measured", lqi, rssi: null });
  const net = { engine: "zigbee", capabilities: {}, devices: [dev("x", "router"), dev("c1", "coordinator"), dev("c2", "coordinator")],
    pairs: [{ a: "c1", b: "x", ab: dir(40), ba: dir(60) }, { a: "c2", b: "x", ab: dir(200), ba: dir(180) }] };
  assert.equal(partnerOf({ network: net }, "x"), "c2", "the 'history ↗' of an up or down path line");
  assert.equal(gateway(net, "x"), null, "the button: no single coordinator");
  assert.equal(partnerOf({ network }, router), coordinator, "one coordinator: line and button agree");
});

test("#24 the partner menu is unchanged: anchors best linked first, then the neighbours strongest first, ties by RSSI", () => {
  const dev = (id, role = "router") => ({ id, label: id, role });
  const dir = (lqi, rssi) => ({ state: "measured", lqi, rssi });
  const net = { devices: [dev("x"), dev("a"), dev("b"), dev("c"), dev("d"), dev("br1", "border router"), dev("br2", "border router")],
    pairs: [{ a: "x", b: "a", ab: dir(3, -60), ba: dir(2, -70) }, { a: "b", b: "x", ab: dir(1, -85), ba: null },
      { a: "x", b: "c", ab: dir(2, -75), ba: dir(2, -72) }, { a: "d", b: "x", ab: dir(3, -65), ba: dir(1, -90) },
      { a: "x", b: "br1", ab: dir(1, -88), ba: dir(1, -90) }, { a: "br2", b: "x", ab: dir(3, -55), ba: dir(3, -58) }] };
  // By hand, the better direction of each pair: br2 LQI 3 at -55, a 3 at -60, d 3 at -65, c 2 at -72, b 1 at -85,
  // br1 1 at -88.
  assert.deepEqual(neighboursByReception(net, "x").map((n) => n.id), ["br2", "a", "d", "c", "b", "br1"]);
  assert.deepEqual(partnerChoices(net, "x", "border router").map((c) => [c.id, c.group]),
    [["br2", "anchor"], ["br1", "anchor"], ["a", "neighbour"], ["d", "neighbour"], ["c", "neighbour"], ["b", "neighbour"]]);
});

test("#24 Details: 'History to gateway' names its partner and opens the pair; path lines carry 'history ↗'; none without a history host", () => {
  const opened = [];
  const history = { fill() {}, open: (a, b) => opened.push([a, b]) };
  const box = new FakeEl("div");
  renderDetails(box, detailsCtx(network, router, { history }));
  const [btn] = find(box, (e) => cls(e).includes("history-button"));
  assert.equal(text(btn), "History to gateway");
  assert.equal(btn.title, `Path history with ${label(coordinator)}`);
  assert.equal(btn.getAttribute("aria-label"), `History to gateway: Path history with ${label(coordinator)}`, "the visible label first");
  btn.click({ currentTarget: btn });
  assert.deepEqual(opened.pop(), [router, coordinator]);
  const links = find(box, (e) => cls(e).includes("history-link"));
  assert.ok(links.length >= 1 && links.every((l) => text(l) === "history ↗"), "up and down path lines");
  links[0].click({ currentTarget: links[0] });
  assert.deepEqual(opened.pop(), [router, coordinator]);
  // The coordinator: no button (no single gateway path); its route lines keep their links to each destination.
  const cbox = new FakeEl("div");
  renderDetails(cbox, detailsCtx(network, coordinator, { history }));
  assert.equal(find(cbox, (e) => cls(e).includes("history-button")).length, 0);
  const routeLinks = find(cbox, (e) => cls(e).includes("history-link"));
  assert.ok(routeLinks.length >= 1);
  routeLinks[0].click({ currentTarget: routeLinks[0] });
  assert.equal(opened.pop()[0], coordinator, "a route line opens the coordinator with that route's other end");
  // Non-administrators get no history host: no button and no links.
  const plain = new FakeEl("div");
  renderDetails(plain, detailsCtx(network, router, { history: null }));
  assert.equal(find(plain, (e) => cls(e).includes("history-button") || cls(e).includes("history-link")).length, 0);
});

test("#24 Details of a Thread device: the button pairs it with its route's border router; none on a border router", () => {
  const opened = [];
  const ctx = (net, id) => ({ network: net, t, id, onSelect() {}, onFindings() {}, history: { open: (a, b) => opened.push([a, b]) } });
  const box = new FakeEl("div");
  renderThreadDetails(box, ctx(routed, idOf("XS")));
  const [btn] = find(box, (e) => cls(e).includes("history-button"));
  assert.equal(text(btn), "History to gateway");
  assert.equal(btn.title, "Path history with Border router B");
  btn.click({ currentTarget: btn });
  assert.deepEqual(opened.pop(), [idOf("XS"), idOf("BRB")]);
  const br = new FakeEl("div");
  renderThreadDetails(br, ctx(routed, idOf("BRA")));
  assert.equal(find(br, (e) => cls(e).includes("history-button")).length, 0);
  const none = new FakeEl("div");
  renderThreadDetails(none, ctx(buildThreadNetwork(routes.topology, {}), idOf("XS")));
  assert.equal(find(none, (e) => cls(e).includes("history-button")).length, 0, "two border routers, no route: none");
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
