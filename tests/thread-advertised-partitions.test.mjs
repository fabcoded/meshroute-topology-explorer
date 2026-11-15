// SPDX-License-Identifier: MIT
// Tests for #21, the partitions the border routers advertise over mDNS (spec 3.2 "Partitions", 6, 9.2; owner and
// maintainer 2026-11-15): the answer of meshroute_topology_explorer/thread_border_agents matched to border routers by
// extended address within the network's extended PAN id, the statement "Border routers advertise n partitions" with
// its note and amber dot, each border router's Details line, the route card's line, and every case that makes no
// statement (equal ids, one border router, a record without partition id or of unknown age, another network, a Matter
// node). Fixtures: tests/fixtures/thread-border-routers.json (#20: border router "garage" in the snapshot, "attic"
// only in Home Assistant's list) and tests/thread-routes-fixture.mjs (#11: border routers A and B with route tables).
// Expected values, ages and texts are worked out by hand from the inputs below. Run: npm test
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { installFakeDom, FakeEl } from "./dom-fake.mjs";

installFakeDom();
const F = "../custom_components/meshroute_topology_explorer/frontend/";
const { buildThreadNetwork } = await import(`${F}engines/thread/model.js`);
const { statusLine } = await import(`${F}engines/thread/status.js`);
const { ENGINES } = await import(`${F}engines/index.js`);
const { translator } = await import(`${F}ui/i18n.js`);
const { Slideout } = await import(`${F}ui/slideout.js`);
const { idOf, threadRoutesSample } = await import("./thread-routes-fixture.mjs");

const fixture = JSON.parse(readFileSync(new URL("./fixtures/thread-border-routers.json", import.meta.url), "utf8")).responses;
const topology = fixture["matter/network_topology"];
const events = fixture["thread/discover_routers"];
const routerData = (key) => [...events.before_result, ...events.after_result].find((e) => e.key === key && e.data).data;
const GARAGE = "aa:bb:cc:dd:00:00:01:10"; // in the snapshot
const ATTIC = "aa:bb:cc:dd:00:00:01:11"; // only in Home Assistant's list
const LOFT = "aa:bb:cc:dd:00:00:01:12"; // a third border router, added to Home Assistant's list where a test needs it
const PAN = "aabbccddeeff0101";
const t = translator("en");
const now = Date.parse("2026-01-01T13:00:00Z");
const READ_AT = now / 1000 - 60; // the command answered a minute before the Details are drawn

/** One record of the command's answer: the border agent at `address` (colons or not) in network `pan`. */
const agent = (address, partition, age, pan = PAN) => ({ ext_address: address.replace(/:/g, ""), ext_pan_id: pan,
  partition_id: partition, age });
/** Home Assistant's answers on border routers: its list (attic, garage, the other network's; loft where asked) and
 *  the command's answer with these records. */
function haThread(agents, { loft = false, readAt = READ_AT } = {}) {
  const routers = [routerData("aabbccdd00000111"), routerData("aabbccdd00000110"), routerData("aabbccdd00000120")];
  if (loft) routers.push({ ...routerData("aabbccdd00000111"), extended_address: "aabbccdd00000112", instance_name: "Border router loft" });
  return { datasets: null, routers, agents: agents === null ? null : { agents, read_at: readAt } };
}
const build = (agents, options) => buildThreadNetwork(topology, { haThread: haThread(agents, options) });
const dev = (n, id) => n.devices.find((d) => d.id === id);
const keys = (n, extras = {}) => statusLine(n, { now, ...extras }).parts.map(([key]) => key);
/** The text of the Details tab of device `id`, drawn with the tables panel's shell (#25). */
function details(network, id) {
  const container = new FakeEl("div");
  ENGINES.thread.details(container, { network, t, id, onSelect() {}, onFindings() {}, now, slideout: new Slideout() });
  return container.textContent;
}
/** The texts of the tables panel's "About these values" for device `id` (#25), or null without a panel. */
function about(network, id) {
  const slideout = new Slideout();
  ENGINES.thread.details(new FakeEl("div"), { network, t, id, onSelect() {}, onFindings() {}, now, slideout });
  return slideout.offered ? slideout.offered.info : null;
}
const EXPLAINED = "A partition is a part of the Thread network whose routers reach each other.";
const ROUTES_NOTE = "Border routers advertise different partitions; if the network is split, routes from the Matter "
  + "server's copy may no longer hold.";

test("#21 two border routers advertising one partition: no statement, the dot as without, each one's value in Details", () => {
  const n = build([agent(GARAGE, 111111111, 30), agent(ATTIC, 111111111, 600)]);
  const without = build(null);
  assert.equal(n.advertisedPartitions, null);
  assert.deepEqual(statusLine(n, { now }), statusLine(without, { now }), "pill parts, note and dot unchanged");
  // Received 30 s + 60 s before now: 1 min; 600 s + 60 s: 11 min.
  // The garage router has a neighbour: what a partition is stands in the tables panel (#25); the attic one has none.
  const garage = details(n, GARAGE);
  assert.ok(garage.includes("Thread partition 111111111, as advertised 1 min ago.") && !garage.includes(EXPLAINED), garage);
  assert.ok(about(n, GARAGE).includes(EXPLAINED));
  assert.ok(details(n, ATTIC).includes(`Thread partition 111111111, as advertised 11 min ago.${EXPLAINED}`));
  assert.equal(about(n, ATTIC), null);
  for (const id of [GARAGE, ATTIC]) assert.doesNotMatch(details(n, id), /Also advertised by|No other border router|split/);
});

test("#21 different partitions: the pill part, its note with the oldest age, the amber dot and each one's Details", () => {
  const n = build([agent(GARAGE, 111111111, 30), agent(ATTIC, 222222222, 600)]);
  assert.deepEqual(n.advertisedPartitions, { count: 2, oldestAt: now - 660000 });
  const parts = statusLine(n, { now }).parts;
  const at = parts.findIndex(([key]) => key === "status.thread_partitions");
  // The menu: the part (no tooltip), what a partition is, both readings with the oldest age; no route tables here.
  assert.deepEqual(parts.slice(at).map(([key, params, tip]) => [t(key, params), tip]), [
    ["Border routers advertise 2 partitions", undefined], [EXPLAINED, undefined],
    ["This happens when the network is split into parts without radio contact, and also when a border router is off "
      + "while its last advertisement is still in Home Assistant's mDNS cache. Home Assistant received the oldest of "
      + "these advertisements 11 min ago.", undefined]]);
  assert.deepEqual(keys(n, { compact: true }).slice(-1), ["status.thread_partitions"], "the pill's second line: the part only");
  // The dot: amber for this part alone (the rest made clean as in #20's test), as without it otherwise.
  const clean = { ...n, status: { ...n.status, linksBoth: n.status.links, borderRoutersKnown: n.status.borderRouters } };
  assert.equal(statusLine(clean, { now }).level, "warn");
  assert.equal(statusLine({ ...clean, advertisedPartitions: null }, { now }).level, "ok");
  // The oldest received within the last minute, and 121 minutes ago (7200 s + 60 s): the panel's age words.
  const note = (m) => t(...statusLine(m, { now }).parts.find(([key]) => key === "status.thread_partitions_note"));
  assert.match(note(build([agent(GARAGE, 1, 0), agent(ATTIC, 2, 0)], { readAt: now / 1000 - 59 })), /advertisements just now\.$/);
  assert.match(note(build([agent(GARAGE, 1, 30), agent(ATTIC, 2, 7200)])), /advertisements 2 h ago\.$/);
  const garage = details(n, GARAGE);
  assert.ok(garage.includes("Thread partition 111111111, as advertised 1 min ago.No other border router on this map advertises it."), garage);
  assert.ok(about(n, GARAGE).includes(EXPLAINED));
  assert.ok(details(n, ATTIC).includes("Thread partition 222222222, as advertised 11 min ago."));
  assert.doesNotMatch(garage + details(n, ATTIC), /Network split|not split|details\.|status\./);
});

test("#21 three border routers, two islands: two partitions; Details name who advertises the same one", () => {
  const n = build([agent(GARAGE, 111111111, 30), agent(ATTIC, 222222222, 40), agent(LOFT, 111111111, 50)], { loft: true });
  assert.equal(n.advertisedPartitions.count, 2);
  assert.equal(n.advertisedPartitions.oldestAt, now - 110000, "loft: 50 s + 60 s");
  assert.match(details(n, GARAGE), /Also advertised by Border router loft\./);
  assert.match(details(n, LOFT), /Also advertised by Border router garage\./);
  assert.match(details(n, ATTIC), /No other border router on this map advertises it\./);
  // The loft's advertisement of unknown time counts for no statement, but it does name the garage's partition.
  const m = build([agent(GARAGE, 111111111, 30), agent(ATTIC, 222222222, 40), agent(LOFT, 111111111, null)], { loft: true });
  assert.deepEqual(m.advertisedPartitions, { count: 2, oldestAt: now - 100000 });
  assert.match(details(m, GARAGE), /Also advertised by Border router loft\./);
  assert.doesNotMatch(details(m, LOFT), /Also advertised|No other border router/, "its own takes part in nothing");
  // Three ids: three partitions.
  assert.equal(build([agent(GARAGE, 1, 30), agent(ATTIC, 2, 40), agent(LOFT, 3, 50)], { loft: true }).advertisedPartitions.count, 3);
});

test("#21 partition ids 0 and 0xFFFFFFFF are values; a missing or malformed one takes no part and shows nothing", () => {
  const n = build([agent(GARAGE, 0, 30), agent(ATTIC, 4294967295, 30)]);
  assert.equal(n.advertisedPartitions.count, 2);
  assert.match(details(n, GARAGE), /Thread partition 0, as advertised 1 min ago\./);
  assert.match(details(n, ATTIC), /Thread partition 4294967295, as advertised 1 min ago\./);
  for (const value of [null, undefined, -1, 2 ** 32, 1.5, "111111111", true]) {
    const m = build([agent(GARAGE, 111111111, 30), agent(ATTIC, value, 30)]);
    assert.equal(m.advertisedPartitions, null, String(value));
    assert.equal(dev(m, ATTIC).advertised, null, String(value));
    assert.doesNotMatch(details(m, ATTIC), /Thread partition/, String(value));
  }
});

test("#21 an advertisement of unknown or absurd age is shown as such and takes part in no statement", () => {
  // Ages beyond a valid Date (1e13 s back is more than 8.64e15 ms) and read_at missing or not a number.
  for (const [age, readAt] of [[null, READ_AT], [undefined, READ_AT], [-5, READ_AT], ["30", READ_AT], [Number.NaN, READ_AT],
    [1e13, READ_AT], [1e308, READ_AT], [Infinity, READ_AT], [30, null], [30, "1767265140"]]) {
    const n = build([agent(GARAGE, 111111111, 30, PAN), agent(ATTIC, 222222222, age)], { readAt });
    assert.equal(n.advertisedPartitions, null, `${age} ${readAt}`);
    assert.ok(!keys(n).includes("status.thread_partitions"));
    assert.equal(dev(n, ATTIC).advertised.at, null);
    assert.match(details(n, ATTIC), /Thread partition 222222222, as advertised; when Home Assistant received it is not reported\./);
    assert.doesNotMatch(details(n, ATTIC) + details(n, GARAGE), /No other border router|Also advertised|NaN|Infinity/);
  }
  const noReadAt = buildThreadNetwork(topology, { haThread: { ...haThread([]),
    agents: { agents: [agent(GARAGE, 1, 30), agent(ATTIC, 2, 30)] } } });
  assert.equal(noReadAt.advertisedPartitions, null, "read_at missing");
  assert.deepEqual(noReadAt.devices.filter((d) => d.advertised).map((d) => d.advertised.at), [null, null]);
});

test("#21 read_at ahead of or behind the panel's clock: no NaN or Infinity, the statement stands", () => {
  // Home Assistant's clock 10 min ahead: received in the panel's future, shown as just now.
  const ahead = build([agent(GARAGE, 1, 30), agent(ATTIC, 2, 40)], { readAt: now / 1000 + 600 });
  assert.equal(ahead.advertisedPartitions.count, 2);
  assert.match(details(ahead, ATTIC), /Thread partition 2, as advertised just now\./);
  // Three days behind: 4 320 min and more, in hours.
  const behind = build([agent(GARAGE, 1, 30), agent(ATTIC, 2, 40)], { readAt: now / 1000 - 3 * 86400 });
  assert.match(details(behind, GARAGE), /Thread partition 1, as advertised 72 h ago\./);
  for (const n of [ahead, behind]) {
    const texts = statusLine(n, { now }).parts.map(([key, params]) => t(key, params)).join(" ");
    assert.doesNotMatch(texts + details(n, GARAGE) + details(n, ATTIC), /NaN|Infinity|\{|undefined/);
  }
});

test("#21 one border router, no answer or an empty one: no statement", () => {
  assert.equal(build([agent(GARAGE, 111111111, 30)]).advertisedPartitions, null);
  for (const answer of [null, { agents: "x", read_at: READ_AT }, { read_at: READ_AT }]) {
    const n = buildThreadNetwork(topology, { haThread: { ...haThread([]), agents: answer } });
    assert.equal(n.advertisedPartitions, null);
    assert.ok(n.devices.every((d) => d.advertised === null));
  }
});

test("#21 another extended PAN id is ignored; addresses and PAN ids match across case", () => {
  const other = "aabbccddeeff0202";
  const n = build([agent(GARAGE, 111111111, 30), agent(ATTIC, 222222222, 30, other), agent("aabbccdd00000120", 3, 30, other)]);
  assert.equal(n.advertisedPartitions, null, "the attic's record is of another network; the other network's router is none of ours");
  assert.equal(dev(n, ATTIC).advertised, null);
  const upper = build([agent("AABBCCDD00000110", 111111111, 30, PAN.toUpperCase()), agent(ATTIC.toUpperCase(), 222222222, 30)]);
  assert.equal(upper.advertisedPartitions.count, 2);
  assert.equal(dev(upper, GARAGE).advertised.partition, 111111111);
});

test("#21 two records of one border router: the newest wins, whatever their order", () => {
  const older = agent(GARAGE, 222222222, 600);
  const newer = agent(GARAGE, 111111111, 10);
  for (const records of [[older, newer], [newer, older]]) {
    const n = build([...records, agent(ATTIC, 111111111, 30)]);
    assert.equal(dev(n, GARAGE).advertised.partition, 111111111);
    assert.equal(n.advertisedPartitions, null, "the newest agrees with the attic");
  }
  // The newest names no partition: nothing for this border router, although an older record did.
  const n = build([older, agent(GARAGE, null, 10), agent(ATTIC, 111111111, 30)]);
  assert.equal(dev(n, GARAGE).advertised, null);
  assert.equal(n.advertisedPartitions, null);
  // The newest record is of another network: the border router advertises nothing for this one (picked first, then
  // compared with the network; an older record of this network does not stand in).
  const moved = build([agent(GARAGE, 222222222, 600), agent(GARAGE, 3, 10, "aabbccddeeff0202"), agent(ATTIC, 111111111, 30)]);
  assert.equal(dev(moved, GARAGE).advertised, null);
  assert.equal(moved.advertisedPartitions, null);
  // A record of known age wins over one of unknown age.
  const m = build([agent(GARAGE, 222222222, 30), agent(GARAGE, 111111111, null), agent(ATTIC, 111111111, 30)]);
  assert.equal(dev(m, GARAGE).advertised.partition, 222222222);
  assert.equal(m.advertisedPartitions.count, 2);
});

test("#21 a Matter node never takes part: neither its own partition id nor a record at its address", () => {
  // A commissioned Matter node Home Assistant also lists at the attic's address keeps its role (#20): its record is
  // no border router's.
  const node = { id: "9", network_type: "thread", kind: "matter", node_id: 9, role: "router",
    ext_address: "AABBCCDD00000111", ext_pan_id: "AABBCCDDEEFF0101", available: true };
  const n = buildThreadNetwork({ ...topology, nodes: [...topology.nodes, node] },
    { haThread: haThread([agent(GARAGE, 111111111, 30), agent(ATTIC, 222222222, 30)]) });
  assert.equal(dev(n, ATTIC).role, "router");
  assert.equal(dev(n, ATTIC).advertised, null);
  assert.equal(n.advertisedPartitions, null);
  // Different partition ids read from the Matter nodes' own tables (0/53/9) make no statement either (routes fixture).
  const sample = threadRoutesSample();
  for (const [nodeId, partition] of [[14, 1], [15, 2], [16, 3]]) {
    Object.assign(sample.tables.nodes.find((x) => x.node_id === nodeId), { partition_id: partition });
  }
  const read = buildThreadNetwork(sample.topology, { tables: sample.tables, haThread: { datasets: null, routers: null,
    agents: { agents: [agent(idOf("BRA"), 7, 30, "aabbccddeeff0099"), agent(idOf("BRB"), 7, 30, "aabbccddeeff0099")],
      read_at: READ_AT } } });
  assert.equal(read.devices.find((d) => d.nodeId === 15).partitionRead.partition, 2, "the Matter ids did arrive");
  assert.equal(read.advertisedPartitions, null);
});

test("#21 route card and pill menu carry one line while different partitions are advertised; routes are unchanged", () => {
  const sample = threadRoutesSample();
  const withAgents = (a, b) => buildThreadNetwork(sample.topology, { tables: sample.tables, deviceRegistry: sample.registry,
    haThread: { datasets: null, routers: null, agents: { agents: [agent(idOf("BRA"), a, 30, "aabbccddeeff0099"),
      agent(idOf("BRB"), b, 30, "aabbccddeeff0099")], read_at: READ_AT } } });
  const split = withAgents(111111111, 222222222);
  const same = withAgents(111111111, 111111111);
  const card = (n, k) => {
    const container = new FakeEl("div");
    ENGINES.thread.details(container, { network: n, t, id: idOf(k), onSelect() {}, onFindings() {}, now });
    return container.textContent;
  };
  assert.ok(card(split, "LU").includes(ROUTES_NOTE));
  const line = (n, k) => {
    const container = new FakeEl("div");
    ENGINES.thread.details(container, { network: n, t, id: idOf(k), onSelect() {}, onFindings() {}, now });
    const find = (el) => (el.textContent === ROUTES_NOTE && el.tag === "p" ? el : (el.children || []).map(find).find(Boolean));
    return find(container);
  };
  assert.equal(line(split, "LU").className, "muted small", "muted: a condition, not a warning");
  assert.ok(card(split, "XS").includes(ROUTES_NOTE));
  assert.ok(!card(same, "LU").includes(ROUTES_NOTE));
  assert.ok(!card(split, "BRA").includes(ROUTES_NOTE), "no route card on a border router");
  assert.equal(t("route.partitions_note"), ROUTES_NOTE);
  const full = statusLine(split, { now }).parts.map(([key]) => key);
  assert.deepEqual(full.slice(-4), ["status.thread_partitions", "details.thread_partition_explained",
    "status.thread_partitions_note", "route.partitions_note"]);
  assert.ok(!keys(split, { compact: true }).includes("route.partitions_note"), "the menu only, not the pill's line");
  assert.ok(!keys(same).includes("route.partitions_note"));
  // Routes are neither stopped nor recomputed.
  for (const k of ["XS", "TE", "KF", "P1", "P2", "P3", "LO", "LU"]) {
    const [a, b] = [split.routing.defaultRoute(idOf(k)), same.routing.defaultRoute(idOf(k))];
    assert.deepEqual([a.to, a.there, a.back], [b.to, b.there, b.back], k);
  }
  assert.deepEqual(split.routing.borderRouters, same.routing.borderRouters);
});
