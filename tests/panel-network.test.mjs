// SPDX-License-Identifier: MIT
// Tests for the Thread network in the panel (spec 3.2, 6, 9, 11): reading the Matter topology (refresh false,
// not_supported), the network switch's choices and stored choice, settings kept per network, the status line, the map's
// lanes and values for Thread, the legend and the details rows. Run: npm test
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
import { adapterByKey } from "../custom_components/meshroute_topology_explorer/frontend/adapters/index.js";

const load = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8")).responses;
const zhaResponses = load("zha-sample.json");
const topology = load("matter-sample.json")["matter/network_topology"];
const thread = buildThreadNetwork(topology);

/** A fake hass: ZHA and Matter loaded or not, the topology answer or an error code, every message recorded. */
/** zha / matter: true (loaded), false (no entry), an entry state such as "setup_retry" (set up, not running), or for
 *  zha a list of entries as config_entries/get answers. */
function fakeHass({ zha = true, matter = true, topologyError = null, topologyAnswer = topology, zhaError = null } = {}) {
  const calls = [];
  return {
    user: { is_admin: true }, connected: true, calls,
    callWS: async (msg) => {
      calls.push(msg);
      switch (msg.type) {
        case "config_entries/get":
          if (msg.domain === "matter") {
            return matter ? [{ entry_id: "m", domain: "matter", state: matter === true ? "loaded" : matter }] : [];
          }
          if (typeof zha === "string") return [{ entry_id: "z", domain: "zha", state: zha }];
          if (Array.isArray(zha)) return zha;
          return zha ? zhaResponses["config_entries/get"] : [];
        case "zha/devices":
          if (zhaError) throw { code: zhaError, message: "ZHA did not answer" };
          return zhaResponses["zha/devices"];
        case "config/device_registry/list": return zhaResponses["config/device_registry/list"];
        case "config/area_registry/list": return zhaResponses["config/area_registry/list"];
        case "matter/network_topology":
          if (topologyError) throw { code: topologyError, message: "x" };
          return topologyAnswer;
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
  assert.equal(result.reads.thread.status, "ok");
  const asks = hass.calls.filter((m) => m.type === "matter/network_topology");
  assert.deepEqual(asks, [{ type: "matter/network_topology", refresh: false }]);
});

test("Thread alone is shown when ZHA is not loaded; neither set up is one shared message (#15)", async () => {
  const only = await readNetwork(fakeHass({ zha: false }));
  assert.equal(only.phase, "ready");
  assert.equal(only.network.source, "thread");
  assert.deepEqual(only.raw, []);
  assert.deepEqual(networkChoices(only).map((c) => c.key), ["thread"], "one network: the pill menu lists none");
  const none = await readNetwork(fakeHass({ zha: false, matter: false }));
  assert.equal(none.phase, "no_network");
  assert.equal(translator("en")(`message.${none.phase}`), "No Zigbee or Thread network: set up ZHA or Matter, then try again.");
});

test("#15: without ZHA, a Thread network that cannot be shown gives Thread's reason, never ZHA's", async () => {
  const t = translator("en");
  const cases = [[{ topologyError: "not_supported" }, "thread_not_supported", /Matter server does not offer/],
    [{ topologyAnswer: { nodes: [], connections: [] } }, "thread_empty", /lists no Thread device/],
    [{ topologyError: "home_assistant_error" }, "thread_error", /could not be read \(x\)/]];
  for (const [opts, phase, text] of cases) {
    const result = await readNetwork(fakeHass({ zha: false, ...opts }));
    assert.equal(result.phase, phase);
    assert.deepEqual(result.reasons.map((r) => r.phase), [phase], "ZHA is not set up: no ZHA line");
    assert.match(t(`message.${phase}`, { message: result.message || "?" }), text);
    assert.doesNotMatch(t(`message.${phase}`, { message: result.message || "?" }), /ZHA/);
  }
  assert.doesNotMatch(t("status.thread_not_supported"), /Home Assistant 20/, "the minimum is 2026.10: the cause is the Matter server");
  // Both set up, neither shows a network: each says why, ZHA first.
  const both = await readNetwork(fakeHass({ zhaError: "home_assistant_error", topologyError: "not_supported" }));
  assert.deepEqual(both.reasons.map((r) => r.phase), ["zha_error", "thread_not_supported"]);
});

test("#15 (rev15): an entry that is set up but not running is greyed with its state, never 'not set up'", async () => {
  const t = translator("en");
  // ZHA not running (coordinator unreachable), Thread readable: Thread shown, Zigbee greyed.
  const zhaDown = await readNetwork(fakeHass({ zha: "setup_retry" }));
  assert.equal(zhaDown.network.source, "thread");
  const zhaChoice = networkChoices(zhaDown)[0];
  assert.deepEqual(zhaChoice, { key: "zha", available: false, reason: "not_running", message: "setup_retry" });
  assert.equal(adapterByKey("zha").reasonText(zhaChoice, t), "ZHA is not running (setup_retry)");
  // Matter not running (server add-on down), Zigbee readable: Zigbee shown, Thread greyed.
  const matterDown = await readNetwork(fakeHass({ matter: "setup_retry" }));
  assert.equal(matterDown.network.source, "zha");
  const threadChoice = networkChoices(matterDown)[1];
  assert.deepEqual(threadChoice, { key: "thread", available: false, reason: "not_running", message: "setup_retry" });
  assert.equal(adapterByKey("thread").reasonText(threadChoice, t), "the Matter integration is not running (setup_retry)");
  // Neither readable: one line each, never the "set up ZHA or Matter" message.
  const bothDown = await readNetwork(fakeHass({ zha: "setup_error", matter: "setup_retry" }));
  assert.deepEqual(bothDown.reasons, [{ phase: "zha_not_running", message: "setup_error" },
    { phase: "thread_not_running", message: "setup_retry" }]);
  assert.deepEqual(bothDown.reasons.map((r) => t(`message.${r.phase}`, { message: r.message })), [
    "Zigbee cannot be shown: ZHA is not running (setup_error).",
    "Thread cannot be shown: the Matter integration is not running (setup_retry)."]);
  const onlyMatterDown = await readNetwork(fakeHass({ zha: false, matter: "setup_retry" }));
  assert.deepEqual(onlyMatterDown.reasons.map((r) => r.phase), ["thread_not_running"]);
});

test("#15 (rev15b): the Zigbee network is named after the ZHA entry that counts, as the recorder names it", async () => {
  const real = zhaResponses["config_entries/get"][0];
  const entries = [{ entry_id: "ignored", domain: "zha", source: "ignore", state: "not_loaded" },
    { entry_id: "disabled", domain: "zha", disabled_by: "user", state: "not_loaded" },
    { entry_id: "retrying", domain: "zha", state: "setup_retry" }, real];
  const result = await readNetwork(fakeHass({ zha: entries }));
  assert.equal(result.network.id, real.entry_id, "history, settings and observations use the real entry's id");
  assert.deepEqual(result.network.live.configEntries.map((e) => e.entry_id), [real.entry_id, "retrying"]);
});

test("#15: a ZHA read error keeps a readable Thread network and greys the Zigbee entry with its reason", async () => {
  const result = await readNetwork(fakeHass({ zhaError: "home_assistant_error" }));
  assert.equal(result.phase, "ready");
  assert.equal(result.network.source, "thread");
  assert.deepEqual(result.reads.zha, { status: "error", network: null, raw: null, message: "ZHA did not answer" });
  const choices = networkChoices(result);
  assert.deepEqual(choices[0], { key: "zha", available: false, reason: "error", message: "ZHA did not answer" });
  assert.equal(activeNetwork(choices, "zha"), "thread", "a greyed Zigbee is never shown");
  const t = translator("en");
  assert.equal(adapterByKey("zha").reasonText(choices[0], t), "ZHA's devices could not be read (ZHA did not answer)");
  const lost = await readNetwork(fakeHass({ zhaError: 3 }));
  assert.equal(lost.phase, "disconnected", "a lost connection still fails the whole read");
});

test("not_supported and an older Home Assistant (unknown_command) say so; other errors carry the message", async () => {
  assert.equal((await readThread(fakeHass({ topologyError: "not_supported" }))).status, "not_supported");
  assert.equal((await readThread(fakeHass({ topologyError: "unknown_command" }))).status, "not_supported");
  const err = await readThread(fakeHass({ topologyError: "home_assistant_error" }));
  assert.equal(err.status, "error");
  assert.equal((await readThread(fakeHass({ matter: false }))).status, "not_set_up");
  assert.deepEqual(await readThread(fakeHass({ matter: "setup_retry" })), { status: "not_running", message: "setup_retry" });
  const hass = fakeHass();
  const failing = { ...hass, callWS: async (msg) => {
    if (msg.type === "config_entries/get" && msg.domain === "matter") throw { code: "home_assistant_error", message: "entries" };
    return hass.callWS(msg);
  } };
  assert.deepEqual(await readThread(failing), { status: "error", message: "entries" }, "a failed read is no 'not loaded'");
  const zhaOnly = await readNetwork(fakeHass({ topologyError: "not_supported" }));
  assert.equal(zhaOnly.network.source, "zha");
  assert.equal(zhaOnly.networks.thread, null);
});

test("switch choices: one network is plain text, a greyed Thread entry names its reason; first load is Zigbee", () => {
  const zha = { id: "z" };
  assert.deepEqual(networkChoices({ networks: { zha, thread: null }, reads: { thread: { status: "not_set_up" } } }),
    [{ key: "zha", available: true }]);
  const both = networkChoices({ networks: { zha, thread }, reads: { thread: { status: "ok" } } });
  assert.deepEqual(both.map((c) => c.key), ["zha", "thread"]);
  assert.equal(activeNetwork(both, null), "zha");
  assert.equal(activeNetwork(both, "thread"), "thread");
  const greyed = networkChoices({ networks: { zha, thread: null }, reads: { thread: { status: "not_supported" } } });
  assert.deepEqual(greyed[1], { key: "thread", available: false, reason: "not_supported", message: null });
  assert.equal(activeNetwork(greyed, "thread"), "zha", "a greyed network is never shown");
  assert.equal(activeNetwork(networkChoices({ networks: { zha: null, thread }, reads: { thread: { status: "ok" } } }), "zha"), "thread");
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

test("status line for Thread: coverage, snapshot time with age, missing border routers", () => {
  const t = translator("en");
  const parts = threadParts(thread, { collected: { time: "14:14", age: "5 min ago" } });
  assert.deepEqual(parts.map(([k]) => k), ["status.source", "status.thread_links", "status.thread_read", "status.thread_tables_age"]);
  assert.equal(t(parts[1][0], parts[1][1]), "Links with both directions: 3/5");
  assert.equal(t(parts[2][0], parts[2][1]), "snapshot 14:14 (5 min ago)");
  const noBr = { ...thread, status: { ...thread.status, borderRouters: 0 } };
  assert.equal(threadParts(noBr, {}).at(-1)[0], "status.thread_no_br");
  assert.deepEqual(threadParts(thread, { compact: true }).map(([k]) => k), ["status.short_thread_links"]);
  assert.deepEqual(ageParts("2026-01-01T12:00:00Z", Date.parse("2026-01-01T12:07:30Z")), ["status.age_minutes", { n: 7 }]);
  assert.deepEqual(ageParts("2026-01-01T12:00:00Z", Date.parse("2026-01-01T15:00:00Z")), ["status.age_hours", { n: 3 }]);
});

test("#13: Thread status does not present collected_at as the read time of the tables", () => {
  const t = translator("en");
  const full = threadParts(thread, { collected: { time: "14:14", age: "5 min ago" } });
  const age = full.find(([k]) => k === "status.thread_tables_age");
  assert.equal(t(age[0], age[1]), "Thread tables: age unknown");
  assert.equal(age[2], "status.thread_read_note");
  assert.equal(threadParts(thread, { compact: true, collected: { time: "14:14", age: "5 min ago" } })
    .some(([k]) => k === "status.thread_tables_age"), false);
  assert.equal(threadParts(thread, {}).some(([k]) => k === "status.thread_tables_age"), false);
  const [key, params, note] = full.find(([k]) => k === "status.thread_read");
  assert.equal(key, "status.thread_read");
  assert.match(t(key, params), /^snapshot /);
  assert.doesNotMatch(t(key, params), /\bread\b/);
  const short = threadParts(thread, { compact: true, collected: { time: "14:14", age: "5 min ago" } })
    .find(([k]) => k === "status.short_thread_read");
  assert.equal(t(short[0], short[1]), "snapshot 14:14");
  assert.match(t(note), /many hours old/);
  assert.match(t(note), /read time is not reported/);
  assert.match(t("details.thread_note"), /hours old/);
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
  assert.equal(threadValue({ state: "unknown", reason: { code: "not_matter" } }), "?");
  assert.equal(laneValue({ state: "measured", scale: "thread-lqi", rssi: -36, lqi: 3 }, {}), "−36 dBm");
  assert.equal(threadReception({ state: "measured", rssi: -36, lqi: 3 }), "−36 dBm · LQI 3");
});

test("legend for Thread lists what its map draws, nothing about stages", () => {
  const ids = legendEntries({ foreground: "#000", muted: "#888" }).map((e) => e.id);
  assert.deepEqual(ids, ["parent", "neighbour", "route", "route-derived", "route-weak", "unused", "context", "not-listed",
    "no-table-thread", "rx-thread"]); // #11: the route rows
  const t = translator("en");
  for (const id of ids.slice(0, -1)) assert.notEqual(t(`legend.link.${id}`), `legend.link.${id}`);
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

test("merge: zigpy's route records are read for ZHA only; the scan's re-reads skip the Matter topology", async () => {
  const zigpy = "meshroute_topology_explorer/zigpy_routes";
  const both = fakeHass();
  await readNetwork(both);
  assert.equal(both.calls.filter((m) => m.type === zigpy).length, 1);
  const threadOnly = fakeHass({ zha: false });
  const only = await readNetwork(threadOnly);
  assert.equal(only.network.source, "thread");
  assert.equal(threadOnly.calls.filter((m) => m.type === zigpy).length, 0, "no zigpy call for Thread");
  const scan = fakeHass();
  const reread = await readNetwork(scan, { keys: ["zha"] });
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

test("a failed registry read keeps the panel working and is reported for the status line", async () => {
  const hass = fakeHass();
  const failing = { ...hass, callWS: async (msg) => {
    if (msg.type === "config/area_registry/list") throw { code: "home_assistant_error", message: "areas" };
    return hass.callWS(msg);
  } };
  const bad = await readNetwork(failing);
  assert.equal(bad.phase, "ready");
  assert.equal(bad.registriesFailed, true);
  assert.equal((await readNetwork(hass)).registriesFailed, false);
});
