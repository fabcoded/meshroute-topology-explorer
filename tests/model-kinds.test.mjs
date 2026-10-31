// SPDX-License-Identifier: MIT
// Tests of the device kind (picture) and sleep from the `zha/devices` signature (spec 3.1, 4.2, 8): the sample's
// devices by model, endpoint precedence, the cluster fallback, unknown signatures, number and text forms of the
// identifiers, and sleep from the MAC capability flags or a neighbour entry.
// node --test "tests/**/*.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import { deviceKind, receiverOffWhenIdle, KINDS }
  from "../custom_components/meshroute_topology_explorer/frontend/model/kinds.js";
import { buildNetwork } from "../custom_components/meshroute_topology_explorer/frontend/model/index.js";
import { sampleNetwork, responses } from "./panel-fixture.mjs";

const ep = (profile, type, input = [], output = []) => ({ profile_id: profile, device_type: type,
  input_clusters: input, output_clusters: output });

test("sample: every device gets a picture from its signature, none is unknown", () => {
  const sample = sampleNetwork();
  const count = {};
  for (const d of sample.devices) count[d.kind] = (count[d.kind] || 0) + 1;
  assert.deepEqual(count, { hub: 1, light: 28, outlet: 4, button: 7, motion: 5 });
  const byModel = (model) => [...new Set(sample.devices.filter((d) => d.model === model).map((d) => d.kind))];
  assert.deepEqual(byModel("TRADFRI control outlet"), ["outlet"]); // HA 0x010a on/off plug-in unit
  assert.deepEqual(byModel("INSPELNING Smart plug"), ["outlet"]);
  assert.deepEqual(byModel("LCT012"), ["light"]); // ZLL 0x0210 extended colour light
  assert.deepEqual(byModel("TRADFRI bulb E27 WW globe 806lm"), ["light"]); // HA 0x0101 dimmable light
  assert.deepEqual(byModel("SML002"), ["motion"], "occupancy sensor beats the on/off sensor endpoint");
  assert.deepEqual(byModel("RWL021"), ["button"], "scene controller beats the simple sensor endpoint");
  assert.deepEqual(byModel("RODRET Dimmer"), ["button"]);
  assert.equal(sample.devices.find((d) => d.role === "coordinator").kind, "hub", "whatever it declares (0x0400)");
});

test("sample: end devices sleep (receiver off when idle), routers and the coordinator do not", () => {
  const sample = sampleNetwork();
  for (const d of sample.devices) assert.equal(d.sleepy, d.role === "end device", `${d.label}: ${d.sleepy}`);
});

test("endpoint device types per profile; identifiers as hex text or numbers", () => {
  const sig = (...eps) => ({ endpoints: Object.fromEntries(eps.map((e, i) => [String(i + 1), e])) });
  assert.equal(deviceKind(sig(ep("0x0104", "0x010C"))), "light");
  assert.equal(deviceKind(sig(ep(0x0104, 0x010c))), "light");
  assert.equal(deviceKind(sig(ep("0xc05e", "0x0220"))), "light", "ZLL colour temperature light");
  assert.equal(deviceKind(sig(ep("0x0104", "0x0301"))), "thermostat");
  assert.equal(deviceKind(sig(ep("0x0104", "0x0202"))), "blind");
  assert.equal(deviceKind(sig(ep("0x0104", "0x000a"))), "lock");
  assert.equal(deviceKind(sig(ep("0x0104", "0x0302"))), "temperature");
  assert.equal(deviceKind(sig(ep("0x0104", "0x0002"))), "relay");
  // The same identifier in another profile means something else: ZLL 0x0000 is a light, HA 0x0000 a switch.
  assert.equal(deviceKind(sig(ep("0xc05e", "0x0000"))), "light");
  assert.equal(deviceKind(sig(ep("0x0104", "0x0000"))), "button");
  // Green Power proxy endpoints and range extenders say nothing about the device.
  assert.equal(deviceKind(sig(ep("0xa1e0", "0x0061"))), "unknown");
  assert.equal(deviceKind(sig(ep("0x0104", "0x0008"))), "unknown");
});

test("manufacturer-specific device types fall back to server clusters that name one function", () => {
  const sig = (input, output = []) => ({ endpoints: { 1: ep("0x0104", "0x5f01", input, output) } });
  assert.equal(deviceKind(sig(["0x0000", "0x0402", "0x0405"])), "temperature");
  assert.equal(deviceKind(sig(["0x0000", "0x0500"])), "sensor", "an IAS zone does not say which sensor");
  assert.equal(deviceKind(sig(["0x0000", "0x0006", "0x0008", "0x0300"])), "light");
  assert.equal(deviceKind(sig(["0x0000", "0x0102"])), "blind");
  assert.equal(deviceKind(sig(["0x0000"], ["0x0402"])), "unknown", "client clusters do not count");
  assert.equal(deviceKind(sig(["0x0000", "0x0006"])), "unknown", "on/off alone: unknown beats wrong");
});

test("no or broken signature: unknown; every kind has a name the symbols know", () => {
  for (const s of [undefined, null, {}, { endpoints: null }, { endpoints: { 1: null } }, "x"]) {
    assert.equal(deviceKind(s), "unknown");
  }
  assert.ok(KINDS.includes("unknown"));
});

test("sleep from the MAC capability flags (bit 3), else from a neighbour entry, else unknown", () => {
  assert.equal(receiverOffWhenIdle({ node_descriptor: { mac_capability_flags: 128 } }), true);
  assert.equal(receiverOffWhenIdle({ node_descriptor: { mac_capability_flags: 142 } }), false);
  assert.equal(receiverOffWhenIdle({ node_descriptor: { mac_capability_flags: "0x8c" } }), false);
  assert.equal(receiverOffWhenIdle({}), null);
  assert.equal(receiverOffWhenIdle(null), null);
  // A sleepy end device without node descriptor: its parent's entry says "Off".
  const raw = structuredClone(responses["zha/devices"]);
  const end = raw.find((d) => d.device_type === "EndDevice");
  delete end.signature.node_descriptor;
  const net = buildNetwork(raw);
  assert.equal(net.devices.find((d) => d.id === end.ieee).sleepy, true);
  // Neither: unknown, not awake.
  for (const d of raw) for (const n of d.neighbors) if (n.ieee === end.ieee) delete n.rx_on_when_idle;
  assert.equal(buildNetwork(raw).devices.find((d) => d.id === end.ieee).sleepy, null);
});
