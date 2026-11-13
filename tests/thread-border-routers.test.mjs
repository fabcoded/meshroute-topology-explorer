// SPDX-License-Identifier: MIT
// Tests for #20, the border routers of Home Assistant's Thread integration (spec 3.2 "Border routers", 6, 8, 9.2, 9.5),
// on the synthetic fixture tests/fixtures/thread-border-routers.json (two border routers in one network, one of them
// absent from the Matter topology) and small variants of it: matching by extended address across case within the
// extended PAN id, which snapshot kinds the list names and counts, names and labels, malformed entries, a border
// router without lanes that is never rated or offline, the preferred one, the status pill "n of m", routes, the
// route card, the History partner and pair badges, and the adapter's bounded read on a clock that honours the
// milliseconds (events before and after the result, router_removed, the 150 ms window from the result, the 500 ms
// bound of the whole read, a hanging, slow or lost list_datasets, the integration missing). Expected values come from
// the spec and the fixture, checked by hand. Run: npm test
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { installFakeDom, FakeEl } from "./dom-fake.mjs";
import { FakeCanvas, fakeEnv } from "./graph-fakes.mjs";

installFakeDom();
const F = "../custom_components/meshroute_topology_explorer/frontend/";
const { buildThreadNetwork } = await import(`${F}engines/thread/model.js`);
const { classifyLanes } = await import(`${F}engines/thread/lanes.js`);
const { statusLine } = await import(`${F}engines/thread/status.js`);
const { BORDER_ROUTERS_MS, DISCOVERY_MS, readThread } = await import(`${F}adapters/matter.js`);
const { defaultPartner, partnerChoices } = await import(`${F}ui/history-partners.js`);
const { ENGINES, historyCaps } = await import(`${F}engines/index.js`);
const { translator } = await import(`${F}ui/i18n.js`);
const { GraphView } = await import(`${F}graph/graph-view.js`);
const { badgeCentre } = await import(`${F}graph/renderer.js`);
const { symbolSize } = await import(`${F}graph/symbols.js`);

const fixture = JSON.parse(readFileSync(new URL("./fixtures/thread-border-routers.json", import.meta.url), "utf8")).responses;
const topology = fixture["matter/network_topology"];
const datasets = fixture["thread/list_datasets"];
const events = fixture["thread/discover_routers"];
/** The router data of one discovery event of the fixture, by its key (the extended address in lower case). */
const data = (key) => [...events.before_result, ...events.after_result].find((e) => e.key === key && e.data).data;
const ATTIC = "aa:bb:cc:dd:00:00:01:11"; // only in Home Assistant's list; the preferred dataset names it
const GARAGE = "aa:bb:cc:dd:00:00:01:10"; // in the snapshot (upper case) and in Home Assistant's list (lower case)
const haThread = { datasets, routers: [data("aabbccdd00000111"), data("aabbccdd00000110"), data("aabbccdd00000120")] };
const net = buildThreadNetwork(topology, { haThread });
const dev = (n, id) => n.devices.find((d) => d.id === id);
const brs = (n) => n.devices.filter((d) => d.role === "border router");
const t = translator("en");
const now = Date.parse("2026-01-01T13:00:00Z"); // one hour after the fixture's snapshot
const END = net.devices.find((d) => d.role === "end device").id;

/** The fixture's topology with the snapshot's border router at another extended address and RLOC16. */
function withSnapshotBr(ext, rloc16 = null) {
  const id = `br_${ext}`;
  return { ...topology,
    nodes: topology.nodes.map((n) => (n.kind === "border_router" ? { ...n, id, ext_address: ext, rloc16 } : n)),
    connections: topology.connections.map((c) => (c.target.startsWith("br_") ? { ...c, target: id } : c)) };
}
/** The fixture's topology without its border router. */
const withoutSnapshotBr = () => ({ ...topology, nodes: topology.nodes.filter((n) => n.kind !== "border_router"),
  connections: topology.connections.filter((c) => !c.target.startsWith("br_")) });
/** The fixture's topology plus one more node at the attic router's address. */
const plusNode = (extra) => ({ ...topology, nodes: [...topology.nodes, { id: "9", network_type: "thread",
  ext_address: "AABBCCDD00000111", ext_pan_id: "AABBCCDDEEFF0101", available: true, ...extra }] });
/** The router data of the fixture's attic border router at another address, without an instance name. */
const unnamed = (key, extra = {}) => ({ ...data("aabbccdd00000111"), instance_name: null, extended_address: key, ...extra });
/** The text of the Details tab of device `id`. */
function details(network, id) {
  const container = new FakeEl("div");
  ENGINES.thread.details(container, { network, t, id, onSelect() {}, onFindings() {}, now });
  return container.textContent;
}

test("#20 a border router Home Assistant knows and the snapshot lacks is drawn without lanes, never rated or offline", () => {
  const attic = dev(net, ATTIC);
  assert.equal(net.devices.length, 4, "leader, end device, two border routers; the other network's router is not added");
  assert.equal(attic.role, "border router");
  assert.equal(attic.label, "Border router attic");
  assert.deepEqual([attic.vendor, attic.model], ["OpenThread", "BorderRouter"]);
  assert.equal(attic.inTopology, false);
  assert.equal(attic.available, true, "not offline: availability is unknown, as for every border router");
  assert.equal(attic.availabilityKnown, false);
  assert.equal(attic.rating, null);
  assert.equal(attic.tableRead, false);
  assert.ok(!net.links.some((l) => l.a === ATTIC || l.b === ATTIC));
  assert.ok(!net.pairs.some((p) => p.a === ATTIC || p.b === ATTIC));
  assert.ok(!classifyLanes(net).lanes.some((l) => l.sender === ATTIC || l.hearer === ATTIC), "no lanes");
  assert.deepEqual(net.findings, [], "no finding: neither offline nor weak");
});

test("#20 a border router in both lists is matched by its extended address across case and named by its instance name", () => {
  const garage = dev(net, GARAGE);
  assert.equal(garage.label, "Border router garage");
  assert.equal(garage.inTopology, true);
  assert.equal(garage.nodeKey, "br_AABBCCDD00000110");
  assert.deepEqual([garage.vendor, garage.model], ["Home Assistant", "OpenThread Border Router"], "the snapshot's own");
  assert.equal(brs(net).length, 2, "matched, not added twice");
  assert.equal(dev(buildThreadNetwork(topology), GARAGE).label, "OpenThread Border Router", "without the list: the model");
  // The snapshot's network is matched however the integration writes the extended PAN id.
  const upper = { ...haThread, routers: haThread.routers.map((r) => ({ ...r, extended_pan_id: r.extended_pan_id.toUpperCase() })) };
  assert.equal(dev(buildThreadNetwork(topology, { haThread: upper }), GARAGE).label, "Border router garage");
});

test("#20 an unidentified Thread node Home Assistant lists becomes a border router, named and counted", () => {
  const n = buildThreadNetwork(plusNode({ kind: "thread_unknown", role: "router" }), { haThread });
  const node = dev(n, ATTIC);
  assert.equal(node.nodeKey, "9", "the snapshot's node, no twin");
  assert.deepEqual([node.role, node.kind, node.label, node.inTopology, node.preferred],
    ["border router", "hub", "Border router attic", true, true]);
  assert.deepEqual([n.status.borderRouters, n.status.borderRoutersKnown], [2, 2]);
  // Without Home Assistant's list it stays what the snapshot says.
  assert.equal(dev(buildThreadNetwork(plusNode({ kind: "thread_unknown", role: "router" })), ATTIC).role, "router");
});

test("#20 a commissioned Matter node Home Assistant also lists keeps its name and role, is not counted, has no twin", () => {
  const n = buildThreadNetwork(plusNode({ kind: "matter", node_id: 9, role: "router" }), { haThread });
  const node = dev(n, ATTIC);
  assert.equal(n.devices.filter((d) => d.id === ATTIC).length, 1);
  assert.deepEqual([node.role, node.label, node.preferred, node.inTopology], ["router", "Matter node 9", false, true]);
  assert.deepEqual([n.status.borderRouters, n.status.borderRoutersKnown], [1, 1]);
  assert.ok(!statusLine(n, { now }).parts.some(([key]) => key === "status.thread_br_count"));
});

test("#20 a router or a preferred dataset of another extended PAN id is ignored", () => {
  assert.equal(dev(net, "aa:bb:cc:dd:00:00:01:20"), undefined);
  assert.equal(net.unresolved.ignored, 0, "the snapshot's own count of ignored nodes is unchanged");
  assert.equal(dev(net, ATTIC).preferred, true, "the preferred dataset of this network names it");
  assert.equal(dev(net, GARAGE).preferred, false, "a dataset of another network names it, and it is not preferred");
  const other = { ...datasets, datasets: datasets.datasets.map((d) => ({ ...d, preferred: !d.preferred })) };
  const n = buildThreadNetwork(topology, { haThread: { ...haThread, datasets: other } });
  assert.deepEqual(n.devices.filter((d) => d.preferred), [], "the preferred dataset is of another network: no mark");
});

test("#20 malformed entries: null, a blank instance name, one address twice, no preferred address", () => {
  const garage = data("aabbccdd00000110");
  const n = buildThreadNetwork(topology, { haThread: { datasets: { datasets: [null, { ...datasets.datasets[0],
    preferred_extended_address: null }] }, routers: [null, { ...garage, instance_name: "  " }, null] } });
  assert.equal(dev(n, GARAGE).label, "OpenThread Border Router", "a blank instance name: the model");
  assert.deepEqual(n.devices.filter((d) => d.preferred), [], "no preferred address: no mark");
  const twice = buildThreadNetwork(topology, { haThread: { datasets: null,
    routers: [data("aabbccdd00000111"), { ...data("aabbccdd00000111"), instance_name: "Border router loft" }] } });
  assert.equal(twice.devices.filter((d) => d.id === ATTIC).length, 1, "one address is one device");
  assert.deepEqual([twice.status.borderRouters, twice.status.borderRoutersKnown], [1, 2]);
  assert.equal(dev(twice, ATTIC).label, "Border router loft", "the later entry of one address wins");
});

test("#20 duplicate labels: the end of the extended address for border routers, the whole address where that is shared", () => {
  const same = buildThreadNetwork(withSnapshotBr("AABBCCDD00000110", 0x1c00),
    { haThread: { datasets: null, routers: [unnamed("aabbccdd00000111", { model_name: "OpenThread Border Router" })] } });
  assert.deepEqual(brs(same).map((d) => d.label).sort(),
    ["OpenThread Border Router (01:10)", "OpenThread Border Router (01:11)"], "the extended address, not the RLOC16");
  const shared = buildThreadNetwork(withSnapshotBr("AABBCCDD00010110"),
    { haThread: { datasets: null, routers: [unnamed("aabbccdd00020110", { model_name: "OpenThread Border Router" })] } });
  assert.deepEqual(brs(shared).map((d) => d.label).sort(),
    ["OpenThread Border Router (aa:bb:cc:dd:00:01:01:10)", "OpenThread Border Router (aa:bb:cc:dd:00:02:01:10)"]);
  // Without Home Assistant's list as well: two border routers of one model in the snapshot.
  const second = { ...topology.nodes.find((n) => n.kind === "border_router"), id: "br_AABBCCDD00000111",
    ext_address: "AABBCCDD00000111", rloc16: 0x2000 };
  const both = buildThreadNetwork({ ...withSnapshotBr("AABBCCDD00000110", 0x1c00), nodes: [...withSnapshotBr(
    "AABBCCDD00000110", 0x1c00).nodes, second] });
  assert.deepEqual(brs(both).map((d) => d.label).sort(),
    ["OpenThread Border Router (01:10)", "OpenThread Border Router (01:11)"]);
});

test("#20 status pill: 'n of m border routers' in amber when the snapshot holds fewer; 'no border router listed' stays", () => {
  assert.deepEqual([net.status.borderRouters, net.status.borderRoutersKnown], [1, 2]);
  const line = statusLine(net, { now });
  const part = line.parts.find(([key]) => key === "status.thread_br_count");
  assert.deepEqual(part, ["status.thread_br_count", { n: 1, m: 2 }, "status.thread_br_count_note"]);
  assert.equal(t(part[0], part[1]), "1 of 2 border routers");
  assert.ok(statusLine(net, { now, compact: true }).parts.some(([key]) => key === "status.thread_br_count"));
  // Amber for this alone: every pair measured both ways, a young snapshot.
  const clean = { ...net, status: { ...net.status, linksBoth: net.status.links } };
  assert.equal(statusLine(clean, { now }).level, "warn");
  assert.equal(statusLine({ ...clean, status: { ...clean.status, borderRoutersKnown: 1 } }, { now }).level, "ok");
  // Every known border router in the snapshot: no count.
  const one = buildThreadNetwork(topology, { haThread: { datasets, routers: [data("aabbccdd00000110")] } });
  assert.ok(!statusLine(one, { now }).parts.some(([key]) => key === "status.thread_br_count"));
  // None in the snapshot: the existing words, no count.
  const none = buildThreadNetwork(withoutSnapshotBr(), { haThread });
  const keys = statusLine(none, { now }).parts.map(([key]) => key);
  assert.ok(keys.includes("status.thread_no_br"));
  assert.ok(!keys.includes("status.thread_br_count"));
  assert.equal(statusLine(none, { now }).level, "warn");
});

test("#20 without the Thread integration's answers the network is today's", () => {
  const today = buildThreadNetwork(topology);
  for (const answers of [null, { datasets: null, routers: null }, { datasets: { datasets: "x" }, routers: "x" }]) {
    const n = buildThreadNetwork(topology, { haThread: answers });
    assert.deepEqual(n.devices, today.devices);
    assert.deepEqual(n.status, today.status);
    assert.deepEqual(statusLine(n, { now }).parts, statusLine(today, { now }).parts);
  }
  assert.ok(!statusLine(today, { now }).parts.some(([key]) => key === "status.thread_br_count"));
});

test("#20 an unheard border router is no route destination, has no route, and is never the default History partner", () => {
  const routed = buildThreadNetwork(topology, { haThread, tables: { nodes: [], read_at: 1767268800, observe_seconds: 600 } });
  assert.deepEqual(routed.routing.borderRouters, [GARAGE]);
  assert.equal(routed.routing.defaultRoute(ATTIC), null);
  assert.equal(routed.routing.defaultRoute(GARAGE), null);
  // The end device links to no border router: both are anchors without a link, and the attic one sorts first by name.
  const caps = historyCaps(net);
  assert.equal(caps.historyless(dev(net, ATTIC)), true);
  assert.equal(caps.historyless(dev(net, GARAGE)), false);
  assert.equal(defaultPartner(net, END, caps.anchorRole, caps.historyless), GARAGE);
  assert.equal(defaultPartner(net, END, caps.anchorRole), ATTIC, "without the engine's rule the shared code knows none");
  assert.ok(partnerChoices(net, END, caps.anchorRole).some((c) => c.id === ATTIC && c.group === "anchor"), "still in the menu");
  assert.equal(defaultPartner(net, ATTIC, caps.anchorRole, caps.historyless), null, "no neighbour: no button");
  assert.equal(defaultPartner(buildThreadNetwork(withoutSnapshotBr(), { haThread }), END, caps.anchorRole, caps.historyless), null);
  assert.equal(ENGINES.zigbee.history.historyless({ id: "x", inTopology: false }), false, "Zigbee has no such device");
});

test("#20 no pair badge on an unheard border router; the others keep theirs", () => {
  const view = new GraphView(new FakeCanvas(800, 600), { env: fakeEnv({ dpr: 1 }) });
  view.setNetwork(net);
  view.setPairBadges(true);
  view.select(GARAGE);
  const index = (id) => view.scene.index.get(id);
  const badge = (id) => badgeCentre(...view._screenOf(index(id)), symbolSize(view.cam.k));
  assert.equal(view.scene.nodes[index(ATTIC)].historyless, true);
  assert.equal(view._badgeAt(...badge(ATTIC)), -1);
  assert.equal(view._badgeAt(...badge(END)), index(END));
});

test("#20 Details: the unheard border router says no neighbour table lists it; the preferred one is marked", () => {
  const attic = details(net, ATTIC);
  assert.match(attic, /Not in the Matter server's topology: no Matter device's neighbour table lists it with a live link\./);
  assert.match(attic, /Home Assistant's preferred border router of its preferred Thread network\./);
  assert.match(attic, /Availability not reported/);
  assert.match(attic, /Border router · OpenThread BorderRouter/);
  assert.doesNotMatch(attic, /Unavailable|offline/i);
  assert.doesNotMatch(attic, /details\.|status\./, "every text resolves");
  assert.doesNotMatch(details(net, GARAGE), /Not in the Matter server's topology|preferred border router/);
});

test("#20 no route card on a border router's Details, also when the route tables could not be read", () => {
  const failed = buildThreadNetwork(topology, { haThread, tablesProblem: "not_supported: matter_not_loaded" });
  for (const id of [ATTIC, GARAGE]) assert.doesNotMatch(details(failed, id), /Route to|Route tables not read/, id);
  assert.match(details(failed, END), /Route tables not read: not_supported: matter_not_loaded/);
});

/** Timers on a clock that honours the milliseconds: time moves to the next due timer only once every promise and fake
 *  answer pending at the current time has settled. run(promise) settles it and reports the time it ended at; flush()
 *  fires what is left (a subscription's own window may outlast the read). */
function virtualClock() {
  let time = 0;
  let queue = [];
  const fire = () => {
    queue.sort((a, b) => a.at - b.at);
    const next = queue.shift();
    time = next.at;
    next.f();
  };
  const idle = () => new Promise((resolve) => { setImmediate(resolve); });
  return {
    now: () => time,
    pending: () => queue.map((x) => x.at),
    setTimeout: (f, ms) => { const timer = { at: time + ms, f }; queue.push(timer); return timer; },
    clearTimeout: (timer) => { queue = queue.filter((x) => x !== timer); },
    async run(promise) {
      let settled = null;
      promise.then((value) => { settled = { value, at: time }; }, (error) => { settled = { error, at: time }; });
      for (;;) {
        await idle();
        if (settled) return settled;
        assert.ok(queue.length, `the read hangs at ${time} ms with nothing pending`);
        fire();
      }
    },
    async flush() {
      while (queue.length) { fire(); await idle(); }
    },
  };
}

/** A Home Assistant with Matter loaded and the fixture's answers on `clock`. resultAt: when the subscription's result
 *  comes (null: never); "error" or "lost": the subscription is refused (unknown_command, connection lost). The
 *  fixture's events before the result come at once, the others `afterMs` after the result, `late` [{ at, event }] at
 *  their own time. datasetsAt: when list_datasets answers (null: never); datasets "error" or "lost": it fails. */
function fakeHass(clock, { resultAt = 3, afterMs = 20, late = [], datasetsAt = 1, datasets: answer = "ok" } = {}) {
  const log = { calls: [], subscribed: [], stopped: [] };
  const at = (ms, f) => clock.setTimeout(f, ms - clock.now());
  return {
    log,
    callWS: async (msg) => {
      log.calls.push(msg.type);
      if (msg.type === "config_entries/get") return [{ entry_id: "m", domain: "matter", state: "loaded" }];
      if (msg.type === "matter/network_topology") return topology;
      if (msg.type !== "thread/list_datasets") throw { code: "unknown_command", message: "Unknown command." };
      if (datasetsAt === null) return new Promise(() => {});
      return new Promise((resolve, reject) => at(datasetsAt, () => (answer === "ok" ? resolve(datasets)
        : reject(answer === "lost" ? { code: 3 } : { code: "unknown_command", message: "Unknown command." }))));
    },
    connection: {
      subscribeMessage: (callback, msg, options) => {
        log.subscribed.push({ msg, options });
        if (resultAt === "error") return Promise.reject({ code: "unknown_command", message: "Unknown command." });
        if (resultAt === "lost") return Promise.reject({ code: 3 });
        for (const e of events.before_result) callback(e);
        for (const x of late) at(x.at, () => callback(x.event));
        if (resultAt === null) return new Promise(() => {});
        const unsubscribe = async () => { log.stopped.push(clock.now()); };
        return new Promise((resolve) => at(resultAt, () => {
          resolve(unsubscribe);
          at(resultAt + afterMs, () => { for (const e of events.after_result) callback(e); });
        }));
      },
    },
  };
}
const read = (hass, clock) => clock.run(readThread(hass, {}, { timers: clock }));
const labels = (network) => brs(network).map((d) => d.label).sort();

test("#20 the adapter collects before and after the result and removals, and unsubscribes 150 ms after the result", async () => {
  assert.deepEqual([DISCOVERY_MS, BORDER_ROUTERS_MS], [150, 500]);
  const clock = virtualClock();
  const hass = fakeHass(clock);
  const { value, at } = await read(hass, clock);
  assert.equal(at, 3 + 150, "the read ends when the window after the result does");
  assert.deepEqual(hass.log.stopped, [153]);
  assert.deepEqual(clock.pending(), [], "the 500 ms bound is cleared");
  assert.deepEqual(labels(value.network), ["Border router attic", "Border router garage"]);
  assert.equal(dev(value.network, "aa:bb:cc:dd:00:00:01:30"), undefined, "router_removed takes it out again");
  assert.equal(dev(value.network, ATTIC).preferred, true);
  assert.deepEqual(hass.log.subscribed, [{ msg: { type: "thread/discover_routers" }, options: { resubscribe: false } }]);
  assert.deepEqual([...new Set(hass.log.calls)].sort(), ["config_entries/get", "matter/network_topology",
    "meshroute_topology_explorer/thread_tables", "thread/list_datasets"], "no other command, no keys");
});

test("#20 the window starts at the result: an event 140 ms after it counts, one 160 ms after it does not", async () => {
  const clock = virtualClock();
  const extra = (key, name) => ({ type: "router_discovered", key, data: { ...data("aabbccdd00000111"), extended_address: key,
    instance_name: name } });
  const hass = fakeHass(clock, { resultAt: 100, late: [{ at: 240, event: extra("aabbccdd00000140", "Border router hall") },
    { at: 260, event: extra("aabbccdd00000160", "Border router shed") }] });
  const { value, at } = await read(hass, clock);
  assert.equal(at, 250);
  assert.deepEqual(hass.log.stopped, [250]);
  assert.deepEqual(labels(value.network), ["Border router attic", "Border router garage", "Border router hall"]);
});

test("#20 the whole read ends 500 ms after it started: a late result gives no routers, a window cut short what came", async () => {
  let clock = virtualClock();
  let hass = fakeHass(clock, { resultAt: 600 });
  let r = await read(hass, clock);
  assert.equal(r.at, 500);
  assert.deepEqual(labels(r.value.network), ["OpenThread Border Router"], "no result in time: today's names");
  assert.deepEqual(hass.log.stopped, []);
  await clock.flush();
  assert.deepEqual(hass.log.stopped, [750], "the late subscription ends 150 ms after its result, once");
  clock = virtualClock();
  hass = fakeHass(clock, { resultAt: 400 });
  r = await read(hass, clock);
  assert.equal(r.at, 500);
  assert.deepEqual(labels(r.value.network), ["Border router attic", "Border router garage"], "what came by 500 ms");
  await clock.flush();
  assert.deepEqual(hass.log.stopped, [550]);
  clock = virtualClock();
  hass = fakeHass(clock, { resultAt: null });
  r = await read(hass, clock);
  assert.equal(r.at, 500, "a result that never comes");
  assert.equal(r.value.status, "ok");
});

test("#20 a hanging list_datasets ends at the bound; the subscription is stopped once, on its own time", async () => {
  const clock = virtualClock();
  const hass = fakeHass(clock, { datasetsAt: null });
  const { value, at } = await read(hass, clock);
  assert.equal(at, 500);
  assert.deepEqual(hass.log.stopped, [153], "never waits for the datasets");
  assert.deepEqual(labels(value.network), ["Border router attic", "Border router garage"]);
  assert.deepEqual(value.network.devices.filter((d) => d.preferred), [], "no datasets: no mark");
  await clock.flush();
  assert.deepEqual(hass.log.stopped, [153]);
});

test("#20 a slow list_datasets: the read waits for it within the bound; the subscription is not held up", async () => {
  const clock = virtualClock();
  const hass = fakeHass(clock, { datasetsAt: 300 });
  const { value, at } = await read(hass, clock);
  assert.equal(at, 300);
  assert.deepEqual(hass.log.stopped, [153]);
  assert.equal(dev(value.network, ATTIC).preferred, true);
});

test("#20 a lost connection fails the read like any other: list_datasets or the subscription refused with code 3", async () => {
  let clock = virtualClock();
  let hass = fakeHass(clock, { datasetsAt: 50, datasets: "lost" });
  let r = await read(hass, clock);
  assert.equal(r.error.code, 3);
  assert.equal(r.at, 153, "after the subscription's window, which the lost datasets do not cut");
  assert.deepEqual(hass.log.stopped, [153]);
  clock = virtualClock();
  hass = fakeHass(clock, { resultAt: "lost" });
  r = await read(hass, clock);
  assert.equal(r.error.code, 3);
});

test("#20 without the Thread integration the read is today's, at once and without a message", async () => {
  const today = buildThreadNetwork(topology);
  const clock = virtualClock();
  const hass = fakeHass(clock, { resultAt: "error", datasets: "error" });
  const { value, at } = await read(hass, clock);
  assert.equal(at, 1, "as soon as both commands answered");
  assert.deepEqual(clock.pending(), []);
  assert.deepEqual(Object.keys(value).sort(), ["network", "status"]);
  assert.deepEqual(value.network.devices, today.devices);
  assert.deepEqual(statusLine(value.network, { now }).parts.map(([key]) => key), statusLine(today, { now }).parts.map(([key]) => key));
  // Only the datasets fail: the routers still name and add border routers, nothing is marked preferred.
  const c2 = virtualClock();
  const r2 = await read(fakeHass(c2, { datasets: "error" }), c2);
  assert.equal(dev(r2.value.network, ATTIC).label, "Border router attic");
  assert.deepEqual(r2.value.network.devices.filter((d) => d.preferred), []);
});
