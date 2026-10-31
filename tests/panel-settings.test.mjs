// SPDX-License-Identifier: MIT
// The settings client (spec 10, 11): stored settings are read and cleaned, changes are saved once after a pause,
// pins are kept in base lengths, and an integration without the commands leaves the settings in memory.
// node --test "tests/**/*.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import {
  SettingsClient, sanitizeSettings, pinsForView, DEFAULTS, SAVE_DELAY_MS, MAX_BYTES,
} from "../custom_components/meshroute_topology_explorer/frontend/ui/settings.js";

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

/** callWS fake with an in-memory store; `unknown` makes it answer like an integration without the commands. */
function fakeServer({ stored = null, unknown = false, failSet = null } = {}) {
  const calls = [];
  const server = { stored, calls };
  server.callWS = async (msg) => {
    calls.push(msg);
    if (unknown) throw { code: "unknown_command", message: "Unknown command." };
    if (msg.type === "meshroute_topology_explorer/settings/get") return { settings: server.stored };
    if (msg.type === "meshroute_topology_explorer/settings/set") {
      if (failSet) { const err = failSet; failSet = null; throw err; }
      server.stored = msg.settings;
      return {};
    }
    throw { code: "unknown_command" };
  };
  return server;
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

test("stored settings are applied on load and cleaned; unknown keys survive", async () => {
  const server = fakeServer({ stored: { density: "spread", fill: "power", openDetailsOnSelect: false,
    pins: { a: [1, 2], b: "bad", c: [1, Infinity] }, direction: "send" } });
  const client = new SettingsClient({ callWS: server.callWS, network: "entry_01", timers: manualTimers() });
  const settings = await client.load();
  assert.equal(client.mode, "stored");
  assert.deepEqual(server.calls[0], { type: "meshroute_topology_explorer/settings/get", network: "entry_01" });
  assert.equal(settings.density, "spread");
  assert.equal(settings.fill, "power");
  assert.equal(settings.openDetailsOnSelect, false);
  assert.deepEqual(settings.pins, { a: [1, 2] });
  assert.equal(settings.direction, "send", "a newer version's key is kept, since a save replaces the whole object");
  assert.deepEqual(pinsForView(settings.pins), new Map([["a", { x: 1, y: 2 }]]));
  assert.deepEqual(sanitizeSettings({ density: "huge", fill: 3, openDetailsOnSelect: "yes", view: "geo" }),
    { ...DEFAULTS, pins: {} });
  assert.deepEqual(sanitizeSettings(null), { ...DEFAULTS, pins: {} });
});

test("changes are saved once, after the pause, as the whole object", async () => {
  const server = fakeServer();
  const timers = manualTimers();
  const client = new SettingsClient({ callWS: server.callWS, network: "n", timers });
  await client.load();
  client.update({ density: "dense" });
  client.update({ fill: "role" });
  client.setPin("aa:bb", 1.23456, -2);
  assert.equal(timers.count, 1, "one timer for a burst of changes");
  assert.equal(server.calls.length, 1, "nothing saved yet");
  timers.run();
  await tick();
  const sets = server.calls.filter((c) => c.type.endsWith("/set"));
  assert.equal(sets.length, 1);
  assert.deepEqual(sets[0].settings, { view: "quality", density: "dense", fill: "role", openDetailsOnSelect: null,
    pins: { "aa:bb": [1.235, -2] } });
  assert.equal(SAVE_DELAY_MS, 1000);
  client.removePin("aa:bb");
  await client.flush();
  assert.deepEqual(server.stored.pins, {}, "flush saves at once (panel hidden)");
  assert.equal(timers.count, 0);
  await client.flush();
  assert.equal(server.calls.filter((c) => c.type.endsWith("/set")).length, 2, "nothing pending, nothing sent");
});

test("an integration without the commands: settings stay in memory, nothing is sent again", async () => {
  const server = fakeServer({ unknown: true });
  const timers = manualTimers();
  const client = new SettingsClient({ callWS: server.callWS, network: "n", timers });
  const changes = [];
  client.addEventListener("change", () => changes.push(client.mode));
  await client.load();
  assert.equal(client.mode, "memory");
  assert.equal(client.reason, "unsupported");
  client.update({ fill: "power" });
  assert.equal(client.settings.fill, "power", "the change applies in memory");
  assert.equal(timers.count, 0, "no save is scheduled");
  await client.flush();
  assert.equal(server.calls.length, 1, "only the first read");
  assert.ok(changes.length >= 2);
});

test("a save that meets an unknown command switches to memory; other errors are retried with the next change", async () => {
  const server = fakeServer({ failSet: { code: "unknown_command", message: "Unknown command." } });
  const client = new SettingsClient({ callWS: server.callWS, network: "n", timers: manualTimers() });
  await client.load();
  client.update({ fill: "role" });
  await client.flush();
  assert.equal(client.mode, "memory");

  const flaky = fakeServer({ failSet: { type: "result", success: false, error: { code: 3, message: "Connection lost" } } });
  const second = new SettingsClient({ callWS: flaky.callWS, network: "n", timers: manualTimers() });
  await second.load();
  second.update({ fill: "role" });
  await second.flush();
  assert.equal(second.mode, "stored");
  assert.equal(second.error.connection, true);
  await second.flush();
  assert.equal(flaky.stored.fill, "role", "the pending change goes out on the next flush (reconnect)");
  assert.equal(second.error, null);
});

test("unreadable settings are not overwritten; oversized ones are not sent", async () => {
  const broken = { callWS: async () => { throw { code: "home_assistant_error", message: "boom" }; } };
  const client = new SettingsClient({ callWS: broken.callWS, network: "n", timers: manualTimers() });
  await client.load();
  assert.equal(client.mode, "memory");
  assert.equal(client.reason, "unreadable");

  const server = fakeServer();
  const big = new SettingsClient({ callWS: server.callWS, network: "n", timers: manualTimers() });
  await big.load();
  const pins = {};
  for (let i = 0; i < 12000; i++) pins[`aa:bb:cc:dd:ee:ff:${String(i).padStart(5, "0")}`] = [i + 0.123, -i - 0.456];
  big.update({ pins });
  await big.flush();
  assert.equal(big.error.kind, "too-large");
  assert.ok(big.error.bytes > MAX_BYTES);
  assert.equal(server.calls.filter((c) => c.type.endsWith("/set")).length, 0);
});
