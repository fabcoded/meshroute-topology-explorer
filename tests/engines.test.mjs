// SPDX-License-Identifier: MIT
// The viewer engines (engines/index.js): both engines offer the same hooks and nothing more (no hook without a caller
// in both), engineFor finds a network's engine and never falls back, the builds stamp engine and capabilities, and
// each facade gives exactly what the module it wraps gives (parity while the cut moves code).
// npm test
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ENGINES, engineFor } from "../custom_components/meshroute_topology_explorer/frontend/engines/index.js";
import { buildNetwork } from "../custom_components/meshroute_topology_explorer/frontend/engines/zigbee/model.js";
import { ZHA_CAPABILITIES } from "../custom_components/meshroute_topology_explorer/frontend/engines/zigbee/from-zha.js";
import { buildThreadNetwork } from "../custom_components/meshroute_topology_explorer/frontend/engines/thread/model.js";
import { THREAD_CAPABILITIES } from "../custom_components/meshroute_topology_explorer/frontend/engines/thread/from-matter.js";
import * as zigbeeLanes from "../custom_components/meshroute_topology_explorer/frontend/engines/zigbee/lanes.js";
import * as threadLanes from "../custom_components/meshroute_topology_explorer/frontend/engines/thread/lanes.js";
import { resolveTheme } from "../custom_components/meshroute_topology_explorer/frontend/graph/palette.js";
import { translator } from "../custom_components/meshroute_topology_explorer/frontend/ui/i18n.js";
import { sampleNetwork } from "./panel-fixture.mjs";

const load = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8")).responses;
const zha = load("zha-sample.json");
const topology = load("matter-sample.json")["matter/network_topology"];
const registries = { deviceRegistry: zha["config/device_registry/list"], areaRegistry: zha["config/area_registry/list"],
  configEntries: zha["config_entries/get"] };
const { zigbee, thread } = ENGINES;
const zigbeeNet = zigbee.build(zha["zha/devices"], registries);
const threadNet = thread.build(topology, {});
const TEXTS = { uncertain: "0 (uncertain)", parent: "Parent", route: "Route", rx: "RX:", pathUnknown: "?" };

/** The interface of every engine. */
const HOOKS = { key: "string", build: "function", laneValue: "function", unknownGlyph: "function", legend: "function",
  status: "function", findings: "object", connection: "function", details: "function", options: "function",
  settings: "object", scene: "object", springQuality: "function", addresses: "function", texts: "object", history: "object" };

test("interface: both engines offer exactly the same hooks, frozen, under their own key", () => {
  assert.deepEqual(Object.keys(ENGINES), ["zigbee", "thread"]);
  for (const [key, engine] of Object.entries(ENGINES)) {
    assert.ok(Object.isFrozen(engine), key);
    assert.equal(engine.key, key);
    assert.deepEqual(Object.keys(engine).sort(), Object.keys(HOOKS).sort(), `${key}: no missing and no extra hook`);
    for (const [hook, type] of Object.entries(HOOKS)) assert.equal(typeof engine[hook], type, `${key}.${hook}`);
    assert.deepEqual(Object.keys(engine.findings), ["kinds", "text"], `${key}.findings`);
    assert.deepEqual(Object.keys(engine.settings).sort(), ["defaults", "keys", "sanitize"], `${key}.settings`);
    assert.ok(Object.isFrozen(engine.settings) && Object.isFrozen(engine.settings.keys), `${key}.settings frozen`);
    assert.deepEqual(Object.keys(engine.settings.defaults), [...engine.settings.keys], `${key}: a default per key`);
    assert.deepEqual(Object.keys(engine.scene).sort(), ["anchors", "classes", "classify", "fit", "focus", "labelRank",
      "lanes", "overview", "viewKey"], `${key}.scene`);
    assert.ok(["base", "contain"].includes(engine.scene.fit), `${key}.scene.fit`);
    assert.ok(Object.isFrozen(engine.scene), `${key}.scene frozen`);
  }
});

test("finding kinds: Zigbee's order as the model lists them; Thread's three, in the same relative order", () => {
  assert.equal(zigbee.findings.kinds.length, 9);
  assert.deepEqual(thread.findings.kinds, ["offline", "parent offline", "parent unknown"]);
  const at = (k) => zigbee.findings.kinds.indexOf(k);
  assert.ok(thread.findings.kinds.every((k, i, all) => i === 0 || at(all[i - 1]) < at(k)), "same order as before");
  for (const f of threadNet.findings) assert.ok(thread.findings.kinds.includes(f.kind), f.kind);
});

test("settings: each engine sanitizes its own keys; the shell keeps the others verbatim", async () => {
  const { sanitizeSettings, DEFAULTS } = await import("../custom_components/meshroute_topology_explorer/frontend/ui/settings.js");
  assert.deepEqual(zigbee.settings.keys, ["paths", "heard", "returnRoutes", "sourceRoute"]);
  assert.deepEqual(thread.settings.keys, ["unusedRoutes"]); // #11
  for (const key of zigbee.settings.keys) assert.equal(key in DEFAULTS, false, `${key} is no shell key`);
  const stored = { paths: "bogus", heard: true, sourceRoute: "bogus", density: "spread", other: 1 };
  const z = sanitizeSettings(stored, zigbee.settings);
  assert.deepEqual([z.paths, z.heard, z.returnRoutes, z.sourceRoute, z.other],
    ["coordinator", true, false, "assume", 1]);
  const t = sanitizeSettings(stored, thread.settings);
  for (const key of ["paths", "heard", "sourceRoute", "other"]) assert.deepEqual(t[key], stored[key], key);
  assert.equal(t.density, "spread");
  assert.equal(t.unusedRoutes, false);
  assert.equal(sanitizeSettings({ ...stored, unusedRoutes: true }, thread.settings).unusedRoutes, true);
  assert.equal(sanitizeSettings({ ...stored, unusedRoutes: "yes" }, thread.settings).unusedRoutes, false);
  const { unusedRoutes, ...shellOnly } = t;
  assert.equal(unusedRoutes, false);
  assert.deepEqual(sanitizeSettings(stored), shellOnly, "no engine: shell keys only, Thread's without its own key");
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

test("facades: lane values and glyphs are the engine's own lanes module's for every direction of both samples", () => {
  for (const [engine, net, lanes] of [[zigbee, zigbeeNet, zigbeeLanes], [thread, threadNet, threadLanes]]) {
    const dirs = net.pairs.flatMap((p) => [p.ab, p.ba]);
    assert.ok(dirs.length >= 10, `${engine.key}: ${dirs.length} directions`);
    for (const dir of dirs) {
      assert.equal(engine.laneValue(dir, TEXTS), lanes.laneValue(dir, TEXTS));
    }
  }
});

test("facades: legend rows are the engine's own legendEntries, in every view; Thread's ignore the view", () => {
  const theme = resolveTheme({});
  for (const debug of [false, true]) for (const heard of [false, true]) for (const colored of [false, true]) {
    const view = { debug, heard, colored };
    assert.deepEqual(zigbee.legend(theme, view), zigbeeLanes.legendEntries(theme, view));
    assert.deepEqual(thread.legend(theme, view), threadLanes.legendEntries(theme));
  }
});

test("status: Zigbee gives tables, the source-route stage on the right and the banner below 90 %; Thread neither", () => {
  const settings = { sourceRoute: "assume", paths: "coordinator" };
  const full = zigbee.status(zigbeeNet, { settings });
  assert.deepEqual(full.parts.map(([k]) => k), ["status.source", "status.tables"]);
  assert.deepEqual(full.right, ["status.sr_assumed", { count: 8 }], "8 assumed return paths on the sample (spec 12)");
  assert.equal(full.incomplete, null);
  assert.equal(zigbee.status(zigbeeNet, {}).right, null, "no settings, no stage");
  assert.equal(zigbee.status(zigbeeNet, { settings: { ...settings, paths: "table" } }).right, null, "not in the routing table");
  const thin = sampleNetwork("coordinator-only");
  assert.deepEqual(zigbee.status(thin, {}).incomplete, { x: thin.status.routersWithTable, y: thin.status.routersAvailable });
  const t = thread.status(threadNet, { settings, compact: false });
  assert.deepEqual([t.right, t.incomplete], [null, null]);
  assert.deepEqual(t.parts.map(([k]) => k), ["status.source", "status.thread_links"]);
});

test("findings and connections speak each network's words", () => {
  const t = translator("en");
  const name = (id) => id;
  const parentUnknown = { kind: "parent unknown", device: "x", evidence: { verdict: "no parent link" }, missing: [] };
  assert.deepEqual(thread.findings.text(parentUnknown, t, name),
    { title: t("kind.parent unknown"), lines: [t("evidence.thread_no_parent")] });
  assert.notDeepEqual(zigbee.findings.text(parentUnknown, t, name).lines, [t("evidence.thread_no_parent")],
    "the Thread verdict is no longer a Zigbee branch");
  const child = threadNet.devices.find((d) => d.role === "end device" && d.parent);
  const parent = threadNet.devices.find((d) => d.id === child.parent);
  assert.deepEqual(thread.connection(threadNet, child), { kind: "via", label: parent.label });
  assert.equal(thread.connection(threadNet, parent), null);
  const coordinator = zigbeeNet.devices.find((d) => d.role === "coordinator");
  assert.deepEqual(zigbee.connection(zigbeeNet, coordinator), { kind: "network" });
});

test("options: Zigbee offers its three groups as data, Thread one line and no control", () => {
  const settings = { paths: "table", heard: false, returnRoutes: true, sourceRoute: "assume" };
  const groups = zigbee.options(zigbeeNet, settings);
  assert.deepEqual(groups.map((g) => [g.id, g.after || null]), [["paths", null], ["display", null], ["sourceRoute", "click"]]);
  const returns = groups[0].controls[0].options.find((o) => o.value === "table").children[0];
  assert.deepEqual([returns.key, returns.disabled], ["returnRoutes", false], "enabled under the routing table");
  assert.equal(zigbee.options(zigbeeNet, { ...settings, paths: "all" })[0].controls[0].options[1].children[0].disabled, true);
  // The heard checkbox sits under the routing table too, after the return routes, enabled there and greyed elsewhere.
  const tableChildren = groups[0].controls[0].options.find((o) => o.value === "table").children;
  assert.deepEqual(tableChildren.map((c) => [c.key, c.sub, c.disabled]), [["returnRoutes", true, false], ["heard", true, false]]);
  assert.equal(groups[0].controls.length, 1, "no checkbox of its own beside the radios");
  for (const paths of ["coordinator", "all"]) {
    const kids = zigbee.options(zigbeeNet, { ...settings, paths })[0].controls[0].options[1].children;
    assert.deepEqual(kids.map((c) => c.disabled), [true, true], `${paths}: both sub-options greyed`);
  }
  const t = translator("en");
  const threadGroups = thread.options(threadNet, settings);
  assert.deepEqual(threadGroups.map((g) => [g.legend, g.controls.length]), [[null, 0]]);
  assert.notEqual(t(threadGroups[0].note), threadGroups[0].note, "the note has words");
});

test("texts: engines and adapters bring their own tables; merging refuses two different texts for one key", async () => {
  const { STRINGS, SHARED, mergeTexts } = await import("../custom_components/meshroute_topology_explorer/frontend/ui/i18n.js");
  for (const engine of Object.values(ENGINES)) {
    assert.ok(Object.isFrozen(engine.texts) && Object.keys(engine.texts).length > 0, engine.key);
    for (const key of Object.keys(engine.texts)) assert.equal(STRINGS[key], engine.texts[key], key);
    for (const key of Object.keys(engine.texts)) assert.equal(key in SHARED, false, `${engine.key}: ${key} also shared`);
  }
  assert.throws(() => mergeTexts([{ a: "x" }, { a: "y" }]), /differs/);
  assert.deepEqual(mergeTexts([{ a: "x" }, { a: "x" }]), { a: "x" });
});
