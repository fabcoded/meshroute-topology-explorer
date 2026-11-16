// SPDX-License-Identifier: MIT
// #25: the tables panel beside a Thread device's Details (owner 2026-11-15, board M42 V4): which sections and
// explanations a device gets (end device with a route, router, border router with neighbours only, a device with
// neither), the shorter cards and the fallback where no panel can be offered, the tables' cells, the shell's open,
// close and focus rules (ui/slideout.js), which Esc it takes (takesEscape, against every other Esc of the panel) and
// its placement (geometry.js slideoutGeometry). Expected values are worked out by hand from tests/thread-routes-fixture.mjs (link values, read times:
// routers 3 h ago, the motion sensor before 21 h with an unknown lower bound) and the issue's rules; layout itself is
// measured in the browser (tools/smoke.py). Fake DOM. Run: npm test
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { installFakeDom, FakeEl } from "./dom-fake.mjs";

installFakeDom();
// Just enough focus for the shell: one root whose activeElement follows focus(); connected unless removed.
const root = { activeElement: null };
FakeEl.prototype.focus = function focus() { root.activeElement = this; };
FakeEl.prototype.getRootNode = () => root;
FakeEl.prototype.contains = function contains(el) { return this.find((x) => x === el).length > 0; };
FakeEl.prototype.querySelectorAll = function querySelectorAll() { return this.find((x) => x !== this && (x.tag === "summary" || "tabIndex" in x)); };
Object.defineProperty(FakeEl.prototype, "isConnected", { get() { return !this.removed; } });
Object.defineProperty(FakeEl.prototype, "dataset", { get() { return (this.data ||= {}); } });

const F = "../custom_components/meshroute_topology_explorer/frontend/";
const { buildThreadNetwork } = await import(`${F}engines/thread/model.js`);
const { ENGINES } = await import(`${F}engines/index.js`);
const { translator } = await import(`${F}ui/i18n.js`);
const { Slideout, takesEscape } = await import(`${F}ui/slideout.js`);
const { slideoutGeometry, SLIDEOUT_FRAME, SLIDEOUT_GAP, SLIDEOUT_WIDTH } = await import(`${F}ui/geometry.js`);
const { idOf, threadRoutesSample } = await import("./thread-routes-fixture.mjs");

const t = translator("en");
const sample = threadRoutesSample();
const net = buildThreadNetwork(sample.topology, { tables: sample.tables, deviceRegistry: sample.registry });
const now = sample.tables.read_at * 1000;
const cls = (el) => el.className || "";
const has = (el, c) => cls(el).split(" ").includes(c);
const flat = (el) => el.textContent.replace(/\s+/g, " ").trim();

const NOTE = "From the neighbour tables in the Matter server's snapshot; the tables can be many hours old.";
const HINT = "Per hop: what the receiver hears.";
const derivedNote = (name) => `Derived: which way the border router sends is mirrored from the way there; what ${name} hears is `
  + "measured. The border router query (#12) reads the border router's own choice.";
const OLD = "Values that may be older than 4 hours in amber: the route may have changed since.";
const OLD_SHORT = "Some values may be older than 4 hours.";
const PARTITION = "A partition is a part of the Thread network whose routers reach each other.";

/** Render the Details of device `id` of network `n` with a shell (or without: shell false): { box (the drawer's
 *  content), shell, offer (what the shell was offered, or null) }. */
function render(n, id, { shell = new Slideout() } = {}) {
  const box = new FakeEl("div");
  if (shell) shell.begin();
  ENGINES.thread.details(box, { network: n, t, id, onSelect() {}, onFindings() {}, now, slideout: shell || undefined });
  if (shell) shell.end();
  return { box, shell, offer: shell ? shell.offered : null };
}
const cards = (box) => box.find((el) => el.tag === "section" && has(el, "card"));
const cardText = (box, title) => flat(cards(box).find((c) => flat(c).startsWith(title)));
const sectionTitles = (offer) => offer.sections.map((s) => s.children[0].textContent);
const headButtons = (box) => box.find((el) => has(el, "title-buttons"))[0].children.map((b) => b.textContent);
const infoButtons = (box) => cards(box).filter((c) => c.find((el) => has(el, "info-button")).length).map((c) => c.find((el) => has(el, "card-title"))[0].textContent);

test("#25 an end device with a route: both tables, every explanation that applies in order, an 'i' at both cards", () => {
  const { box, offer } = render(net, idOf("XS"));
  assert.deepEqual(headButtons(box), ["Tables"], "no history host in this context: only Tables");
  assert.deepEqual(sectionTitles(offer), ["Neighbours", "Route to Border router B"]);
  // The neighbours' note first, then what a hop's values are, the derived hop back (Border router B -> Plug 3: what
  // Plug 3 hears), the amber note (the sensor's own table: lower bound unknown); no partition advertised.
  assert.deepEqual(offer.info, [NOTE, HINT, derivedNote("Plug 3"), OLD]);
  assert.deepEqual(infoButtons(box), ["Neighbours (Thread)", "Route to Border router B"]);
  assert.equal(offer.title, "Motion sensor");
  assert.equal(offer.minWidth, 424, "the hop table's min-content width, measured (engines/thread/details.js)");
  // Stable ids, so a redraw of the Details finds a focused button again (panel.js keepFocus).
  assert.deepEqual([offer.openers.tables, offer.openers.route, offer.openers.neighbours].map((b) => b.getAttribute("id")),
    ["mte-tables-open", "mte-tables-info-route", "mte-tables-info-neighbours"]);
  assert.equal(offer.closeLabel, "Close");
  assert.equal(offer.infoLabel, "About these values");
});

test("#25 the drawer's cards: head, neighbours, route, facts (the order of the tables panel)", () => {
  const { box } = render(net, idOf("XS"));
  const titles = box.find((el) => has(el, "card-title")).map((el) => el.textContent);
  assert.deepEqual(titles, ["Neighbours (Thread)", "Route to Border router B", "Entity"]);
});

test("#25 a router: no amber note where every table is younger than 4 hours; a border router with neighbours only", () => {
  const p1 = render(net, idOf("P1")).offer;
  assert.deepEqual(p1.info, [NOTE, HINT, derivedNote("Lamp 2")], "Plug 1 and Lamp 2 read 3 h ago: nothing amber");
  const br = render(net, idOf("BRA"));
  assert.deepEqual(sectionTitles(br.offer), ["Neighbours"], "no route on a border router");
  assert.deepEqual(br.offer.info, [NOTE]);
  assert.deepEqual(infoButtons(br.box), ["Neighbours (Thread)"]);
  assert.equal(br.offer.openers.route, null);
});

test("#25 a device with neither neighbours nor a route: no Tables, no 'i', every note stays; so without a shell", () => {
  const fixture = JSON.parse(readFileSync(new URL("./fixtures/thread-border-routers.json", import.meta.url), "utf8")).responses;
  const events = fixture["thread/discover_routers"];
  const routers = [...events.before_result, ...events.after_result].filter((e) => e.data).map((e) => e.data);
  const n = buildThreadNetwork(fixture["matter/network_topology"], { haThread: { datasets: null, routers } });
  const attic = "aa:bb:cc:dd:00:00:01:11"; // only Home Assistant lists it: no neighbours, no route
  const { box, offer } = render(n, attic);
  assert.equal(offer, null);
  assert.equal(box.find((el) => has(el, "tables-button") || has(el, "info-button")).length, 0);
  assert.ok(cardText(box, "Neighbours (Thread)").includes(NOTE));
  // No shell (a host without the panel): the cards are as before #25, notes and source line included.
  const plain = render(net, idOf("XS"), { shell: false }).box;
  const route = cardText(plain, "Route to Border router B");
  for (const text of [HINT, derivedNote("Plug 3"), OLD, "Source: Matter server's copy ·"]) assert.ok(route.includes(text), text);
  assert.ok(!route.includes(OLD_SHORT));
  assert.ok(cardText(plain, "Neighbours (Thread)").includes(NOTE));
  assert.equal(plain.find((el) => has(el, "tables-button") || has(el, "info-button")).length, 0);
});

test("#25 the drawer's route card with a panel: values, tag, weakest line and state stay; explanations and source go", () => {
  const { box, offer } = render(net, idOf("XS"));
  const route = cardText(box, "Route to Border router B");
  for (const text of ["3 hops · path cost 4", "there: Motion sensor → Plug 2 → Plug 3 → Border router B", "derived",
    "Weakest there: Motion sensor → Plug 2 (−83 dBm · LQI 2); back: Plug 2 → Motion sensor (−80 dBm · LQI 2).", OLD_SHORT]) {
    assert.ok(route.includes(text), text);
  }
  for (const text of [HINT, "Derived: which way", OLD, "Source:"]) assert.ok(!route.includes(text), text);
  // The short note in the long one's place and colour: the card's last line, amber.
  const card = cards(box).find((c) => flat(c).startsWith("Route to"));
  const last = card.children.at(-1);
  assert.deepEqual([last.textContent, last.className], [OLD_SHORT, "small warn-text"]);
  assert.ok(!cardText(box, "Neighbours (Thread)").includes(NOTE));
  // The source line stands in the panel's route section, under the summary, one tooltip per table.
  const section = offer.sections[1];
  const lines = section.children.filter((el) => el.tag === "p").map((el) => el.textContent);
  assert.equal(lines[0], "3 hops · path cost 4");
  assert.match(lines[1], /^Source: Matter server's copy · Plug 2 read .+ · Motion sensor read before .+ · Plug 3 \(neighbour table\) read /);
  assert.equal(section.find((el) => el.tag === "span" && el.title).length, 4);
  assert.equal(lines.at(-1), "Weakest there: Motion sensor → Plug 2 (−83 dBm · LQI 2); back: Plug 2 → Motion sensor (−80 dBm · LQI 2).");
});

test("#25 the tables' cells: neighbours as in the list, five hop columns with marks, sources and the child's cost", () => {
  const { offer } = render(net, idOf("XS"));
  const table = (s) => s.find((el) => el.tag === "table")[0];
  const cells = (tr) => tr.children.map((c) => [c.tag, flat(c)]);
  const [neighbours, route] = offer.sections.map(table);
  const head = (tb) => tb.find((el) => el.tag === "thead")[0].find((el) => el.tag === "th").map((th) => [th.textContent, th.scope]);
  assert.deepEqual(head(neighbours), [["neighbour", "col"], ["this device hears", "col"], ["neighbour hears", "col"]]);
  // The sensor's only neighbour is its parent Plug 2: it hears Plug 2 at -80/2, Plug 2 hears it at -83/2.
  const nrows = neighbours.find((el) => el.tag === "tbody")[0].children;
  assert.deepEqual(nrows.map(cells), [[["th", "Plug 2 · Parent"], ["td", "−80 dBm · LQI 2"], ["td", "−83 dBm · LQI 2"]]]);
  assert.equal(nrows[0].children[0].scope, "row");
  assert.deepEqual(head(route), [["#", "col"], ["hop (there)", "col"], ["there: receiver hears", "col"],
    ["back: receiver hears", "col"], ["cost", "col"]]);
  const rows = route.find((el) => el.tag === "tbody")[0].children;
  assert.deepEqual(rows.map(cells), [
    [["td", "1"], ["th", "Motion sensor → Plug 2"], ["td", "−83 dBm · LQI 2Plug 2's table"], ["td", "−80 dBm · LQI 2Motion sensor's table"],
      ["td", "2as the device receives"]],
    [["td", "2"], ["th", "Plug 2 → Plug 3"], ["td", "−70 dBm · LQI 3Plug 3's table"], ["td", "−72 dBm · LQI 3Plug 2's table"], ["td", "1"]],
    [["td", "3"], ["th", "Plug 3 → Border router B"], ["td", "– dBm · LQI 3Plug 3's “LQI out”"],
      ["td", "−66 dBm · LQI 3 derivedPlug 3's table"], ["td", "1"]]]);
  // The weakest hop of each direction (hop 1, LQI 2) is marked; the sensor's own table (back of hop 1) is amber.
  assert.deepEqual(rows.map((r) => [has(r.children[2], "weak"), has(r.children[3], "weak")]), [[true, true], [false, false], [false, false]]);
  assert.deepEqual(rows.map((r) => [has(r.children[2], "warn-text"), has(r.children[3], "warn-text")]), [[false, true], [false, false], [false, false]]);
  // Each table scrolls in its own box, which takes focus and is named by its section's heading.
  for (const s of offer.sections) {
    const scroll = s.find((el) => has(el, "scroll"))[0];
    assert.equal(scroll.tabIndex, 0);
    assert.equal(scroll.getAttribute("aria-labelledby"), s.children[0].getAttribute("id"));
  }
});

test("#25 a route that stops: the panel says where instead of a path cost", () => {
  const s = threadRoutesSample();
  s.tables.nodes.find((x) => x.node_id === 22).available = false; // Plug 2, the sensor's parent, offline for Matter
  const n = buildThreadNetwork(s.topology, { tables: s.tables, deviceRegistry: s.registry });
  const { offer } = render(n, idOf("XS"));
  const lines = offer.sections[1].children.filter((el) => el.tag === "p").map((el) => el.textContent);
  assert.equal(lines[0], "The route stops at Plug 2: offline");
  assert.ok(!lines.includes("path cost unknown"));
});

test("#25 a border router's advertised partition: its sentence moves to 'About these values', an 'i' at the facts", () => {
  const fixture = JSON.parse(readFileSync(new URL("./fixtures/thread-border-routers.json", import.meta.url), "utf8")).responses;
  const garage = "aa:bb:cc:dd:00:00:01:10";
  const n = buildThreadNetwork(fixture["matter/network_topology"], { haThread: { datasets: null, routers: null,
    agents: { agents: [{ ext_address: "aabbccdd00000110", ext_pan_id: "aabbccddeeff0101", partition_id: 7, age: 30 }], read_at: now / 1000 } } });
  const { box, offer } = render(n, garage);
  assert.deepEqual(offer.info, [NOTE, PARTITION]);
  assert.deepEqual(infoButtons(box), ["Neighbours (Thread)", "Entity"]);
  assert.ok(cardText(box, "Entity").includes("Thread partition 7, as advertised"));
  assert.ok(!cardText(box, "Entity").includes(PARTITION));
  assert.equal(render(n, garage, { shell: false }).box.find((el) => el.textContent === PARTITION).length, 1, "stays without a panel");
});

/** A shell with the sensor's offer, its buttons and the panel's parts; `lost` counts onLostFocus calls. */
function opened() {
  root.activeElement = null;
  const lost = { count: 0, target: new FakeEl("div") }; // the Details' container, as panel.js would focus it
  const r = render(net, idOf("XS"), { shell: new Slideout({ onLostFocus: () => { lost.count += 1; lost.target.focus(); } }) });
  const { tables, route, neighbours } = r.offer.openers;
  return { ...r, tables, route, neighbours, lost };
}

test("#25 open, close and focus: Tables toggles with the info collapsed, an 'i' opens it expanded, focus goes back", () => {
  const { shell, tables, route, neighbours } = opened();
  assert.equal(tables.getAttribute("aria-expanded"), "false");
  tables.click();
  assert.equal(shell.el.hidden, false);
  assert.equal(tables.getAttribute("aria-expanded"), "true");
  assert.equal(route.getAttribute("aria-expanded"), "false", "open, but About these values collapsed");
  assert.equal(root.activeElement, shell.closeButton, "focus into the panel");
  const details = shell.body.children[0];
  assert.deepEqual([details.tag, details.open], ["details", false]);
  assert.deepEqual(shell.body.children.slice(1).map((s) => s.children[0].textContent), ["Neighbours", "Route to Border router B"]);
  tables.focus();
  tables.click();
  assert.equal(shell.el.hidden, true, "a second press closes");
  assert.equal(tables.getAttribute("aria-expanded"), "false");
  assert.equal(root.activeElement, tables, "focus stays on the button");
  route.click();
  assert.equal(shell.el.hidden, false);
  assert.equal(shell.body.children[0].open, true, "the 'i': About these values expanded");
  assert.equal(root.activeElement, shell.summary, "and focused");
  assert.deepEqual([route, neighbours, tables].map((b) => b.getAttribute("aria-expanded")), ["true", "true", "true"]);
  // Collapsing the section by hand: the "i" buttons follow.
  const section = shell.body.children[0];
  section.open = false;
  section.listeners.toggle[0]({ currentTarget: section });
  assert.deepEqual([route, neighbours, tables].map((b) => b.getAttribute("aria-expanded")), ["false", "false", "true"]);
  shell.closeButton.click();
  assert.equal(root.activeElement, route, "back to the button that opened it");
  assert.equal(route.getAttribute("aria-expanded"), "false");
  assert.equal(shell.el.getAttribute("role"), "dialog");
  assert.equal(shell.el.getAttribute("aria-labelledby"), shell.title.getAttribute("id"));
});

test("#25 Esc, topmost first: the tables panel takes it from the side panels and the map, never from a layer above", () => {
  // Every other Esc of the panel today: modal dialogs (path history window, cluster details, scan confirmation, all
  // <dialog open> in the panel), the status pill's menu, a Direct link card; the side panels and the map are below.
  const menu = new FakeEl("div");
  const card = new FakeEl("div");
  const inPanel = [new FakeEl("button"), new FakeEl("div")]; // an event's path from a control in the tables panel
  const inDrawer = [new FakeEl("button"), new FakeEl("aside")];
  assert.equal(takesEscape({ open: true, path: inPanel, layers: [null, null] }), true, "focus in the panel");
  assert.equal(takesEscape({ open: true, path: inDrawer, layers: [null, null] }), true, "a side panel, the map or a map button");
  assert.equal(takesEscape({ open: true, dialog: true, path: inPanel, layers: [null, null] }), false, "a modal dialog keeps its own Esc");
  assert.equal(takesEscape({ open: true, path: [new FakeEl("button"), menu], layers: [menu, null] }), false,
    "from inside the status pill's menu: the menu's Esc");
  assert.equal(takesEscape({ open: true, path: [card], layers: [null, card] }), false, "from inside a Direct link card: the card's Esc");
  // Review S1: a menu or card left open while focus is elsewhere (neither closes when focus leaves it) is no layer
  // above: Esc in the panel or in a side panel closes the tables panel and leaves them as they are.
  assert.equal(takesEscape({ open: true, path: inPanel, layers: [menu, card] }), true, "menu and card open, focus in the panel");
  assert.equal(takesEscape({ open: true, path: inDrawer, layers: [menu, card] }), true, "menu and card open, focus in the drawer");
  assert.equal(takesEscape({ open: false, path: inDrawer, layers: [null, null] }), false, "without the panel every Esc is as before");
  // What the panel's handler then does: close; focus inside goes back to the opener, focus elsewhere stays.
  const { shell, tables } = opened();
  tables.click();
  shell.close();
  assert.equal(root.activeElement, tables);
  tables.click();
  const drawerButton = new FakeEl("button");
  drawerButton.focus();
  shell.close();
  assert.equal(shell.isOpen, false);
  assert.equal(root.activeElement, drawerButton, "focus in a side panel stays there");
});

test("#25 a change of selection, a render without an offer, and a redraw: the panel follows the Details", () => {
  const { shell, tables } = opened();
  tables.click();
  // The same device drawn again (new buttons): still open, the new Tables button expanded, focus target the new one.
  shell.begin();
  ENGINES.thread.details(new FakeEl("div"), { network: net, t, id: idOf("XS"), onSelect() {}, onFindings() {}, now, slideout: shell });
  shell.end();
  assert.equal(shell.el.hidden, false);
  assert.notEqual(shell.offered.openers.tables, tables);
  assert.equal(shell.offered.openers.tables.getAttribute("aria-expanded"), "true");
  root.activeElement = shell.closeButton;
  shell.close();
  assert.equal(root.activeElement, shell.offered.openers.tables, "back to the current button");
  // Another device: closed, and focus is not pulled out of wherever it is.
  shell.offered.openers.tables.click();
  const elsewhere = new FakeEl("button");
  elsewhere.focus();
  render(net, idOf("P1"), { shell });
  assert.equal(shell.el.hidden, true);
  assert.equal(root.activeElement, elsewhere);
  // No offer (no device, or a Zigbee Details): closed and forgotten.
  shell.offered.openers.tables.click();
  shell.begin();
  shell.end();
  assert.equal(shell.el.hidden, true);
  assert.equal(shell.offered, null);
  shell.toggle(idOf("P1"));
  assert.equal(shell.el.hidden, true, "nothing to open without an offer");
});

test("#25 the selection changes while focus is inside the panel: focus lands on a shown button, never on the hidden panel", () => {
  // Opened by Tables, focus on its close button; Plug 1 selected: focus on Plug 1's Tables button.
  const { shell, tables, lost } = opened();
  tables.click();
  assert.equal(root.activeElement, shell.closeButton);
  const p1 = render(net, idOf("P1"), { shell });
  assert.equal(shell.isOpen, false);
  assert.equal(root.activeElement, p1.offer.openers.tables);
  // Opened by the route card's "i", focus on the summary; Border router A has no route card: its Tables button.
  p1.offer.openers.route.click();
  assert.equal(root.activeElement, shell.summary);
  const br = render(net, idOf("BRA"), { shell });
  assert.equal(br.offer.openers.route, null);
  assert.equal(root.activeElement, br.offer.openers.tables);
  // Nothing offered any more (another engine's Details, which replaced the buttons): the panel's onLostFocus
  // (panel.js: the Details, else the map).
  br.offer.openers.tables.click();
  for (const button of Object.values(br.offer.openers)) if (button) button.removed = true;
  shell.begin();
  shell.end();
  assert.equal(lost.count, 1);
  assert.equal(root.activeElement, lost.target);
});

test("#25 placement: beside the left panel up to 600 px and 16 px short of the right panel; else a sheet", () => {
  const need = 424; // the Thread hop table's (the offer's minWidth)
  assert.equal(SLIDEOUT_FRAME, 49, "2 x 16 px padding and a 17 px scrollbar gutter");
  // 1280 px map, left panel 384 px (36 % capped), tab head 49 px: 600 px wide from x 384, 16 px above the bottom.
  assert.deepEqual(slideoutGeometry({ width: 1280, height: 800, mode: "side", need, left: 384, head: 49 }),
    { mode: "side", left: 384, width: 600, top: 49, maxHeight: 735 });
  // Both side panels: 1280 - 384 - 384 - 16 = 496 left, at least 424 + 49 = 473: side by side, 496 px.
  assert.deepEqual(slideoutGeometry({ width: 1280, height: 800, mode: "side", need, left: 384, right: 384, head: 49 }),
    { mode: "side", left: 384, width: 496, top: 49, maxHeight: 735 });
  // 809 px map, left panel 320 px: 473 px, side by side; 808 px: 472 px, a sheet over the full width below the tab head.
  assert.equal(slideoutGeometry({ width: 809, height: 600, mode: "side", need, left: 320, head: 49 }).width, 473);
  assert.deepEqual(slideoutGeometry({ width: 808, height: 600, mode: "side", need, left: 320, head: 49 }),
    { mode: "sheet", left: 0, width: 808, top: 49, maxHeight: 551 });
  // The boundary follows the content's need: exactly need + frame is side by side, one pixel less is a sheet.
  const at = (free, n) => slideoutGeometry({ width: 320 + free + SLIDEOUT_GAP, height: 600, mode: "side", need: n, left: 320 }).mode;
  assert.deepEqual([at(473, need), at(472, need), at(400, 351), at(399, 351)], ["side", "sheet", "side", "sheet"]);
  // A phone: from the map's top down to the expanded sheet (390 x 844 map, sheet 464 px).
  assert.deepEqual(slideoutGeometry({ width: 390, height: 844, mode: "sheet", need, bottom: 464 }),
    { mode: "sheet", left: 0, width: 390, top: 0, maxHeight: 380 });
  assert.equal(SLIDEOUT_WIDTH, 600);
  assert.equal(slideoutGeometry({ width: 1280, height: 40, mode: "side", need, left: 384, head: 49 }).maxHeight, 0, "never negative");
});

test("#25 the shell places with the offer's need, also while hidden, from what the last layout pass measured", () => {
  const { shell } = opened();
  shell.place({ width: 809, height: 800, mode: "side", left: 320, right: 0, bottom: 0, head: 49 });
  assert.deepEqual([shell.el.dataset.mode, shell.el.style.width, shell.el.style.left], ["side", "473px", "320px"]);
  shell.place({ width: 808, height: 800, mode: "side", left: 320, right: 0, bottom: 0, head: 49 });
  assert.deepEqual([shell.el.dataset.mode, shell.el.style.width, shell.el.style.left], ["sheet", "808px", "0px"]);
});
