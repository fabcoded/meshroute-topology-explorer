// SPDX-License-Identifier: MIT
// The cluster popup's logic (spec 9.2): values Home Assistant already knows
// as entity states, the user-started attribute read (success, no value, timeout, error, closing the dialog), and the
// ways into Home Assistant's own pages. node --test "tests/**/*.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import { knownValue, valueText, VALUE_MAP } from "../custom_components/meshroute_topology_explorer/frontend/engines/zigbee/ui/entity-values.js";
import { readAttributes, READ_TIMEOUT_MS } from "../custom_components/meshroute_topology_explorer/frontend/engines/zigbee/ui/attribute-read.js";
import { deviceLinks, devicePagePath, logbookPath, historyPath, entitiesPath, areaPath }
  from "../custom_components/meshroute_topology_explorer/frontend/ui/ha-links.js";
import { adapterByKey } from "../custom_components/meshroute_topology_explorer/frontend/adapters/index.js";
import { zhaDevicePath } from "../custom_components/meshroute_topology_explorer/frontend/adapters/zha.js";

/** The source page a network's adapter gives where the capability says the source has one (as the Zigbee Details do). */
const pageOf = (device, capabilities, key) => (capabilities && capabilities.devicePage ? adapterByKey(key).devicePage(device, "signature") : null);
import { translator } from "../custom_components/meshroute_topology_explorer/frontend/ui/i18n.js";
import { ZHA_CAPABILITIES } from "../custom_components/meshroute_topology_explorer/frontend/engines/zigbee/model.js";
import { THREAD_CAPABILITIES } from "../custom_components/meshroute_topology_explorer/frontend/engines/thread/model.js";

const st = (state, attributes = {}) => ({ state, attributes });

test("known values: the one obvious entity's state, else nothing", () => {
  const ids = ["light.lamp", "sensor.lamp_power", "update.lamp_fw"];
  const states = { "light.lamp": st("on", { brightness: 180, color_temp_kelvin: 2700 }),
    "sensor.lamp_power": st("4.2", { device_class: "power", unit_of_measurement: "W" }), "update.lamp_fw": st("off") };
  assert.deepEqual(knownValue(0x0006, 0x0000, "in", ids, states), { entityId: "light.lamp", kind: "onoff", value: true, unit: null });
  assert.deepEqual(knownValue(0x0008, 0x0000, "in", ids, states),
    { entityId: "light.lamp", kind: "number", value: 180, unit: null, from: "brightness" });
  assert.equal(knownValue(0x0300, 0x0007, "in", ids, states).value, 2700);
  assert.deepEqual(knownValue(0x0b04, 0x050b, "in", ids, states), { entityId: "sensor.lamp_power", kind: "number", value: "4.2", unit: "W" });
  const t = translator("en");
  assert.equal(valueText(knownValue(0x0006, 0x0000, "in", ids, states), t), "on");
  assert.equal(valueText(knownValue(0x0300, 0x0007, "in", ids, states), t), "2700 K");
  assert.equal(valueText(knownValue(0x0b04, 0x050b, "in", ids, states), t), "4.2 W");
  // Not obvious, or no value: nothing.
  assert.equal(knownValue(0x0006, 0x4003, "in", ids, states), null, "no entity carries StartUpOnOff");
  assert.equal(knownValue(0x0006, 0x0000, "out", ids, states), null, "an output cluster's attributes live elsewhere");
  const two = { ...states, "light.lamp_2": st("off") };
  assert.equal(knownValue(0x0006, 0x0000, "in", [...ids, "light.lamp_2"], two), null, "two lamps: which endpoint is which?");
  assert.equal(knownValue(0x0006, 0x0000, "in", ids, { ...states, "light.lamp": st("unavailable") }), null);
  assert.equal(knownValue(0x0008, 0x0000, "in", ids, { ...states, "light.lamp": st("off", { brightness: null }) }), null);
  assert.equal(knownValue(0x0402, 0x0000, "in", ["sensor.x"], { "sensor.x": st("21.5", { device_class: "humidity" }) }), null,
    "the device class must match");
  assert.deepEqual(knownValue(0x0402, 0x0000, "in", ["sensor.x"], { "sensor.x": st("21.5", { device_class: "temperature",
    unit_of_measurement: "°C" }) }), { entityId: "sensor.x", kind: "number", value: "21.5", unit: "°C" });
  assert.equal(knownValue(0x0006, 0x0000, "in", ids, null), null, "no states at all");
  assert.ok(VALUE_MAP.every((r) => r.domains.length), "every rule names its domains");
});

/** A clock that only moves when told: setTimeout callbacks run on tick(). */
function manualTimers() {
  let next = 1;
  const pending = new Map();
  return {
    setTimeout: (fn) => { pending.set(next, fn); return next++; },
    clearTimeout: (id) => pending.delete(id),
    fireAll: () => { const fns = [...pending.values()]; pending.clear(); for (const fn of fns) fn(); },
    get count() { return pending.size; },
  };
}

test("the read: one message per attribute, in order, with ZHA's exact shape; values and 'None'", async () => {
  const sent = [];
  const answers = { 0: "Bool.true", 0x4000: "None", 0x4001: 0 };
  const callWS = async (msg) => { sent.push(msg); return answers[msg.attribute]; };
  const seen = [];
  const results = await readAttributes({ callWS, ieee: "aa:bb:cc:dd:00:00:00:08", endpoint: 1, cluster: 6, direction: "in",
    attributes: [0, 0x4000, 0x4001], timers: manualTimers(), onResult: (r) => seen.push(r.id) });
  assert.deepEqual(sent[0], { type: "zha/devices/clusters/attributes/value", ieee: "aa:bb:cc:dd:00:00:00:08", endpoint_id: 1,
    cluster_id: 6, cluster_type: "in", attribute: 0 });
  assert.deepEqual(sent.map((m) => m.attribute), [0, 0x4000, 0x4001]);
  assert.deepEqual(results.map((r) => [r.state, r.value]), [["ok", "Bool.true"], ["none", null], ["ok", "0"]]);
  assert.deepEqual(seen, [0, 0x4000, 0x4001]);
  assert.ok(sent.every((m) => Object.keys(m).length === 6), "no manufacturer code, nothing else");
  const out = [];
  await readAttributes({ callWS: async (m) => { out.push(m.cluster_type); return "1"; }, ieee: "x", endpoint: 1, cluster: 25,
    direction: "out", attributes: [2], timers: manualTimers() });
  assert.deepEqual(out, ["out"]);
  assert.equal(READ_TIMEOUT_MS, 15000);
});

test("the read stops at the first timeout or error; the rest is not sent", async () => {
  const timers = manualTimers();
  const sent = [];
  const never = (msg) => { sent.push(msg.attribute); return new Promise(() => {}); };
  const pending = readAttributes({ callWS: never, ieee: "x", endpoint: 1, cluster: 6, direction: "in", attributes: [0, 1, 2], timers });
  await new Promise((r) => setImmediate(r));
  assert.equal(timers.count, 1, "one timeout armed");
  timers.fireAll();
  const results = await pending;
  assert.deepEqual(results.map((r) => r.state), ["timeout", "skipped", "skipped"]);
  assert.deepEqual(sent, [0], "nothing more goes out after a timeout");
  const failing = async () => { throw { code: "home_assistant_error", message: "Failed to deliver" }; };
  const err = await readAttributes({ callWS: failing, ieee: "x", endpoint: 1, cluster: 6, direction: "in", attributes: [0, 1], timers: manualTimers() });
  assert.deepEqual(err.map((r) => r.state), ["error", "skipped"]);
  assert.equal(err[0].message, "Failed to deliver");
  // Closing the dialog: nothing is sent after it, and no result is reported.
  let closed = false;
  const calls = [];
  const res = await readAttributes({ callWS: async (m) => { calls.push(m.attribute); closed = true; return "1"; }, ieee: "x",
    endpoint: 1, cluster: 6, direction: "in", attributes: [0, 1, 2], timers: manualTimers(), cancelled: () => closed });
  assert.deepEqual(calls, [0]);
  assert.deepEqual(res, []);
});

test("ways into Home Assistant: device page, ZHA's Zigbee info, area, logbook, history, entity list", () => {
  const device = { id: "aa:bb:cc:dd:00:00:00:08", registryId: "device0123", areaId: "area_03",
    entities: ["light.router_03_2", "sensor.router_03_1"] };
  assert.deepEqual(deviceLinks(device, pageOf(device, ZHA_CAPABILITIES, "zha")).map((l) => l.key), ["device", "zha", "area", "logbook", "history", "entities"]);
  assert.equal(devicePagePath("device0123"), "/config/devices/device/device0123");
  assert.equal(zhaDevicePath(device.id), "/config/zha/device/aa:bb:cc:dd:00:00:00:08/signature", "colons as the frontend writes them");
  assert.equal(zhaDevicePath(device.id, "clusters"), "/config/zha/device/aa:bb:cc:dd:00:00:00:08/clusters");
  assert.equal(areaPath("area_03"), "/config/areas/area/area_03");
  assert.equal(logbookPath(device.entities), "/logbook?entity_id=light.router_03_2%2Csensor.router_03_1");
  assert.deepEqual(new URLSearchParams(historyPath(device.entities).split("?")[1]).get("entity_id").split(","), device.entities);
  assert.equal(entitiesPath("device0123"), "/config/entities?device=device0123");
  // Unknown targets are left out; a source without its own device page (capability devicePage) gets no ZHA link.
  assert.deepEqual(deviceLinks({ id: device.id, registryId: null, areaId: null, entities: [] }, pageOf(device, ZHA_CAPABILITIES, "zha")).map((l) => l.key), ["zha"]);
  assert.deepEqual(deviceLinks(device, pageOf(device, THREAD_CAPABILITIES, "thread")).map((l) => l.key), ["device", "area", "logbook", "history", "entities"]);
  assert.deepEqual(deviceLinks(device).map((l) => l.key), ["device", "area", "logbook", "history", "entities"], "no default source");
});
