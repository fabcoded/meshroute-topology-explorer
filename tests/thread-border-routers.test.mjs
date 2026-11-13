// SPDX-License-Identifier: MIT
// Tests for #20, the border routers of Home Assistant's Thread integration (spec 3.2 "Border routers", 6, 9.2), on the
// synthetic fixture tests/fixtures/thread-border-routers.json (two border routers in one network, one of them absent
// from the Matter topology) and small variants of it: matching by extended address across case within the extended
// PAN id, names, a border router without lanes that is never rated or offline, the preferred one, the status pill
// "n of m", routes and the History partner, and the adapter's subscription (events before and after its result,
// router_removed, a result too late, the integration missing, a lost connection). Expected values come from the spec
// and the fixture, checked by hand. Run: npm test
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { installFakeDom, FakeEl } from "./dom-fake.mjs";

installFakeDom();
const F = "../custom_components/meshroute_topology_explorer/frontend/";
const { buildThreadNetwork } = await import(`${F}engines/thread/model.js`);
const { classifyLanes } = await import(`${F}engines/thread/lanes.js`);
const { statusLine } = await import(`${F}engines/thread/status.js`);
const { DISCOVERY_MS, readThread } = await import(`${F}adapters/matter.js`);
const { defaultPartner, partnerChoices } = await import(`${F}ui/history-partners.js`);
const { ENGINES } = await import(`${F}engines/index.js`);
const { translator } = await import(`${F}ui/i18n.js`);

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
const t = translator("en");
const now = Date.parse("2026-01-01T13:00:00Z"); // one hour after the fixture's snapshot

/** The fixture's topology with the snapshot's border router at another extended address and RLOC16. */
function withSnapshotBr(ext, rloc16 = null) {
  const id = `br_${ext}`;
  return { ...topology,
    nodes: topology.nodes.map((n) => (n.kind === "border_router" ? { ...n, id, ext_address: ext, rloc16 } : n)),
    connections: topology.connections.map((c) => (c.target.startsWith("br_") ? { ...c, target: id } : c)) };
}
/** The router data of the fixture's attic border router at another address, without an instance name. */
const unnamed = (key, extra = {}) => ({ ...data("aabbccdd00000111"), instance_name: null, extended_address: key, ...extra });

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
  assert.equal(net.devices.filter((d) => d.role === "border router").length, 2, "matched, not added twice");
  assert.equal(dev(buildThreadNetwork(topology), GARAGE).label, "OpenThread Border Router", "without the list: the model");
  // The snapshot's network is matched however the integration writes the extended PAN id.
  const upper = { ...haThread, routers: haThread.routers.map((r) => ({ ...r, extended_pan_id: r.extended_pan_id.toUpperCase() })) };
  assert.equal(dev(buildThreadNetwork(topology, { haThread: upper }), GARAGE).label, "Border router garage");
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

test("#20 two border routers of one model get the end of their extended address; a shared end the whole address", () => {
  const same = buildThreadNetwork(withSnapshotBr("AABBCCDD00000110", 0x1c00),
    { haThread: { datasets: null, routers: [unnamed("aabbccdd00000111", { model_name: "OpenThread Border Router" })] } });
  assert.deepEqual(same.devices.filter((d) => d.role === "border router").map((d) => d.label).sort(),
    ["OpenThread Border Router (01:10)", "OpenThread Border Router (01:11)"], "the extended address, not the RLOC16");
  const shared = buildThreadNetwork(withSnapshotBr("AABBCCDD00010110"),
    { haThread: { datasets: null, routers: [unnamed("aabbccdd00020110", { model_name: "OpenThread Border Router" })] } });
  assert.deepEqual(shared.devices.filter((d) => d.role === "border router").map((d) => d.label).sort(),
    ["OpenThread Border Router (aa:bb:cc:dd:00:01:01:10)", "OpenThread Border Router (aa:bb:cc:dd:00:02:01:10)"]);
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
  const none = buildThreadNetwork({ ...topology, nodes: topology.nodes.filter((n) => n.kind !== "border_router"),
    connections: topology.connections.filter((c) => !c.target.startsWith("br_")) }, { haThread });
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
  const end = net.devices.find((d) => d.role === "end device").id;
  assert.equal(defaultPartner(net, end, "border router"), GARAGE);
  assert.ok(partnerChoices(net, end, "border router").some((c) => c.id === ATTIC && c.group === "anchor"), "still in the menu");
  assert.equal(defaultPartner(net, ATTIC, "border router"), null, "no neighbour: no button");
  const onlyUnheard = buildThreadNetwork({ ...topology, nodes: topology.nodes.filter((n) => n.kind !== "border_router"),
    connections: topology.connections.filter((c) => !c.target.startsWith("br_")) }, { haThread });
  assert.equal(defaultPartner(onlyUnheard, end, "border router"), null);
});

test("#20 Details: the unheard border router says no neighbour table names it; the preferred one is marked", () => {
  const details = (id) => {
    const container = new FakeEl("div");
    ENGINES.thread.details(container, { network: net, t, id, onSelect() {}, onFindings() {}, now });
    return container.textContent;
  };
  const attic = details(ATTIC);
  assert.match(attic, /Not in the Matter server's topology: no Matter device's neighbour table names it\./);
  assert.match(attic, /Home Assistant's preferred border router of its preferred Thread network\./);
  assert.match(attic, /Availability not reported/);
  assert.match(attic, /Border router · OpenThread BorderRouter/);
  assert.doesNotMatch(attic, /Unavailable|offline/i);
  assert.doesNotMatch(attic, /details\.|status\./, "every text resolves");
  const garage = details(GARAGE);
  assert.doesNotMatch(garage, /Not in the Matter server's topology|preferred border router/);
});

/** Timers for the adapter: each wait ends after the events and promises queued before it (setImmediate). */
function fakeTimers() {
  const waits = [];
  return { waits, setTimeout: (f, ms) => { waits.push(ms); setImmediate(f); } };
}

/** A Home Assistant with Matter loaded and the fixture's answers. subscribe: "ok", "late" (the result only when the
 *  test calls log.later()), "error" (unknown_command) or "lost" (connection lost); datasetsError: list_datasets fails. */
function fakeHass({ subscribe = "ok", datasetsError = false } = {}) {
  const log = { calls: [], subscribed: [], stopped: 0, later: null };
  const hass = {
    log,
    callWS: async (msg) => {
      log.calls.push(msg.type);
      if (msg.type === "config_entries/get") return [{ entry_id: "m", domain: "matter", state: "loaded" }];
      if (msg.type === "matter/network_topology") return topology;
      if (msg.type === "thread/list_datasets" && !datasetsError) return datasets;
      throw { code: "unknown_command", message: "Unknown command." };
    },
    connection: {
      subscribeMessage: (callback, msg, options) => {
        log.subscribed.push({ msg, options });
        if (subscribe === "error") return Promise.reject({ code: "unknown_command", message: "Unknown command." });
        if (subscribe === "lost") return Promise.reject({ code: 3 });
        // As measured on the owner's network: one event before the result, the others after it.
        for (const e of events.before_result) callback(e);
        setImmediate(() => { for (const e of events.after_result) callback(e); });
        const unsubscribe = async () => { log.stopped += 1; };
        if (subscribe === "late") return new Promise((resolve) => { log.later = () => resolve(unsubscribe); });
        return Promise.resolve(unsubscribe);
      },
    },
  };
  return hass;
}

test("#20 the adapter collects discoveries before and after the result and removals, then unsubscribes", async () => {
  const hass = fakeHass();
  const timers = fakeTimers();
  const read = await readThread(hass, {}, { timers });
  assert.equal(read.status, "ok");
  const brs = read.network.devices.filter((d) => d.role === "border router");
  assert.deepEqual(brs.map((d) => [d.label, d.inTopology, d.preferred]).sort(),
    [["Border router attic", false, true], ["Border router garage", true, false]]);
  assert.equal(dev(read.network, "aa:bb:cc:dd:00:00:01:30"), undefined, "router_removed takes it out again");
  assert.deepEqual(hass.log.subscribed, [{ msg: { type: "thread/discover_routers" }, options: { resubscribe: false } }]);
  assert.equal(hass.log.stopped, 1, "unsubscribed after the window");
  assert.equal(DISCOVERY_MS, 500);
  assert.ok(timers.waits.length > 0 && timers.waits.every((ms) => ms === DISCOVERY_MS));
  assert.deepEqual([...new Set(hass.log.calls)].sort(), ["config_entries/get", "matter/network_topology",
    "meshroute_topology_explorer/thread_tables", "thread/list_datasets"], "no other command, no keys");
});

test("#20 a subscription without a result within DISCOVERY_MS counts as no router data and ends when the result comes", async () => {
  const hass = fakeHass({ subscribe: "late" });
  const read = await readThread(hass, {}, { timers: fakeTimers() });
  assert.equal(read.status, "ok");
  assert.equal(dev(read.network, ATTIC), undefined);
  assert.equal(dev(read.network, GARAGE).label, "OpenThread Border Router");
  assert.equal(read.network.status.borderRoutersKnown, 1);
  assert.equal(hass.log.stopped, 0);
  hass.log.later();
  await new Promise((resolve) => { setImmediate(resolve); });
  assert.equal(hass.log.stopped, 1, "the late subscription is ended");
});

test("#20 without the Thread integration, or when a command fails, the read is today's, without a message", async () => {
  const today = buildThreadNetwork(topology);
  const missing = await readThread(fakeHass({ subscribe: "error", datasetsError: true }), {}, { timers: fakeTimers() });
  assert.deepEqual(Object.keys(missing).sort(), ["network", "status"]);
  assert.equal(missing.status, "ok");
  assert.deepEqual(missing.network.devices, today.devices);
  assert.deepEqual(statusLine(missing.network, { now }).parts.map(([key]) => key),
    statusLine(today, { now }).parts.map(([key]) => key));
  // Only the datasets fail: the routers still name and add border routers, nothing is marked preferred.
  const noDatasets = await readThread(fakeHass({ datasetsError: true }), {}, { timers: fakeTimers() });
  assert.equal(dev(noDatasets.network, ATTIC).label, "Border router attic");
  assert.deepEqual(noDatasets.network.devices.filter((d) => d.preferred), []);
});

test("#20 a lost connection during the border router read fails the read like any other", async () => {
  await assert.rejects(readThread(fakeHass({ subscribe: "lost" }), {}, { timers: fakeTimers() }), (err) => err.code === 3);
});
