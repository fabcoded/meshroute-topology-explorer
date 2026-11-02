// SPDX-License-Identifier: MIT
// Tests for the kind of a Thread device, derived from its Home Assistant entities (spec 3.2): the mapping, the helper
// entities that do not count, the priority, and unknown without hass.entities. Run: npm test
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { entitiesByDevice, threadKind } from "../custom_components/meshroute_topology_explorer/frontend/engines/thread/kinds.js";
import { buildThreadNetwork } from "../custom_components/meshroute_topology_explorer/frontend/engines/thread/model.js";
import { KINDS } from "../custom_components/meshroute_topology_explorer/frontend/graph/symbols.js";

const responses = JSON.parse(readFileSync(new URL("./fixtures/matter-sample.json", import.meta.url), "utf8")).responses;
const e = (domain, deviceClass = null) => ({ domain, deviceClass });

test("each domain maps to its picture, and every result is a known kind", () => {
  const cases = [[[e("light")], "light"], [[e("switch")], "outlet"], [[e("switch", "outlet")], "outlet"],
    [[e("switch", "switch")], "relay"], [[e("cover")], "blind"], [[e("lock")], "lock"], [[e("climate")], "thermostat"],
    [[e("binary_sensor", "motion")], "motion"], [[e("binary_sensor", "occupancy")], "motion"],
    [[e("binary_sensor", "presence")], "motion"], [[e("sensor", "temperature"), e("sensor", "humidity")], "temperature"],
    [[e("sensor", "temperature"), e("sensor", "battery")], "temperature"], [[e("sensor", "illuminance")], "sensor"],
    [[e("binary_sensor", "door")], "sensor"], [[e("sensor", "temperature"), e("sensor", "power")], "sensor"],
    [[e("event")], "button"], [[e("button")], "button"], [[], "unknown"], [[e("fan")], "unknown"]];
  for (const [entities, kind] of cases) {
    assert.equal(threadKind(entities), kind);
    assert.ok(KINDS.includes(kind));
  }
  assert.equal(threadKind(undefined), "unknown");
});

test("when several apply the priority decides", () => {
  assert.equal(threadKind([e("sensor", "temperature"), e("light"), e("switch")]), "light");
  assert.equal(threadKind([e("event"), e("binary_sensor", "motion"), e("sensor", "temperature")]), "motion");
  assert.equal(threadKind([e("lock"), e("cover")]), "blind");
  assert.equal(threadKind([e("event"), e("sensor", "illuminance")]), "sensor");
});

test("helper entities are left out: category, disabled, number, select, update, identify", () => {
  const entities = { "light.a": { entity_id: "light.a", device_id: "d", entity_category: "config" },
    "number.a": { entity_id: "number.a", device_id: "d" }, "select.a": { entity_id: "select.a", device_id: "d" },
    "update.a": { entity_id: "update.a", device_id: "d" }, "button.a_identify": { entity_id: "button.a_identify", device_id: "d" },
    "switch.a": { entity_id: "switch.a", device_id: "d", disabled_by: "integration" },
    "sensor.a": { entity_id: "sensor.a", device_id: "d", entity_category: "diagnostic" } };
  assert.equal(threadKind(entitiesByDevice(entities, {}).get("d")), "unknown");
  entities["event.a"] = { entity_id: "event.a", device_id: "d" };
  assert.equal(threadKind(entitiesByDevice(entities, {}).get("d")), "button");
});

test("the sample's devices get their pictures through the engine; without hass.entities they stay unknown", () => {
  const topology = responses["matter/network_topology"];
  const entities = Object.fromEntries(responses["config/entity_registry/list"].map((x) => [x.entity_id, x]));
  const states = Object.fromEntries(responses["get_states"].map((x) => [x.entity_id, x]));
  const kinds = (net) => Object.fromEntries(net.devices.map((d) => [d.nodeKey.startsWith("br_") ? "br" : d.nodeKey, d.kind]));
  assert.deepEqual(kinds(buildThreadNetwork(topology, { entities, states })),
    { 14: "light", 15: "outlet", 16: "temperature", 18: "sensor", br: "hub" });
  assert.deepEqual(kinds(buildThreadNetwork(topology)),
    { 14: "unknown", 15: "unknown", 16: "unknown", 18: "unknown", br: "hub" });
});

test("the adapter hands hass.entities and hass.states to the engine", async () => {
  const { readSource } = await import("../custom_components/meshroute_topology_explorer/frontend/adapters/matter.js");
  const callWS = async (msg) => msg.type === "config_entries/get" ? [{ domain: "matter", state: "loaded" }]
    : responses["matter/network_topology"];
  const entities = Object.fromEntries(responses["config/entity_registry/list"].map((x) => [x.entity_id, x]));
  const read = await readSource({ callWS, entities, states: {} }, { registries: async () => ({}) });
  assert.equal(read.network.devices.find((d) => d.nodeKey === "14").kind, "light");
  const old = await readSource({ callWS }, { registries: async () => ({}) });
  assert.equal(old.network.devices.find((d) => d.nodeKey === "14").kind, "unknown");
});
