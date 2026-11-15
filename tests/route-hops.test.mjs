// SPDX-License-Identifier: MIT
// #22: the route card's hop list is one block per hop (no table), so long device names cannot push it across the
// card's border. Structure per hop: number, names, cost, a line per direction with value, tag and source, the weakest
// mark per direction line. Layout itself is measured in the browser journey of tools/smoke.py (nothing is laid out here).
// Run: npm test
import test from "node:test";
import assert from "node:assert/strict";
import { installFakeDom, FakeEl } from "./dom-fake.mjs";
import { routeList } from "../custom_components/meshroute_topology_explorer/frontend/engines/thread/details.js";
import { translator } from "../custom_components/meshroute_topology_explorer/frontend/ui/i18n.js";

installFakeDom();
const t = translator("en");
const LONG = "Home Assistant OpenThread Border Router #F09A";
const names = { sensor: "atelier-licht-sofaoben", plug: "Plug 2", br: LONG, x: "Switch" };
const name = (id) => names[id];
const cell = (rssi, lqi, holder, source, extra = {}) => ({ rssi, lqi, holder, source, old: false, ...extra });
const cls = (el) => el.className || "";
const hasClass = (el, c) => cls(el).split(" ").includes(c);
const texts = (el) => el.textContent.replace(/\s+/g, " ").trim();

/** Four hops: a child's first hop with a weak amber way back, a hop without RSSI, a derived hop back, and a hop back
 *  with no hop there (unequal lengths). */
const rows = [
  { n: 1, from: "sensor", to: "plug", cost: 1, child: true, weakThere: true, weakBack: false, backDerived: false,
    there: cell(-87, 2, "plug", "neighbours"), back: cell(-70, 3, "sensor", "neighbours", { old: true }) },
  { n: 2, from: "plug", to: "br", cost: null, child: false, weakThere: false, weakBack: true, backDerived: true,
    there: cell(null, 3, "plug", "lqi out"), back: cell(-60, 1, "br", "lqi out") },
  { n: 3, from: "br", to: "x", cost: 2, child: false, weakThere: false, weakBack: false, backDerived: false,
    there: cell(null, null, null, null), back: null },
  { n: null, from: "x", to: "plug", cost: 4, child: false, weakThere: false, weakBack: false, backDerived: false,
    there: null, back: cell(-50, 3, "x", "neighbours") },
];
const list = routeList(rows, name, t);
const items = list.find((el) => el.tag === "li");
const lines = (li) => li.find((el) => hasClass(el, "hop-line"));

test("#22 the hop list is a real list with one block per row, no table, the number not doubled", () => {
  assert.equal(list.tag, "ol");
  assert.equal(list.getAttribute("role"), "list");
  assert.equal(items.length, 4);
  assert.equal(list.find((el) => ["table", "tr", "td", "th"].includes(el.tag)).length, 0);
  assert.equal(routeList([], name, t), null);
  // The number stands once, as text; the list's own numbering is switched off in the styles (list-style: none).
  assert.deepEqual(items.map((li) => li.find((el) => el.tag === "strong").map((el) => el.textContent)), [["1"], ["2"], ["3"], []]);
});

test("#22 first line: the names in full, the cost at its end, a child's hop says how it is counted", () => {
  const head = (li) => li.find((el) => hasClass(el, "hop-head"))[0];
  assert.equal(texts(head(items[0])), "1 atelier-licht-sofaoben → Plug 2 cost 1 · as the device receives");
  assert.equal(texts(head(items[1])), `2 Plug 2 → ${LONG} cost ?`);
  assert.equal(texts(head(items[2])), `3 ${LONG} → Switch cost 2`);
  assert.equal(texts(head(items[3])), "Switch → Plug 2 cost 4");
  // The cost does not split; the names (the only part that wraps freely) are a separate element.
  const cost = head(items[1]).find((el) => hasClass(el, "hop-cost"))[0];
  assert.equal(cost.find((el) => hasClass(el, "nowrap"))[0].textContent, "cost ?");
  assert.equal(head(items[0]).find((el) => hasClass(el, "hop-names"))[0].textContent, "atelier-licht-sofaoben → Plug 2");
  assert.equal(head(items[1]).find((el) => hasClass(el, "hop-names"))[0].textContent, `Plug 2 → ${LONG}`);
});

test("#22 a line per direction with value, tag and source; no line is invented", () => {
  assert.deepEqual(items.map((li) => lines(li).length), [2, 2, 1, 1]);
  assert.equal(texts(lines(items[0])[0]), "there −87 dBm · LQI 2 Plug 2's table");
  assert.equal(texts(lines(items[0])[1]), "back −70 dBm · LQI 3 atelier-licht-sofaoben's table");
  // No RSSI: "– dBm"; a derived way back is tagged; the table's "LQI out" source.
  assert.equal(texts(lines(items[1])[0]), "there – dBm · LQI 3 Plug 2's “LQI out”");
  assert.equal(texts(lines(items[1])[1]), `back −60 dBm · LQI 1 derived ${LONG}'s “LQI out”`);
  // Neither RSSI nor LQI: "?", no source. Only there: no back line.
  assert.equal(texts(lines(items[2])[0]), "there ?");
  // Back only (more hops back than there): the back line alone.
  assert.equal(texts(lines(items[3])[0]), "back −50 dBm · LQI 3 Switch's table");
  const tags = list.find((el) => hasClass(el, "tag"));
  assert.deepEqual(tags.map((el) => el.textContent.trim()), ["derived"]);
});

test("#22 the weakest mark sits on the line of its direction, old values are amber, the value does not wrap", () => {
  const weak = (li) => lines(li).map((l) => hasClass(l, "weak"));
  assert.deepEqual(items.map(weak), [[true, false], [false, true], [false], [false]]);
  const amber = (li) => lines(li).map((l) => l.find((el) => hasClass(el, "warn-text")).length > 0);
  assert.deepEqual(items.map(amber), [[false, true], [false, false], [false], [false]]);
  const values = list.find((el) => hasClass(el, "nowrap") && /dBm|^\?$/.test(el.textContent));
  assert.equal(values.length, 6);
});

test("#22 #25 the route card has no table; what each value means is said once, in the tables panel", async () => {
  const F = "../custom_components/meshroute_topology_explorer/frontend/";
  const { buildThreadNetwork } = await import(`${F}engines/thread/model.js`);
  const { ENGINES } = await import(`${F}engines/index.js`);
  const { Slideout } = await import(`${F}ui/slideout.js`);
  const { idOf, threadRoutesSample } = await import("./thread-routes-fixture.mjs");
  const sample = threadRoutesSample();
  const net = buildThreadNetwork(sample.topology, { tables: sample.tables, deviceRegistry: sample.registry });
  const container = new FakeEl("div");
  const slideout = new Slideout();
  ENGINES.thread.details(container, { network: net, t, id: idOf("XS"), onSelect() {}, onFindings() {},
    now: sample.tables.read_at * 1000, slideout });
  assert.equal(container.find((el) => ["table", "tr", "td", "th"].includes(el.tag)).length, 0);
  assert.equal(container.find((el) => el.tag === "ol" && hasClass(el, "route-hops")).length, 1);
  assert.equal(container.find((el) => el.textContent === "Per hop: what the receiver hears.").length, 0);
  assert.equal(slideout.offered.info.filter((x) => x === "Per hop: what the receiver hears.").length, 1);
  assert.equal(container.find((el) => el.tag === "li" && hasClass(el, "hop-line")).length, 0);
  assert.equal(container.find((el) => hasClass(el, "hop-line")).length >= 4, true);
  // The motion sensor's first hop has LQI 2 in both directions (−83 there, −80 back), the others LQI 3: the weakest
  // hop of each direction is hop 1, so exactly its two lines are marked, none of the later hops.
  const marked = container.find((el) => hasClass(el, "hop-line") && hasClass(el, "weak"));
  assert.deepEqual(marked.map(texts).map((x) => x.split(" ").slice(0, 6).join(" ")), ["there −83 dBm · LQI 2", "back −80 dBm · LQI 2"]);
  const first = container.find((el) => el.tag === "li")[0].find((el) => hasClass(el, "hop-line"));
  assert.deepEqual(marked, first);
});
