// SPDX-License-Identifier: MIT
// The settings client (spec 10, 11): stored settings are read and cleaned as untrusted input, changes are saved once
// after a pause as read-merge-write (last write wins per key, pins merge per device), a lost connection at the first
// read is retried, and an integration without the commands leaves the settings in memory.
// node --test "tests/**/*.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import {
  SettingsClient, sanitizeSettings, sanitizePins, pinsForView, presentPins, DEFAULTS, SAVE_DELAY_MS, MAX_BYTES, PIN_LIMIT,
  sanitizeColor, sanitizePathColors, sanitizeLabels, spreadStep, densityFactor, formatFactor, SPREAD_MIN, SPREAD_MAX,
} from "../custom_components/meshroute_topology_explorer/frontend/ui/settings.js";
import { sampleNetwork } from "./panel-fixture.mjs";
import { settings as ZIGBEE } from "../custom_components/meshroute_topology_explorer/frontend/engines/zigbee/settings.js";

const A = "aa:bb:cc:dd:00:00:00:02";
const B = "aa:bb:cc:dd:00:00:00:03";
const C = "aa:bb:cc:dd:00:00:00:04";
const LOST = { type: "result", success: false, error: { code: 3, message: "Connection lost" } };

/** Timers that run only when told to. */
function manualTimers() {
  let pending = [];
  return {
    setTimeout: (fn, ms) => { const h = { fn, ms }; pending.push(h); return h; },
    clearTimeout: (h) => { pending = pending.filter((x) => x !== h); },
    get count() { return pending.length; },
    run() { const due = pending; pending = []; for (const h of due) h.fn(); },
  };
}

/** callWS fake with one in-memory store shared by any number of clients (panels). */
function fakeServer({ stored = null, unknown = false } = {}) {
  const server = { stored, calls: [], failGet: null, failSet: null };
  server.callWS = async (msg) => {
    server.calls.push(msg);
    if (unknown) throw { code: "unknown_command", message: "Unknown command." };
    if (msg.type === "meshroute_topology_explorer/settings/get") {
      if (server.failGet) { const err = server.failGet; server.failGet = null; throw err; }
      return { settings: server.stored === null ? null : JSON.parse(JSON.stringify(server.stored)) };
    }
    if (msg.type === "meshroute_topology_explorer/settings/set") {
      if (server.failSet) { const err = server.failSet; server.failSet = null; throw err; }
      server.stored = JSON.parse(JSON.stringify(msg.settings));
      return {};
    }
    throw { code: "unknown_command" };
  };
  server.sets = () => server.calls.filter((c) => c.type.endsWith("/set"));
  return server;
}

// A ZHA network's client: the shell's keys and the Zigbee engine's.
const client = (server, timers = manualTimers()) => new SettingsClient({ callWS: server.callWS, network: "entry_01",
  engineSettings: ZIGBEE, timers });

test("stored settings are applied on load and cleaned; unknown keys survive", async () => {
  const server = fakeServer({ stored: { density: "spread", fill: "power", openDetailsOnSelect: false,
    pins: { [A]: [1, 2], [B]: "bad", [C]: [1, Infinity] }, direction: "send" } });
  const c = client(server);
  const settings = await c.load();
  assert.equal(c.mode, "stored");
  assert.deepEqual(server.calls[0], { type: "meshroute_topology_explorer/settings/get", network: "entry_01" });
  assert.equal(settings.density, "spread");
  assert.equal(settings.fill, "power");
  assert.equal(settings.openDetailsOnSelect, false);
  assert.deepEqual({ ...settings.pins }, { [A]: [1, 2] });
  assert.equal(settings.direction, "send", "a newer version's key is kept");
  assert.deepEqual(pinsForView(settings.pins), new Map([[A, { x: 1, y: 2 }]]));
  assert.equal(DEFAULTS.fill, "none");
  assert.equal(sanitizeSettings({ fill: "reception" }).fill, "none", "a stored reception fill falls back to none");
  const clean = sanitizeSettings({ density: "huge", fill: 3, openDetailsOnSelect: "yes" });
  assert.deepEqual({ ...clean, pins: { ...clean.pins } }, { ...DEFAULTS, pins: {} });
});

test("stored pins are untrusted: no prototype, device keys only, finite numbers clamped to ±1000 base lengths", () => {
  const hostile = JSON.parse(`{"__proto__": [1, 2], "constructor": [3, 4], "toString": [5, 6], "AA:BB:CC:DD:00:00:00:02": [1e9, -1e9],
    "not-an-address": [1, 2], "${B}": [1, 2, 3], "${C}": [0.12345, "7"], "00:00:00:00:00:00:00:00": [1, 1]}`);
  const pins = sanitizePins(hostile);
  assert.equal(Object.getPrototypeOf(pins), null, "a map without prototype");
  assert.deepEqual(Object.keys(pins), [A], "only EUI-64 keys, normalized to lower case");
  assert.deepEqual(pins[A], [PIN_LIMIT, -PIN_LIMIT]);
  assert.equal(PIN_LIMIT, 1000);
  assert.equal("constructor" in pins, false);
  assert.equal({}.polluted, undefined);
  const settings = sanitizeSettings(JSON.parse('{"pins": {"__proto__": {"polluted": 1}}, "__proto__": {"polluted": 1}}'));
  assert.equal({}.polluted, undefined, "nothing reaches Object.prototype");
  assert.deepEqual(Object.keys(settings.pins), []);
});

test("release all counts only devices in the network", () => {
  const network = sampleNetwork();
  const present = network.devices[3].id;
  const pins = sanitizePins({ [present]: [1, 1], "aa:bb:cc:dd:ee:ff:00:99": [2, 2] });
  assert.deepEqual(presentPins(pins, network), [present]);
  assert.deepEqual(presentPins(pins, null), []);
});

test("changes are saved once, after the pause, by reading and merging first", async () => {
  const server = fakeServer({ stored: { fill: "role", extra: 1 } });
  const timers = manualTimers();
  const c = client(server, timers);
  await c.load();
  c.update({ density: "dense" });
  c.update({ openDetailsOnSelect: true });
  c.setPin(A, 1.23456, -2);
  assert.equal(timers.count, 1, "one timer for a burst of changes");
  assert.equal(server.sets().length, 0, "nothing saved yet");
  assert.equal(SAVE_DELAY_MS, 1000);
  await c.flush();
  assert.equal(server.sets().length, 1);
  const kinds = server.calls.map((m) => m.type.split("/").pop());
  assert.deepEqual(kinds, ["get", "get", "set"], "read, merge, write");
  assert.deepEqual(server.stored, { density: "dense", densityFactor: 1.44, fill: "role", openDetailsOnSelect: true,
    extra: 1, paths: "coordinator", heard: false, returnRoutes: false,
    pathColors: { mode: "grey", bad: null, medium: null, good: null }, labels: { type: true, name: true, haName: false },
    sourceRoute: "assume", pins: { [A]: [1.235, -2] } });
  await c.flush();
  assert.equal(server.sets().length, 1, "nothing pending, nothing sent");
  c.removePin(A);
  await c.flush();
  assert.deepEqual(server.stored.pins, {});
});

test("two panels: last write wins per key, pins merge per device", async () => {
  const server = fakeServer({ stored: { pins: { [C]: [5, 5] } } });
  const first = client(server);
  const second = client(server);
  await first.load();
  await second.load();
  first.setPin(A, 1, 1);
  first.update({ fill: "power" });
  await first.flush();
  second.setPin(B, 2, 2);
  second.removePin(C);
  second.update({ density: "spread" });
  await second.flush();
  assert.deepEqual(server.stored.pins, { [A]: [1, 1], [B]: [2, 2] }, "the second panel kept the first one's pin");
  assert.equal(server.stored.fill, "power", "a key the second panel did not touch stays as the first wrote it");
  assert.equal(server.stored.density, "spread");
  second.update({ fill: "role" });
  await second.flush();
  assert.equal(server.stored.fill, "role", "last write wins per key");
});

test("a first read that meets a lost connection is retried; changes made meanwhile are merged and saved", async () => {
  const server = fakeServer({ stored: { density: "spread", pins: { [C]: [5, 5] } } });
  server.failGet = LOST;
  const timers = manualTimers();
  const c = client(server, timers);
  await c.load();
  assert.equal(c.mode, "memory");
  assert.equal(c.reason, "offline");
  assert.equal(c.retryable, true);
  c.setPin(A, 1, 1);
  c.update({ fill: "role" });
  assert.equal(timers.count, 0, "nothing is sent while offline");
  await c.load(); // the panel does this on reconnect
  assert.equal(c.mode, "stored");
  assert.equal(c.retryable, false);
  assert.equal(c.settings.density, "spread", "the stored value arrives");
  assert.equal(c.settings.fill, "role", "the local change stays");
  assert.deepEqual({ ...c.settings.pins }, { [A]: [1, 1], [C]: [5, 5] });
  assert.equal(timers.count, 1, "and is saved");
  await c.flush();
  assert.deepEqual(server.stored.pins, { [A]: [1, 1], [C]: [5, 5] });
  assert.equal(server.stored.fill, "role");
});

test("a failed save keeps the changes pending", async () => {
  const server = fakeServer();
  const c = client(server);
  await c.load();
  c.setPin(A, 1, 1);
  server.failSet = LOST;
  await c.flush();
  assert.equal(c.mode, "stored");
  assert.equal(c.error.connection, true);
  await c.flush();
  assert.deepEqual(server.stored.pins, { [A]: [1, 1] }, "the pending change goes out on the next flush");
  assert.equal(c.error, null);
});

test("unreadable settings are not overwritten; oversized ones are not sent", async () => {
  const broken = { callWS: async () => { throw { code: "storage_unavailable", message: "boom" }; } };
  const c = new SettingsClient({ callWS: broken.callWS, network: "n", timers: manualTimers() });
  await c.load();
  assert.equal(c.mode, "memory");
  assert.equal(c.reason, "unreadable");

  const server = fakeServer();
  const big = client(server);
  await big.load();
  for (let i = 0; i < 8000; i++) {
    const hex = i.toString(16).padStart(4, "0");
    big.setPin(`aa:bb:cc:dd:ee:ff:${hex.slice(0, 2)}:${hex.slice(2)}`, i + 0.123, -i - 0.456);
  }
  await big.flush();
  assert.equal(big.error.kind, "too-large");
  assert.ok(big.error.bytes > MAX_BYTES);
  assert.equal(server.sets().length, 0);
});

test("communication paths and path display are stored per network;  bad values fall back", async () => {
  assert.equal(ZIGBEE.defaults.paths, "coordinator");
  assert.deepEqual(DEFAULTS.pathColors, { mode: "grey", bad: null, medium: null, good: null }, "colour is opt-in");
  for (const bad of ["ALL", "", 1, null, { all: true }, ["all"], "__proto__"]) {
    assert.equal(sanitizeSettings({ paths: bad }, ZIGBEE).paths, "coordinator", JSON.stringify(bad));
  }
  // Round trip through the integration: bad stored values fall back, a saved choice comes back.
  const server = fakeServer({ stored: { pathColors: { mode: "rainbow", bad: "red" } } });
  const c = client(server, manualTimers());
  await c.load();
  assert.deepEqual(c.settings.pathColors, { mode: "grey", bad: null, medium: null, good: null });
  c.update({ pathColors: { mode: "coloured", bad: "#0072B2", medium: null, good: "#e69f00" } });
  await c.flush();
  assert.deepEqual(server.stored.pathColors, { mode: "coloured", bad: "#0072b2", medium: null, good: "#e69f00" });
  c.update({ paths: "coordinator", heard: true });
  await c.flush();
  const again = client(server, manualTimers());
  await again.load();
  assert.deepEqual([again.settings.paths, again.settings.heard], ["coordinator", true]);
  assert.deepEqual(again.settings.pathColors, { mode: "coloured", bad: "#0072b2", medium: null, good: "#e69f00" });
});

test("path colours: only #rrggbb is a colour; anything else is the theme's own", () => {
  assert.equal(sanitizeColor("#A1b2C3"), "#a1b2c3");
  for (const bad of ["#abc", "a1b2c3", "#a1b2c3d4", "red", "rgb(1,2,3)", "#gg0000", " #a1b2c3", 0xa1b2c3, null, {},
    ["#a1b2c3"], "#a1b2c3;background:url(x)"]) {
    assert.equal(sanitizeColor(bad), null, JSON.stringify(bad));
  }
  assert.deepEqual(sanitizePathColors({ mode: "coloured", bad: "#ff0000", medium: "javascript:1", good: 5, extra: 1 }),
    { mode: "coloured", bad: "#ff0000", medium: null, good: null }, "unknown members are dropped");
  for (const bad of [null, "coloured", [], 1, true]) {
    assert.deepEqual(sanitizePathColors(bad), { mode: "grey", bad: null, medium: null, good: null }, JSON.stringify(bad));
  }
  const hostile = sanitizeSettings(JSON.parse('{"pathColors": {"__proto__": {"mode": "coloured"}, "bad": "#000000"}}'));
  assert.equal(hostile.pathColors.mode, "grey");
  assert.equal({}.mode, undefined, "nothing reaches Object.prototype");
});

test("label switches: a boolean per line, defaults type and name on, the Home Assistant name off", async () => {
  assert.deepEqual(DEFAULTS.labels, { type: true, name: true, haName: false });
  assert.deepEqual(sanitizeLabels({ type: false, name: "no", haName: true, size: 3 }), { type: false, name: true, haName: true });
  for (const bad of [null, [], "all", 1]) assert.deepEqual(sanitizeLabels(bad), { type: true, name: true, haName: false });
  const server = fakeServer({ stored: { labels: { type: 0, haName: true } } });
  const c = client(server, manualTimers());
  await c.load();
  assert.deepEqual(c.settings.labels, { type: true, name: true, haName: true });
  c.update({ labels: { ...c.settings.labels, type: false } });
  await c.flush();
  assert.deepEqual(server.stored.labels, { type: false, name: true, haName: true });
  const again = client(server, manualTimers());
  await again.load();
  assert.deepEqual(again.settings.labels, { type: false, name: true, haName: true });
});

test("custom node distance: a step starts from the active preset, multiplies by 1.25 and clamps to 0.6 to 8", () => {
  const s = (o) => sanitizeSettings(o);
  assert.deepEqual(spreadStep(s({}), 1), { density: "custom", densityFactor: 1.8 }, "medium 1.44 x 1.25");
  assert.deepEqual(spreadStep(s({ density: "dense" }), -1), { density: "custom", densityFactor: 0.768 });
  assert.equal(spreadStep(s({ density: "custom", densityFactor: 2.4 }), 1).densityFactor, 3);
  assert.equal(spreadStep(s({ density: "custom", densityFactor: 7 }), 1).densityFactor, SPREAD_MAX);
  assert.equal(spreadStep(s({ density: "custom", densityFactor: 0.65 }), -1).densityFactor, SPREAD_MIN);
});

test("custom node distance: stored factor is cleaned, 'spread' still means 2.28, display has one decimal", () => {
  assert.equal(densityFactor(sanitizeSettings({ density: "spread" })), 2.28, "a 0.1.0 value keeps its factor");
  assert.equal(sanitizeSettings({ density: "custom", densityFactor: 99 }).densityFactor, SPREAD_MAX);
  assert.equal(sanitizeSettings({ density: "custom", densityFactor: 0.01 }).densityFactor, SPREAD_MIN);
  for (const bad of ["3", NaN, null, Infinity]) {
    assert.equal(sanitizeSettings({ density: "custom", densityFactor: bad }).densityFactor, 1.44, String(bad));
  }
  assert.equal(sanitizeSettings({ density: "custom", densityFactor: 2.123456 }).densityFactor, 2.123);
  assert.deepEqual([2.85, 3.3, 0.96, 8, 0.6].map(formatFactor), ["×2.9", "×3.3", "×1.0", "×8.0", "×0.6"]);
});

test("custom node distance is stored per network and restored on load", async () => {
  const server = fakeServer({ stored: {} });
  const c = client(server, manualTimers());
  await c.load();
  c.update(spreadStep(c.settings, 1));
  c.update(spreadStep(c.settings, 1));
  assert.equal(c.settings.densityFactor, 2.25);
  const timers = manualTimers();
  const c2 = client(fakeServer({ stored: { density: "custom", densityFactor: 2.25 } }), timers);
  await c2.load();
  assert.deepEqual([c2.settings.density, c2.settings.densityFactor], ["custom", 2.25]);
});
