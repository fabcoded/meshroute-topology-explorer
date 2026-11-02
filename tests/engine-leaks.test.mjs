// SPDX-License-Identifier: MIT
// Leak tests of the viewer engines (engines-cut proposal of 2026-11-01, section 5): one engine per network type, and
// nothing of one network's meaning leaks into the other's view or into the shared code. Each test is written against
// the target interface; a test whose step has not landed yet carries `todo` with that step, runs, and does not fail
// the suite. A step that makes a test true removes its `todo`.
// node --test tests/
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";

const FRONTEND = new URL("../custom_components/meshroute_topology_explorer/frontend/", import.meta.url);
const mod = (path) => import(new URL(path, FRONTEND));
const load = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8")).responses;
const zhaResponses = load("zha-sample.json");
const topology = load("matter-sample.json")["matter/network_topology"];

/** The engines and both sample networks, built through the engines' own `build`. */
async function engines() {
  const { ENGINES, engineFor } = await mod("engines/index.js");
  const { zigbee, thread } = ENGINES;
  const registries = { deviceRegistry: zhaResponses["config/device_registry/list"],
    areaRegistry: zhaResponses["config/area_registry/list"], configEntries: zhaResponses["config_entries/get"] };
  const zigbeeNet = zigbee.build(zhaResponses["zha/devices"], registries);
  const threadNet = thread.build(topology, {});
  return { ENGINES, engineFor, zigbee, thread, zigbeeNet, threadNet };
}

// A minimal fake DOM for the View tab (the same idea as tests/panel-view-tab.test.mjs).
class FakeNode {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.listeners = {}; this.style = {};
    this.className = ""; this.classList = { add: (c) => { this.className = `${this.className} ${c}`.trim(); } }; }
  append(...kids) { this.children.push(...kids); }
  replaceChildren(...kids) { this.children = kids; }
  setAttribute(k, v) { this.attrs[k] = v; }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  walk(out = []) { out.push(this); for (const c of this.children) if (c instanceof FakeNode) c.walk(out); return out; }
}
globalThis.Node = FakeNode;
globalThis.document = { createElement: (tag) => new FakeNode(tag), createElementNS: (ns, tag) => new FakeNode(tag),
  createTextNode: (text) => ({ text }) };

/** Render the View tab with the groups an engine offers; returns every node. */
async function renderViewTab(groups, extra = {}) {
  const { renderView } = await mod("ui/view-tab.js");
  const { sanitizeSettings } = await mod("ui/settings.js");
  const { translator } = await mod("ui/i18n.js");
  const container = new FakeNode("div");
  renderView(container, { t: translator("en"), settings: sanitizeSettings({}), groups, openOnSelect: false, dark: false,
    debug: false, pinCount: 0, scan: null, client: { mode: "stored" }, idPrefix: "v", info: {}, onChange() {},
    onOpenDetails() {}, onDebug() {}, onReload() {}, onReleaseAll() {}, onScan() {}, onScanStop() {}, onInfo() {},
    ...extra });
  return container.walk();
}

/** Every settings key the controls of an engine's option groups write, sub-options included. */
function optionKeys(groups) {
  const keys = [];
  const walk = (c) => {
    if (c.key) keys.push(c.key);
    for (const o of c.options || []) for (const child of o.children || []) walk(child);
  };
  for (const g of groups) for (const c of g.controls || []) walk(c);
  return keys;
}

/** Every .js file under a frontend folder, as paths relative to the frontend. */
function jsFiles(folder) {
  const root = new URL(folder, FRONTEND);
  if (!existsSync(root)) return [];
  const out = [];
  for (const name of readdirSync(root)) {
    const rel = `${folder}${name}`;
    if (statSync(new URL(rel, FRONTEND)).isDirectory()) out.push(...jsFiles(`${rel}/`));
    else if (name.endsWith(".js")) out.push(rel);
  }
  return out;
}

/** Module specifiers a file imports (static `from "…"` and dynamic `import("…")`), resolved against the frontend. */
function importsOf(rel) {
  const src = readFileSync(new URL(rel, FRONTEND), "utf8");
  const specs = [...src.matchAll(/(?:from\s+|import\s*\(\s*)"([^"]+)"/g)].map((m) => m[1]);
  return specs.map((s) => new URL(s, new URL(rel, FRONTEND)).href.slice(FRONTEND.href.length));
}

/** The shared code (engines cut, section 3): the panel, the shared parsers, the graph, the adapters and the ui/ frames.
 *  The network-specific modules have all moved into their engine (step 8). */
const sharedFiles = () => ["panel.js", "model/parse.js", ...jsFiles("graph/"), ...jsFiles("adapters/"), ...jsFiles("ui/")];

// Zigbee ids of the legend (graph/links.js legendEntries) that must never show on a Thread map.
const ZIGBEE_LEGEND = ["coordinator", "assumed", "route", "discovery", "heard", "up-path", "no-table", "path-end"];

test("1: the Thread View tab has no Zigbee options (owner decision 2026-11-01: hidden, not greyed)", async () => {
    const { zigbee, thread, zigbeeNet, threadNet } = await engines();
    const { sanitizeSettings } = await mod("ui/settings.js");
    const s = sanitizeSettings({}, zigbee.settings);
    const zigbeeKeys = new Set(optionKeys(zigbee.options(zigbeeNet, s)));
    assert.ok(zigbeeKeys.has("paths") && zigbeeKeys.has("sourceRoute"), "the Zigbee groups are data");
    assert.deepEqual(optionKeys(thread.options(threadNet, s)).filter((k) => zigbeeKeys.has(k)), []);
    const inputs = (await renderViewTab(thread.options(threadNet, s))).filter((n) => n.tag === "input");
    const zigbeeInput = (n) => /-(paths|sourceRoute|heard|pathMode|color-)/.test(`${n.name || ""} ${n.attrs.id || ""}`);
    assert.deepEqual(inputs.filter(zigbeeInput).map((n) => n.name || n.attrs.id), []);
  });

test("2: the Thread legend has no Zigbee rows and no stage or option notes", async () => {
  const { thread } = await engines();
  const { resolveTheme } = await mod("graph/palette.js");
  const theme = resolveTheme({});
  for (const view of [{}, { debug: true, heard: true, colored: true }]) {
    const rows = thread.legend(theme, view);
    assert.ok(rows.length > 0);
    assert.deepEqual(rows.map((r) => r.id).filter((id) => ZIGBEE_LEGEND.includes(id)), []);
    assert.deepEqual(rows.filter((r) => r.stage !== undefined || r.option !== undefined), []);
  }
});

test("3: unknown Thread values stay unknown (never a Zigbee default)", async () => {
  const { thread } = await engines();
  const pan = "00112233aabbcc01";
  const net = thread.build({ nodes: [
    { id: "1", network_type: "thread", ext_pan_id: pan, ext_address: "AABBCCDD00000001" },
    { id: "2", network_type: "thread", ext_pan_id: pan, ext_address: "AABBCCDD00000002", kind: "matter", role: "router",
      available: true },
  ], connections: [{ source: "2", target: "1", network: "thread", source_to_target: { strength: "unknown" },
    target_to_source: { strength: "unknown" } }] }, {});
  const d = net.devices.find((x) => x.nodeKey === "1");
  assert.equal(d.role, "unknown");
  for (const key of ["sleepy", "powerSource", "battery", "relayLoad", "rating"]) assert.equal(d[key], null, key);
  assert.equal("hasTable" in d, false);
  assert.equal("tableFull" in d, false);
  // No Zigbee network address (the RLOC16 is its own field) and no router-table counts in the status.
  for (const x of net.devices) for (const key of ["nwk", "tableSize", "tableCapacity", "tableCapacitySource"]) {
    assert.equal(key in x, false, key);
  }
  for (const key of ["routersWithTable", "routersAvailable", "completeness"]) assert.equal(key in net.status, false, key);
  const about = [...net.readings, ...(net.staleReadings || [])].filter((r) => r.reporter === d.id || r.subject === d.id);
  for (const r of about) {
    assert.equal(r.measured, false);
    assert.equal(r.lqi, null);
    assert.equal(r.rssi, null);
  }
});

test("4a: there is no default engine: a network without a known engine or without capabilities throws", async () => {
  const { engineFor, zigbee, thread, zigbeeNet, threadNet } = await engines();
  assert.equal(engineFor(zigbeeNet), zigbee);
  assert.equal(engineFor(threadNet), thread);
  const caps = { routes: true };
  for (const bad of [null, undefined, {}, { capabilities: caps }, { engine: "zigbee" }, { engine: "zwave", capabilities: caps },
    { ...zigbeeNet, engine: undefined }, { ...threadNet, capabilities: undefined }]) {
    assert.throws(() => engineFor(bad), /engine|capabilit/i);
  }
});

test("4b: the panel shows its error state for a network without an engine", async () => {
  const { PanelController } = await mod("ui/controller.js");
  const stray = { id: "x", source: "zha", devices: [], capabilities: { routes: true } };
  const controller = new PanelController({ read: async () => ({ phase: "ready", network: stray, raw: [],
    networks: { zha: stray, thread: null }, reads: { thread: { status: "not_loaded" } } }) });
  controller.attach();
  controller.setHass({ user: { is_admin: true }, connected: true, connection: null, callWS: async () => [] });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await controller.reload();
  assert.equal(controller.state.phase, "error");
  assert.match(String(controller.state.message), /engine/i);
});

test("4c: nothing is ever treated as routes: true by default (no hasRoutes in the shell)", async () => {
    const links = await mod("graph/links.js");
    assert.equal("hasRoutes" in links, false);
    for (const rel of sharedFiles()) {
      assert.doesNotMatch(readFileSync(new URL(rel, FRONTEND), "utf8"), /hasRoutes|routes !== false/, rel);
    }
  });

test("5a: the engines do not import each other", async () => {
  const zigbeeFiles = jsFiles("engines/zigbee/");
  const threadFiles = jsFiles("engines/thread/");
  assert.ok(zigbeeFiles.length && threadFiles.length, "both engines exist");
  for (const rel of threadFiles) assert.deepEqual(importsOf(rel).filter((p) => p.startsWith("engines/zigbee/")), [], rel);
  for (const rel of zigbeeFiles) assert.deepEqual(importsOf(rel).filter((p) => p.startsWith("engines/thread/")), [], rel);
});

test("5b: shared code reaches the engines only through engines/index.js", async () => {
  for (const rel of sharedFiles()) {
    const inside = importsOf(rel).filter((p) => p.startsWith("engines/") && p !== "engines/index.js");
    assert.deepEqual(inside, [], rel);
  }
});

/** Source text without comments (line and block comments outside string literals; main session decision
 *  2026-11-01: leak test 6 counts identifiers and string literals, not comments). */
function withoutComments(src) {
  let out = "";
  let quote = null;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const next = src[i + 1];
    if (quote) {
      out += c;
      if (c === "\\") { out += next; i++; } else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { quote = c; out += c; continue; }
    if (c === "/" && next === "/") { while (i < src.length && src[i] !== "\n") i++; out += "\n"; continue; }
    if (c === "/" && next === "*") { i += 2; while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++; i++; continue; }
    out += c;
  }
  return out;
}

test("6: the shared code has no network words (identifiers and string literals, not comments)", () => {
  const tokens = [/\bzha\b/i, /\bzigpy\b/i, /\bthread\b/i, /\bmatter\b/i, /sourceRoute/, /PATH_STAGES/, /hasRoutes/,
    /nodePaths/, /theoretical/, /thread-lqi/, /\.source ===/, /routes === false/];
  const roles = /\b(coordinator|end device|border router)\b/;
  const shared = sharedFiles().filter((f) => f === "panel.js" || f.startsWith("graph/") || f.startsWith("ui/"));
  assert.ok(shared.length > 30, `${shared.length} shared files`);
  for (const rel of shared) {
    const src = withoutComments(readFileSync(new URL(rel, FRONTEND), "utf8"));
    for (const token of tokens) assert.doesNotMatch(src, token, rel);
    if (rel !== "graph/symbols.js" && rel !== "graph/palette.js") assert.doesNotMatch(src, roles, rel);
  }
  // The stripper keeps strings and drops comments.
  assert.equal(withoutComments('a = "x // y"; // zha\nb /* matter */ = 1;'), 'a = "x // y"; \nb  = 1;');
});

test("7: the Thread focus is the device's own lanes: no band, no ends", async () => {
  const { thread, threadNet } = await engines();
  const { buildScene } = await mod("graph/renderer.js");
  const scene = buildScene(threadNet, (s) => s.length * 6);
  thread.scene.classify(scene);
  for (let i = 0; i < scene.nodes.length; i++) {
    const focus = thread.scene.focus(scene, i, {});
    assert.equal(focus.band, null);
    assert.deepEqual(focus.ends, []);
    for (const hop of focus.hops) assert.ok(hop.s === i || hop.h === i, `hop ${hop.s}>${hop.h} of ${i}`);
    // Its own class names, never Zigbee's.
    for (const hop of focus.hops) assert.ok(["parent", "neighbour"].includes(hop.cls), hop.cls);
  }
  const drawn = thread.scene.overview(scene, {}).filter(Boolean).map((l) => l.cls);
  assert.ok(drawn.length > 0 && drawn.every((c) => ["parent", "neighbour"].includes(c)), drawn.join());
});

// A save writes the whole sanitized object (shell defaults included, tests/panel-settings.test.mjs); what matters
// here is that the Zigbee keys under a Thread id come back and go out exactly as stored (main session, 2026-11-01).
test("8: Thread settings are untouched: stored Zigbee keys come back verbatim and are never rewritten", async () => {
    const { thread, threadNet } = await engines();
    const { SettingsClient } = await mod("ui/settings.js");
    assert.deepEqual(thread.settings.keys, [], "Thread owns no settings keys");
    const zigbeeKeys = { paths: "heard", sourceRoute: "bogus", heard: "yes", returnRoutes: 7, links: { up: true },
      nodeView: "all" };
    const stored = new Map([[threadNet.id, { ...zigbeeKeys, density: "medium" }]]);
    const callWS = async (msg) => {
      if (msg.type.endsWith("/get")) return { settings: stored.get(msg.network) || null };
      stored.set(msg.network, msg.settings);
      return {};
    };
    const client = new SettingsClient({ callWS, network: threadNet.id, engineSettings: thread.settings,
      timers: { setTimeout: () => 0, clearTimeout() {} } });
    await client.load();
    for (const [key, value] of Object.entries(zigbeeKeys)) assert.deepEqual(client.settings[key], value, key);
    client.update({ density: "dense" });
    await client.flush();
    const saved = stored.get(threadNet.id);
    for (const [key, value] of Object.entries(zigbeeKeys)) assert.deepEqual(saved[key], value, key);
    assert.equal(saved.density, "dense");
  });

test("9: Thread findings use their own kinds only, even with link quality 1 on every link", async () => {
  const { thread } = await engines();
  const pan = "00112233aabbcc01";
  const node = (id, role, extra = {}) => ({ id: String(id), kind: "matter", network_type: "thread", node_id: id, role,
    available: true, ext_address: `AABBCCDD000000${String(id).padStart(2, "0")}`, ext_pan_id: pan, ...extra });
  const weak = { strength: "weak", lqi: 1, rssi: -95 };
  const net = thread.build({ nodes: [node(1, "leader"), node(2, "router"), node(3, "end_device"),
    node(4, "sleepy_end_device", { available: false }), node(5, "end_device")],
  connections: [[1, 2], [2, 3], [1, 4]].map(([a, b]) => ({ source: String(a), target: String(b), network: "thread",
    strength: "weak", source_to_target: weak, target_to_source: weak, path_cost: 1 })) }, {});
  const kinds = new Set(net.findings.map((f) => f.kind));
  assert.ok(kinds.size > 0, "the fixture raises findings");
  for (const kind of kinds) assert.ok(["offline", "parent offline", "parent unknown"].includes(kind), kind);
  for (const kind of ["very low reading", "weak reception", "data incomplete", "route to offline device"]) {
    assert.equal(kinds.has(kind), false, kind);
  }
});

test("10a: Thread values are never on the Zigbee scale", async () => {
  const { thread, threadNet } = await engines();
  const texts = { uncertain: "0 (uncertain)", parent: "Parent", route: "Route", rx: "RX:", pathUnknown: "?" };
  const dirs = threadNet.pairs.flatMap((p) => [p.ab, p.ba]);
  dirs.push({ state: "measured", scale: "thread-lqi", lqi: 0, rssi: null }, { state: "unknown", scale: "thread-lqi",
    lqi: 0, rssi: null, reason: "lqi 0" }, { state: "measured", scale: "thread-lqi", lqi: 3, rssi: null });
  for (const dir of dirs) {
    const value = thread.laneValue(dir, texts);
    assert.doesNotMatch(value, /^\d+$/, JSON.stringify(dir));
    assert.ok(!value.includes("(uncertain)"), JSON.stringify(dir));
  }
});

test("10b: the layout reads Thread link quality as a quality from 0 to 1, RSSI alone as none", async () => {
    const { thread } = await engines();
    assert.equal(thread.springQuality({ scale: "thread-lqi", lqi: 3, rssi: -60 }), 1);
    assert.equal(thread.springQuality({ scale: "thread-lqi", lqi: null, rssi: -60 }), null);
    // The layout knows no reading scale: the engine's quality is its only input.
    assert.doesNotMatch(readFileSync(new URL("graph/layout.js", FRONTEND), "utf8"), /thread-lqi|\.scale\b|\* 85\b/);
    const { threadNet } = await engines();
    const { Layout } = await mod("graph/layout.js");
    const layout = new Layout(threadNet, { quality: thread.springQuality });
    assert.ok(layout.springQuality.length > 0 && layout.springQuality.every((q) => q > 0 && q <= 1));
  });

test("11: the Thread status line has no Zigbee parts and no completeness banner", async () => {
  const { thread, threadNet } = await engines();
  for (const compact of [false, true]) {
    const status = thread.status(threadNet, { compact, collected: { time: "12:00", age: "now" } });
    const keys = status.parts.map(([key]) => key);
    assert.deepEqual(keys.filter((k) => /^status\.(short_)?(tables|sr_|unchanged|scan_)/.test(k)), [], keys.join());
    assert.equal(status.right, null);
    assert.equal(status.incomplete, null);
  }
});

test("12: Thread never offers the scan: no scan button in debug mode without capabilities.scan", async () => {
    const { thread, zigbee, zigbeeNet, threadNet } = await engines();
    const { sanitizeSettings } = await mod("ui/settings.js");
    const s = sanitizeSettings({}, zigbee.settings);
    const scanButton = (all) => all.some((n) => n.tag === "button" && n.attrs.id === "v-scan");
    assert.equal(threadNet.capabilities.scan, false);
    assert.equal(scanButton(await renderViewTab(thread.options(threadNet, s), { debug: true, routes: true,
      canScan: Boolean(threadNet.capabilities.scan) })), false);
    assert.equal(scanButton(await renderViewTab(zigbee.options(zigbeeNet, s), { debug: true, routes: false,
      canScan: Boolean(zigbeeNet.capabilities.scan) })), true);
  });

test("13: every text key of the Thread engine resolves without the Zigbee table", async () => {
  const { thread, threadNet } = await engines();
  const { SHARED, mergeTexts, translator } = await mod("ui/i18n.js");
  const { ENGINES } = await mod("engines/index.js");
  const { ADAPTERS } = await mod("adapters/index.js");
  const { linkLegendRows } = await mod("ui/link-legend.js");
  const { deviceRows, rowMeta } = await mod("ui/device-list.js");
  const { roleText } = await mod("ui/format.js");
  const { resolveTheme } = await mod("graph/palette.js");
  // The shared tables, the Thread engine's and the Matter adapter's: no Zigbee and no ZHA table.
  const matter = ADAPTERS.find((a) => a.key === "thread");
  const base = translator("en", null, mergeTexts([SHARED, thread.texts, matter.texts]));
  const used = new Set();
  const t = Object.assign((key, params) => { used.add(key); return base(key, params); }, base,
    { has: (key) => { used.add(key); return base.has(key); } });
  // A Thread network with every finding kind, a leader, routers, sleepy and awake end devices and a border router.
  const pan = "00112233aabbcc01";
  const node = (id, role, extra = {}) => ({ id: String(id), kind: "matter", network_type: "thread", node_id: id, role,
    available: true, rloc16: 0x400 * id, ext_address: `AABBCCDD000000${String(id).padStart(2, "0")}`, ext_pan_id: pan,
    ...extra });
  const weak = { lqi: 1, rssi: -90 };
  const net = thread.build({ nodes: [node(1, "leader"), node(2, "router", { available: false }), node(3, "end_device"),
    node(4, "sleepy_end_device"), node(5, "end_device"), node(6, null, { kind: "border_router", available: null })],
  connections: [[1, 2], [2, 3], [1, 4], [6, 1]].map(([a, b]) => ({ source: String(a), target: String(b), network: "thread",
    source_to_target: weak, target_to_source: weak })) }, {});
  const theme = resolveTheme({});
  for (const network of [threadNet, net]) {
    const name = (id) => (network.devices.find((d) => d.id === id) || { label: id }).label;
    for (const g of thread.options(network, {})) for (const key of [g.legend, g.note]) if (key) t(key);
    linkLegendRows(thread.legend(theme, { debug: true, heard: true, colored: true }), t);
    for (const compact of [false, true]) {
      for (const n of [network, { ...network, status: { ...network.status, borderRouters: 0 } }]) {
        const { parts } = thread.status(n, { compact, collected: { time: "12:00", age: "now" } });
        for (const [key, params, long] of parts) { t(key, params); if (long) t(long, params); }
      }
    }
    for (const f of network.findings) thread.findings.text(f, t, name);
    for (const row of deviceRows(network)) rowMeta(row, t);
    for (const d of network.devices) {
      roleText(d.role, t);
      thread.details(new FakeNode("div"), { network, t, id: d.id, onSelect() {}, onFindings() {} });
    }
  }
  assert.ok(used.size > 30, `${used.size} keys`);
  assert.deepEqual([...used].filter((key) => !base.has(key)), [], "keys only the Zigbee or ZHA tables hold");
  // And the Thread table holds nothing the Zigbee engine owns: the two engines' tables share only role words.
  const shared = Object.keys(thread.texts.en).filter((key) => key in ENGINES.zigbee.texts.en);
  assert.deepEqual(shared.sort(), ["legend.symbol_end", "legend.symbol_end_sleepy", "role.end device"]);
});

test("14: Zigbee parity: the engine builds exactly what the data model builds", async () => {
  const { zigbee } = await engines();
  const { buildNetwork } = await mod("engines/zigbee/model.js");
  const registries = { deviceRegistry: zhaResponses["config/device_registry/list"],
    areaRegistry: zhaResponses["config/area_registry/list"], configEntries: zhaResponses["config_entries/get"] };
  assert.deepEqual(zigbee.build(zhaResponses["zha/devices"], registries), buildNetwork(zhaResponses["zha/devices"], registries));
});
