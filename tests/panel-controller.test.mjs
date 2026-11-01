// SPDX-License-Identifier: MIT
// The panel's state machine (spec 9.4, 10) with a fake hass: the empty and error states, a lost connection with the
// automatic reload when it is back, no reload on a new hass object, no listeners while hidden.
// node --test "tests/**/*.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import { PanelController, readNetwork } from "../custom_components/meshroute_topology_explorer/frontend/ui/controller.js";
import { isConnectionLost } from "../custom_components/meshroute_topology_explorer/frontend/adapters/ws.js";
import { responses } from "./panel-fixture.mjs";

const LOST = { type: "result", success: false, error: { code: 3, message: "Connection lost" } };

/** Connection stand-in that counts its listeners. */
class FakeConnection extends EventTarget {
  constructor() { super(); this.listeners = 0; }
  addEventListener(type, fn) { this.listeners += 1; super.addEventListener(type, fn); }
  removeEventListener(type, fn) { this.listeners -= 1; super.removeEventListener(type, fn); }
}

function fakeHass({ admin = true, zha = true, devices = responses["zha/devices"], fail = null } = {}) {
  const calls = [];
  const connection = new FakeConnection();
  const hass = {
    user: { is_admin: admin }, connected: true, connection, calls,
    callWS: async (msg) => {
      calls.push(msg.type);
      if (fail && fail.type === msg.type) throw fail.error;
      switch (msg.type) {
        case "config_entries/get": return zha ? responses["config_entries/get"] : [];
        case "zha/devices": return devices;
        case "config/device_registry/list": return responses["config/device_registry/list"];
        case "config/area_registry/list": return responses["config/area_registry/list"];
        default: throw { code: "unknown_command" };
      }
    },
  };
  return hass;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("readNetwork decides the states of spec 9.4", async () => {
  assert.equal((await readNetwork(fakeHass({ admin: false }))).phase, "not_admin");
  assert.equal((await readNetwork(fakeHass({ zha: false }))).phase, "zha_not_loaded");
  assert.equal((await readNetwork(fakeHass({ devices: [] }))).phase, "no_devices");
  const err = await readNetwork(fakeHass({ fail: { type: "zha/devices", error: { code: "home_assistant_error", message: "boom" } } }));
  assert.deepEqual(err, { phase: "error", message: "boom" });
  assert.equal((await readNetwork(fakeHass({ fail: { type: "zha/devices", error: LOST } }))).phase, "disconnected");
  const ok = await readNetwork(fakeHass());
  assert.equal(ok.phase, "ready");
  assert.equal(ok.network.devices.length, 45);
  assert.equal(ok.network.id, "entry_01");
  const noAdmin = fakeHass({ admin: false });
  await readNetwork(noAdmin);
  assert.deepEqual(noAdmin.calls, [], "no admin-only command is sent for a non-administrator");
  assert.ok(isConnectionLost(LOST) && isConnectionLost({ code: 3 }) && !isConnectionLost({ code: "unknown_command" }));
});

test("the network is read once: new hass objects do not reload it", async () => {
  const controller = new PanelController();
  const hass = fakeHass();
  controller.setHass({ ...hass, user: null });
  controller.attach();
  assert.equal(hass.calls.length, 0, "without a user the admin check would be wrong: wait");
  controller.setHass(hass);
  await settle();
  assert.equal(controller.state.phase, "ready");
  const reads = hass.calls.filter((c) => c === "zha/devices").length;
  for (let i = 0; i < 5; i++) controller.setHass({ ...hass });
  await settle();
  assert.equal(hass.calls.filter((c) => c === "zha/devices").length, reads);
});

test("a lost connection keeps the picture and reloads by itself when it is back", async () => {
  const controller = new PanelController();
  const hass = fakeHass();
  controller.attach();
  controller.setHass(hass);
  await settle();
  const first = controller.state.network;
  let reconnected = 0;
  controller.addEventListener("reconnected", () => { reconnected += 1; });
  hass.connection.dispatchEvent(new Event("disconnected"));
  assert.equal(controller.state.connection, "lost");
  assert.equal(controller.state.phase, "ready", "the last picture stays");
  controller.setHass({ ...hass, connected: false });
  hass.connection.dispatchEvent(new Event("ready"));
  await settle();
  assert.equal(reconnected, 1);
  assert.equal(controller.state.connection, "ok");
  assert.notEqual(controller.state.network, first, "read again");
  controller.setHass({ ...hass, connected: true });
  await settle();
  assert.equal(reconnected, 1, "the hass flag and the event count as one reconnect");
});

test("a load that meets a lost connection waits for the reconnect; errors offer a retry", async () => {
  let down = true;
  const hass = fakeHass();
  const base = hass.callWS;
  hass.callWS = async (msg) => { if (down) throw LOST; return base(msg); };
  const controller = new PanelController();
  controller.attach();
  controller.setHass(hass);
  await settle();
  assert.equal(controller.state.phase, "disconnected");
  down = false;
  controller.setHass({ ...hass, connected: true });
  await settle();
  assert.equal(controller.state.phase, "ready");

  const failing = fakeHass({ fail: { type: "zha/devices", error: { code: "home_assistant_error", message: "boom" } } });
  const second = new PanelController();
  second.attach();
  second.setHass(failing);
  await settle();
  assert.equal(second.state.phase, "error");
  failing.callWS = fakeHass().callWS;
  await second.reload();
  assert.equal(second.state.phase, "ready");
});

test("hidden panels do not listen to the connection; a reconnect missed while hidden is caught up", async () => {
  const controller = new PanelController();
  const hass = fakeHass();
  controller.attach();
  controller.setHass(hass);
  await settle();
  assert.equal(hass.connection.listeners, 2);
  controller.detach();
  assert.equal(hass.connection.listeners, 0);
  hass.connection.dispatchEvent(new Event("disconnected"));
  controller.setHass({ ...hass, connected: false });
  assert.equal(controller.state.connection, "lost", "the hass flag still tells");
  controller.setHass({ ...hass, connected: true });
  controller.detach();
  controller.attach();
  await settle();
  assert.equal(controller.state.connection, "ok");
  assert.equal(hass.connection.listeners, 2);
});

test("a slow first load does not overwrite a newer one", async () => {
  let release;
  const slow = new Promise((resolve) => { release = resolve; });
  let n = 0;
  const controller = new PanelController({ read: async () => {
    n += 1;
    if (n === 1) { await slow; return { phase: "error", message: "old" }; }
    return { phase: "no_devices" };
  } });
  controller.attach();
  controller.setHass(fakeHass());
  const second = controller.reload();
  await second;
  release();
  await settle();
  assert.equal(controller.state.phase, "no_devices");
});
