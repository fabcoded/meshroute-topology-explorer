// SPDX-License-Identifier: MIT
// The node card and the cluster table from a device's signature (spec 9.2 Entity and Cluster): MAC capability flags,
// stack compliance revision from the server mask, frequency bands, manufacturer code, buffers, quirk, firmware; the
// cluster table per endpoint; names of profiles, device types and clusters in English and German; the shape of the
// ZCL attribute catalogue. node --test "tests/**/*.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import { responses, sampleNetwork } from "./panel-fixture.mjs";
import { macCapabilities, stackRevision, frequencyBands, nodeCard, clusterTable, entityIds }
  from "../custom_components/meshroute_topology_explorer/frontend/engines/zigbee/signature.js";
import { clusterName, clusterAbout, clusterAttributes, readableAttributes, deviceTypeName, profileName,
  isManufacturerSpecific, CATALOGUED, NAMED } from "../custom_components/meshroute_topology_explorer/frontend/engines/zigbee/zcl.js";

const raws = responses["zha/devices"];
const rawOf = (label) => {
  const reg = responses["config/device_registry/list"].find((e) => e.name_by_user === label);
  return raws.find((d) => d.user_given_name === label || (reg && d.device_reg_id === reg.id));
};

test("MAC capability flags, bit by bit", () => {
  // 0x8e: full-function, mains, receiver on when idle, allocate address (a router on the sample).
  assert.deepEqual(macCapabilities(142), { alternatePanCoordinator: false, fullFunction: true, mainsPower: true,
    rxOnWhenIdle: true, security: false, allocateAddress: true });
  // 0x80: a sleepy battery end device.
  const sleepy = macCapabilities("0x80");
  assert.equal(sleepy.rxOnWhenIdle, false);
  assert.equal(sleepy.fullFunction, false);
  assert.equal(sleepy.mainsPower, false);
  assert.equal(macCapabilities(0x8f).alternatePanCoordinator, true, "the coordinator on the sample");
  assert.equal(macCapabilities(0x40).security, true);
  assert.equal(macCapabilities(undefined), null);
  assert.equal(macCapabilities("x"), null);
});

test("stack compliance revision from the server mask (bits 9-15); 0 before r21; frequency bands", () => {
  assert.equal(stackRevision(11264), 22, "0x2C00");
  assert.equal(stackRevision(11265), 22, "the coordinator also sets bit 0 (primary trust centre)");
  assert.equal(stackRevision(0x2a00), 21);
  assert.equal(stackRevision(0), 0);
  assert.equal(stackRevision(null), null);
  assert.deepEqual(frequencyBands(8), ["2400"]);
  assert.deepEqual(frequencyBands(0x05), ["868", "915"]);
  assert.deepEqual(frequencyBands(0x10), ["subghz"]);
  assert.deepEqual(frequencyBands(undefined), []);
});

test("the node card of a sample router and a sleepy end device", () => {
  const network = sampleNetwork();
  const raw = rawOf("Router 03");
  const device = network.devices.find((d) => d.label === "Router 03");
  const card = nodeCard(raw, device);
  assert.equal(card.logicalType, "router");
  assert.equal(card.mac.rxOnWhenIdle, true);
  assert.deepEqual(card.bands, ["2400"]);
  assert.equal(card.revision, 22);
  assert.equal(card.manufacturerCode, raw.manufacturer_code);
  assert.equal(card.bufferSize, raw.signature.node_descriptor.maximum_buffer_size);
  assert.equal(card.firmware, null, "the anonymized registry has no sw_version: unknown");
  assert.equal(nodeCard(raw, { ...device, firmware: "1.2.3" }).firmware, "1.2.3");
  const end = raws.find((d) => d.device_type === "EndDevice" && d.quirk_applied);
  const endCard = nodeCard(end, {});
  assert.equal(endCard.logicalType, "end device");
  assert.equal(endCard.mac.rxOnWhenIdle, false);
  assert.equal(endCard.quirk, end.quirk_class, "an applied quirk is named");
  const plain = raws.find((d) => d.quirk_applied === false && d.quirk_class);
  assert.equal(nodeCard(plain, {}).quirk, null, "a class without an applied quirk is no quirk");
  assert.deepEqual(nodeCard(null, {}), { logicalType: null, mac: null, bands: [], revision: null, manufacturerCode: null,
    bufferSize: null, transferIn: null, transferOut: null, quirk: null, firmware: null, lastSeen: null });
});

test("the cluster table: endpoints in order, input clusters first, manufacturer-specific marked", () => {
  const table = clusterTable(rawOf("Router 03").signature);
  assert.deepEqual(table.map((e) => e.endpoint), [...table.map((e) => e.endpoint)].sort((a, b) => a - b));
  for (const ep of table) {
    const dirs = ep.clusters.map((c) => c.direction);
    assert.deepEqual(dirs, [...dirs].sort((a, b) => (a === "in" ? 0 : 1) - (b === "in" ? 0 : 1)), "in before out");
    for (const c of ep.clusters) assert.equal(c.manufacturerSpecific, c.id >= 0xfc00);
  }
  assert.ok(table.some((ep) => ep.profile === 0x0104));
  assert.deepEqual(clusterTable({ endpoints: { 2: { profile_id: 260, device_type: "0x0107", input_clusters: ["0x0406", 0, "bad"],
    output_clusters: [25] } } }), [{ endpoint: 2, profile: 0x0104, deviceType: 0x0107, clusters: [
    { id: 0, direction: "in", manufacturerSpecific: false }, { id: 0x0406, direction: "in", manufacturerSpecific: false },
    { id: 0x0019, direction: "out", manufacturerSpecific: false }] }]);
  assert.deepEqual(clusterTable(null), []);
  assert.deepEqual(entityIds({ entities: [{ entity_id: "light.a" }, {}, { entity_id: " " }, null] }), ["light.a"]);
});

test("names in English and German: every cluster, device type and profile on the sample has one", () => {
  for (const d of raws) {
    for (const ep of Object.values(d.signature.endpoints || {})) {
      const profile = parseInt(ep.profile_id, 16);
      assert.ok(profileName(profile), `profile ${ep.profile_id}`);
      assert.ok(deviceTypeName(profile, parseInt(ep.device_type, 16), "en"), `${ep.profile_id}/${ep.device_type}`);
      for (const c of [...ep.input_clusters, ...ep.output_clusters].map((x) => parseInt(x, 16))) {
        assert.ok(isManufacturerSpecific(c) || clusterName(c, "en"), `cluster 0x${c.toString(16)}`);
      }
    }
  }
  assert.equal(clusterName(0x0006, "en"), "On/Off");
  assert.equal(clusterName(0x0006, "de"), "Ein/Aus", "the board's word");
  assert.equal(clusterName(0x0008, "de"), "Helligkeit");
  assert.equal(clusterName(0x0019, "de"), "OTA-Update");
  assert.equal(deviceTypeName(0x0104, 0x010c, "de"), "Farbtemperatur-Lampe");
  assert.equal(deviceTypeName(0xa1e0, 0x0061, "en"), "Proxy Basic");
  assert.equal(profileName(0x0104), "Home Automation");
  assert.equal(clusterName(0xfc7c, "en"), null);
  for (const id of NAMED) {
    for (const lang of ["en", "de"]) {
      assert.ok(clusterName(id, lang) && !clusterName(id, lang).includes("|"), `${id} ${lang}`);
      assert.ok(clusterAbout(id, lang), `about ${id} ${lang}`);
    }
  }
});

test("the attribute catalogue: the common clusters, well-formed entries from the ZCL", () => {
  const expected = [0x0000, 0x0001, 0x0003, 0x0004, 0x0005, 0x0006, 0x0008, 0x0019, 0x0020, 0x0300, 0x0400, 0x0402,
    0x0405, 0x0406, 0x0500, 0x0702, 0x0b04, 0x0b05, 0x1000];
  assert.deepEqual([...CATALOGUED].sort((a, b) => a - b), expected);
  const types = new Set(["bool", "uint8", "uint16", "uint24", "uint32", "uint48", "int8", "int16", "int24", "enum8", "enum16",
    "map8", "map16", "map32", "string", "octstr", "EUI64"]);
  for (const id of CATALOGUED) {
    const list = clusterAttributes(id);
    assert.ok(clusterName(id, "en"), `catalogued cluster ${id} has a name`);
    assert.equal(new Set(list.map((a) => a.id)).size, list.length, `unique ids in ${id}`);
    for (const a of list) {
      assert.ok(Number.isInteger(a.id) && a.id >= 0 && a.id <= 0xffff);
      assert.match(a.name, /^[A-Za-z][A-Za-z0-9_-]*$/);
      assert.ok(types.has(a.type), `${a.name}: ${a.type}`);
      assert.ok(a.side === "server" || a.side === "client");
      assert.ok(a.gloss === null || typeof a.gloss.de === "string");
    }
  }
  assert.deepEqual(clusterAttributes(0x0006).map((a) => a.name), ["OnOff", "GlobalSceneControl", "OnTime", "OffWaitTime", "StartUpOnOff"]);
  assert.equal(clusterAttributes(0x0006)[0].gloss.de, "an / aus");
  assert.deepEqual(clusterAttributes(0x1000), [], "Touchlink: commands only");
  assert.equal(clusterAttributes(0xfc7c), null, "unknown: no list");
  // What a read asks for: a server (input) cluster holds the server attributes, a client (output) cluster the client ones.
  assert.equal(readableAttributes(0x0006, "in").length, 5);
  assert.deepEqual(readableAttributes(0x0006, "out"), []);
  assert.ok(readableAttributes(0x0019, "out").some((a) => a.name === "CurrentFileVersion"), "OTA lives on the client");
  assert.deepEqual(readableAttributes(0x0019, "in"), []);
});
