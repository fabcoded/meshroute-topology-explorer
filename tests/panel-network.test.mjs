// SPDX-License-Identifier: MIT
// Tests for the Thread network in the panel (brief a7, spec 3.2, 6, 9, 11): reading the Matter topology (refresh false,
// not_supported), the network switch's choices and stored choice, settings kept per network, the status line, the map's
// lanes and values for Thread, the legend and the details rows. Run: node --test tests/
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readNetwork } from "../custom_components/meshroute_topology_explorer/frontend/ui/controller.js";
import { readThread } from "../custom_components/meshroute_topology_explorer/frontend/adapters/matter.js";
import { activeNetwork, loadNetworkChoice, networkChoices, PANEL_STORE, saveNetworkChoice }
  from "../custom_components/meshroute_topology_explorer/frontend/ui/network-switch.js";
import { ageParts } from "../custom_components/meshroute_topology_explorer/frontend/ui/status.js";
import { threadParts } from "../custom_components/meshroute_topology_explorer/frontend/engines/thread/status.js";
import { SettingsClient } from "../custom_components/meshroute_topology_explorer/frontend/ui/settings.js";
import { buildScene } from "../custom_components/meshroute_topology_explorer/frontend/graph/renderer.js";
import { ENGINES } from "../custom_components/meshroute_topology_explorer/frontend/engines/index.js";
import { laneValue, legendEntries, threadValue } from "../custom_components/meshroute_topology_explorer/frontend/engines/thread/lanes.js";
import { threadNeighbourRows, threadReception } from "../custom_components/meshroute_topology_explorer/frontend/engines/thread/details.js";
import { buildThreadNetwork } from "../custom_components/meshroute_topology_explorer/frontend/engines/thread/model.js";
import { translator } from "../custom_components/meshroute_topology_explorer/frontend/ui/i18n.js";

const load = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8")).responses;
const zhaResponses = load("zha-sample.json");
const topology = load("matter-sample.json")["matter/network_topology"];
const thread = buildThreadNetwork(topology);

/** A fake hass: ZHA and Matter loaded or not, the topology answer or an error code, every message recorded. */
function fakeHass({ zha = true, matter = true, topologyError = null } = {}) {
  const calls = [];
  return {
    user: { is_admin: true }, connected: true, calls,
    callWS: async (msg) => {
      calls.push(msg);
      switch (msg.type) {
        case "config_entries/get":
          if (msg.domain === "matter") return matter ? [{ entry_id: "m", domain: "matter", state: "loaded" }] : [];
          return zha ? zhaResponses["config_entries/get"] : [];
        case "zha/devices": return zhaResponses["zha/devices"];
        case "config/device_registry/list": return zhaResponses["config/device_registry/list"];
        case "config/area_registry/list": return zhaResponses["config/area_registry/list"];
        case "matter/network_topology":
          if (topologyError) throw { code: topologyError, message: "x" };
          return topology;
        default: throw { code: "unknown_command" };
      }
    },
  };
}

test("both networks are read; the topology is asked with refresh false, never true", async () => {
  const hass = fakeHass();
  const result = await readNetwork(hass);
  assert.equal(result.phase, "ready");
  assert.equal(result.network.source, "zha");
  assert.equal(result.networks.thread.source, "thread");
  assert.equal(result.thread.status, "ok");
  const asks = hass.calls.filter((m) => m.type === "matter/network_topology");
  assert.deepEqual(asks, [{ type: "matter/network_topology", refresh: false }]);
});

test("Thread alone is shown when ZHA is not loaded; neither gives ZHA's message", async () => {
  const only = await readNetwork(fakeHass({ zha: false }));
  assert.equal(only.phase, "ready");
  assert.equal(only.network.source, "thread");
  assert.deepEqual(only.raw, []);
  assert.equal((await readNetwork(fakeHass({ zha: false, matter: false }))).phase, "zha_not_loaded");
});

test("not_supported and an older Home Assistant (unknown_command) say so; other errors carry the message", async () => {
  assert.equal((await readThread(fakeHass({ topologyError: "not_supported" }))).status, "not_supported");
  assert.equal((await readThread(fakeHass({ topologyError: "unknown_command" }))).status, "not_supported");
  const err = await readThread(fakeHass({ topologyError: "home_assistant_error" }));
  assert.equal(err.status, "error");
  assert.equal((await readThread(fakeHass({ matter: false }))).status, "not_loaded");
  const zhaOnly = await readNetwork(fakeHass({ topologyError: "not_supported" }));
  assert.equal(zhaOnly.network.source, "zha");
  assert.equal(zhaOnly.networks.thread, null);
});

test("switch choices: one network is plain text, a greyed Thread entry names its reason; first load is Zigbee", () => {
  const zha = { id: "z" };
  assert.deepEqual(networkChoices({ networks: { zha, thread: null }, thread: { status: "not_loaded" } }),
    [{ key: "zha", available: true }]);
  const both = networkChoices({ networks: { zha, thread }, thread: { status: "ok" } });
  assert.deepEqual(both.map((c) => c.key), ["zha", "thread"]);
  assert.equal(activeNetwork(both, null), "zha");
  assert.equal(activeNetwork(both, "thread"), "thread");
  const greyed = networkChoices({ networks: { zha, thread: null }, thread: { status: "not_supported" } });
  assert.deepEqual(greyed[1], { key: "thread", available: false, reason: "not_supported", message: null });
  assert.equal(activeNetwork(greyed, "thread"), "zha", "a greyed network is never shown");
  assert.equal(activeNetwork(networkChoices({ networks: { zha: null, thread }, thread: { status: "ok" } }), "zha"), "thread");
});

test("the chosen network is stored under the panel's own id, merged; a failing store is ignored", async () => {
  const store = new Map([[PANEL_STORE, { other: 1 }]]);
  const callWS = async (msg) => {
    if (msg.type.endsWith("/get")) return { settings: store.get(msg.network) || null };
    store.set(msg.network, msg.settings);
    return {};
  };
  assert.equal(await loadNetworkChoice(callWS), null);
  assert.equal(await saveNetworkChoice(callWS, "thread"), true);
  assert.deepEqual(store.get(PANEL_STORE), { other: 1, network: "thread" });
  assert.equal(await loadNetworkChoice(callWS), "thread");
  const failing = async () => { throw { code: "unknown_command" }; };
  assert.equal(await loadNetworkChoice(failing), null);
  assert.equal(await saveNetworkChoice(failing, "zha"), false);
});

test("settings are kept per network: the Thread id is its own and valid for the integration", async () => {
  assert.match(thread.id, /^[A-Za-z0-9_.:-]{1,64}$/);
  assert.notEqual(thread.id, PANEL_STORE);
  const stored = new Map();
  const callWS = async (msg) => {
    if (msg.type.endsWith("/get")) return { settings: stored.get(msg.network) || null };
    stored.set(msg.network, msg.settings);
    return {};
  };
  const noTimers = { setTimeout: () => 0, clearTimeout: () => {} };
  const zhaClient = new SettingsClient({ callWS, network: "entry_01", timers: noTimers });
  const threadClient = new SettingsClient({ callWS, network: thread.id, timers: noTimers });
  await zhaClient.load();
  await threadClient.load();
  threadClient.update({ density: "dense" });
  await threadClient.flush();
  assert.equal(stored.get(thread.id).density, "dense");
  assert.equal(stored.has("entry_01"), false, "ZHA's settings are untouched");
});

test("status line for Thread: coverage, collection time with age, missing border routers", () => {
  const t = translator("en");
  const parts = threadParts(thread, { collected: { time: "14:14", age: "5 min ago" } });
  assert.deepEqual(parts.map(([k]) => k), ["status.source", "status.thread_links", "status.thread_read"]);
  assert.equal(t(parts[1][0], parts[1][1]), "Links with both directions: 3/5");
  assert.equal(t(parts[2][0], parts[2][1]), "read 14:14 (5 min ago)");
  const noBr = { ...thread, status: { ...thread.status, borderRouters: 0 } };
  assert.equal(threadParts(noBr, {}).at(-1)[0], "status.thread_no_br");
  assert.deepEqual(threadParts(thread, { compact: true }).map(([k]) => k), ["status.short_thread_links"]);
  assert.deepEqual(ageParts("2026-01-01T12:00:00Z", Date.parse("2026-01-01T12:07:30Z")), ["status.age_minutes", { n: 7 }]);
  assert.deepEqual(ageParts("2026-01-01T12:00:00Z", Date.parse("2026-01-01T15:00:00Z")), ["status.age_hours", { n: 3 }]);
});

test("map: the overview draws parent links and neighbours; a click shows the device's own lanes and glyphs", () => {
  const scene = buildScene(thread, (s) => s.length * 6);
  assert.equal(scene.engine, ENGINES.thread);
  const leader = scene.index.get(thread.devices.find((d) => d.leader).id);
  // Zigbee view settings are not the Thread engine's: they change nothing.
  const own = ENGINES.thread.scene.focus(scene, leader, { paths: "all", sourceRoute: "assume", heard: true, selected: leader });
  assert.equal(own.ends.length, 0, "no paths, no unknown ends");
  assert.equal(own.hops.length, 5, "leader: both lanes to router 15 and to its child, one to the border router");
  assert.equal(own.glyphs.length, 1, "the border router has no table: one direction without a reading");
  assert.equal(own.nodes.size, 4);
});

test("arrow values for Thread: RSSI in dBm, link quality only without RSSI; unknown stays a glyph", () => {
  assert.equal(threadValue({ state: "measured", rssi: -75, lqi: 3 }), "−75 dBm");
  assert.equal(threadValue({ state: "measured", rssi: null, lqi: 2 }), "LQI 2");
  assert.equal(threadValue({ state: "measured", rssi: -75, lqi: 3 }, "lqi"), "LQI 3");
  assert.equal(threadValue({ state: "unknown", reason: "no table (not a Matter node)" }), "?");
  assert.equal(laneValue({ state: "measured", scale: "thread-lqi", rssi: -36, lqi: 3 }, {}), "−36 dBm");
  assert.equal(threadReception({ state: "measured", rssi: -36, lqi: 3 }), "−36 dBm · LQI 3");
});

test("legend for Thread lists what its map draws, nothing about stages", () => {
  const ids = legendEntries({ foreground: "#000", muted: "#888" }).map((e) => e.id);
  assert.deepEqual(ids, ["parent", "neighbour", "not-listed", "no-table-thread", "rx-thread"]);
  const t = translator("en");
  for (const id of ["parent", "neighbour", "not-listed", "no-table-thread"]) assert.notEqual(t(`legend.link.${id}`), `legend.link.${id}`);
});

test("details rows: the parent first, both directions per neighbour", () => {
  const child = thread.devices.find((d) => d.role === "end device");
  const rows = threadNeighbourRows(thread, child.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].parent, true);
  assert.equal(rows[0].hears.state, "measured");
  const leader = thread.devices.find((d) => d.leader);
  assert.equal(threadNeighbourRows(thread, leader.id).length, 3);
});

test("merge A4w: zigpy's route records are read for ZHA only; the scan's re-reads skip the Matter topology", async () => {
  const zigpy = "meshroute_topology_explorer/zigpy_routes";
  const both = fakeHass();
  await readNetwork(both);
  assert.equal(both.calls.filter((m) => m.type === zigpy).length, 1);
  const threadOnly = fakeHass({ zha: false });
  const only = await readNetwork(threadOnly);
  assert.equal(only.network.source, "thread");
  assert.equal(threadOnly.calls.filter((m) => m.type === zigpy).length, 0, "no zigpy call for Thread");
  const scan = fakeHass();
  const reread = await readNetwork(scan, { matter: false });
  assert.equal(reread.network.source, "zha");
  assert.equal(scan.calls.filter((m) => m.type === "matter/network_topology").length, 0);
  assert.deepEqual(networkChoices(reread).map((c) => c.key), ["zha"], "a skipped read greys nothing");
});

test("Devices search finds a Thread device by its RLOC16 and its extended address (engine.addresses)", async () => {
  const { deviceRows, filterRows } = await import("../custom_components/meshroute_topology_explorer/frontend/ui/device-list.js");
  const pan = "00112233aabbcc01";
  const net = buildThreadNetwork({ nodes: [
    { id: "1", kind: "matter", network_type: "thread", node_id: 1, role: "leader", available: true, rloc16: 0x1c00,
      ext_address: "AABBCCDD00000001", ext_pan_id: pan },
    { id: "2", kind: "matter", network_type: "thread", node_id: 2, role: "end_device", available: true, rloc16: 0x1c01,
      ext_address: "AABBCCDD00000002", ext_pan_id: pan },
  ], connections: [{ source: "2", target: "1", network: "thread", source_to_target: { lqi: 3, rssi: -60 } }] }, {});
  const rows = deviceRows(net);
  const found = (text) => filterRows(rows, text).map((r) => net.devices.find((d) => d.id === r.id).nodeKey);
  assert.deepEqual(found("0x1c01"), ["2"], "RLOC16 in hex");
  assert.deepEqual(found("7168"), ["1"], "RLOC16 in decimal");
  assert.deepEqual(found("aa:bb:cc:dd:00:00:00:02"), ["2"], "extended address");
  assert.equal("nwk" in net.devices[0], false, "the RLOC16 is no Zigbee network address");
});
