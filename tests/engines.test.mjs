// SPDX-License-Identifier: MIT
// The viewer engines (engines/index.js): both engines offer the same hooks and nothing more (no hook without a caller
// in both), engineFor finds a network's engine and never falls back, the builds stamp engine and capabilities, and
// each facade gives exactly what the module it wraps gives (parity while the cut moves code).
// node --test tests/
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ENGINES, engineFor } from "../custom_components/meshroute_topology_explorer/frontend/engines/index.js";
import { buildNetwork, ZHA_CAPABILITIES } from "../custom_components/meshroute_topology_explorer/frontend/model/index.js";
import { buildThreadNetwork, THREAD_CAPABILITIES } from "../custom_components/meshroute_topology_explorer/frontend/model/thread.js";
import { legendEntries, unknownGlyph } from "../custom_components/meshroute_topology_explorer/frontend/graph/links.js";
import { laneValue } from "../custom_components/meshroute_topology_explorer/frontend/graph/renderer.js";
import { resolveTheme } from "../custom_components/meshroute_topology_explorer/frontend/graph/palette.js";

const load = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8")).responses;
const zha = load("zha-sample.json");
const topology = load("matter-sample.json")["matter/network_topology"];
const registries = { deviceRegistry: zha["config/device_registry/list"], areaRegistry: zha["config/area_registry/list"],
  configEntries: zha["config_entries/get"] };
const { zigbee, thread } = ENGINES;
const zigbeeNet = zigbee.build(zha["zha/devices"], registries);
const threadNet = thread.build(topology, {});
const TEXTS = { uncertain: "0 (uncertain)", parent: "Parent", route: "Route", rx: "RX:", pathUnknown: "?" };

/** The interface of every engine, as it stands after the steps landed so far (engines cut, section 2). */
const HOOKS = { key: "string", build: "function", laneValue: "function", unknownGlyph: "function", legend: "function" };

test("interface: both engines offer exactly the same hooks, frozen, under their own key", () => {
  assert.deepEqual(Object.keys(ENGINES), ["zigbee", "thread"]);
  for (const [key, engine] of Object.entries(ENGINES)) {
    assert.ok(Object.isFrozen(engine), key);
    assert.equal(engine.key, key);
    assert.deepEqual(Object.keys(engine).sort(), Object.keys(HOOKS).sort(), `${key}: no missing and no extra hook`);
    for (const [hook, type] of Object.entries(HOOKS)) assert.equal(typeof engine[hook], type, `${key}.${hook}`);
  }
});

test("the builds stamp the engine and the source's capabilities (spec 4.6)", () => {
  assert.equal(zigbeeNet.engine, "zigbee");
  assert.equal(zigbeeNet.source, "zha");
  assert.equal(zigbeeNet.capabilities, ZHA_CAPABILITIES);
  assert.equal(threadNet.engine, "thread");
  assert.equal(threadNet.capabilities, THREAD_CAPABILITIES);
  for (const caps of [ZHA_CAPABILITIES, THREAD_CAPABILITIES]) assert.ok(Object.isFrozen(caps));
  assert.deepEqual(Object.keys(ZHA_CAPABILITIES).sort(), Object.keys(THREAD_CAPABILITIES).sort(), "the same keys, each said");
  assert.deepEqual([ZHA_CAPABILITIES.routes, ZHA_CAPABILITIES.scan, ZHA_CAPABILITIES.observations], [true, true, true]);
  assert.deepEqual([THREAD_CAPABILITIES.routes, THREAD_CAPABILITIES.scan, THREAD_CAPABILITIES.observations,
    THREAD_CAPABILITIES.devicePage], [false, false, false, false]);
  const own = { ...ZHA_CAPABILITIES, routes: false };
  assert.equal(buildNetwork(zha["zha/devices"], { capabilities: own }).capabilities, own, "an adapter may pass its own");
});

test("engineFor finds the engine of each network and never falls back", () => {
  assert.equal(engineFor(zigbeeNet), zigbee);
  assert.equal(engineFor(threadNet), thread);
  assert.throws(() => engineFor({ ...zigbeeNet, engine: "zwave" }), /no viewer engine for network type "zwave"/);
  assert.throws(() => engineFor({ ...zigbeeNet, engine: "toString" }), /no viewer engine/, "only own keys");
  assert.throws(() => engineFor({ ...threadNet, capabilities: null }), /declares no capabilities/);
  assert.throws(() => engineFor(null), /no viewer engine for network type null/);
});

test("facades: build gives what the models build", () => {
  assert.deepEqual(zigbee.build(zha["zha/devices"], registries), buildNetwork(zha["zha/devices"], registries));
  assert.deepEqual(thread.build(topology, {}), buildThreadNetwork(topology, {}));
  assert.equal(thread.build({ nodes: [] }, {}), null);
});

test("facades: lane values and glyphs equal the renderer's and the links' for every direction of both samples", () => {
  for (const [engine, net] of [[zigbee, zigbeeNet], [thread, threadNet]]) {
    const dirs = net.pairs.flatMap((p) => [p.ab, p.ba]);
    assert.ok(dirs.length >= 10, `${engine.key}: ${dirs.length} directions`);
    for (const dir of dirs) {
      assert.equal(engine.laneValue(dir, TEXTS), laneValue(dir, TEXTS));
      assert.equal(engine.unknownGlyph(dir.reason), unknownGlyph(dir.reason));
    }
  }
});

test("facades: legend rows equal legendEntries with and without routes, in every view", () => {
  const theme = resolveTheme({});
  for (const debug of [false, true]) for (const heard of [false, true]) for (const colored of [false, true]) {
    const view = { debug, heard, colored };
    assert.deepEqual(zigbee.legend(theme, view), legendEntries(theme, { ...view, routes: true }));
    assert.deepEqual(thread.legend(theme, view), legendEntries(theme, { ...view, routes: false }));
  }
});
