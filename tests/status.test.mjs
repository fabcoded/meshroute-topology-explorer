// SPDX-License-Identifier: MIT
// Tests for the pure status logic on the anonymized sample.  node --test "tests/**/*.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseAddress, parseLqi, computeStatus, deviceRows, blockingState } from
  "../custom_components/meshroute_topology_explorer/frontend/status.js";

const sample = JSON.parse(readFileSync(new URL("./fixtures/zha-sample.json", import.meta.url), "utf8"));
const devices = sample.responses["zha/devices"];

test("parseAddress accepts 0x, 0X, numbers and decimal text, rejects the rest", () => {
  assert.equal(parseAddress("0x0D"), 13);
  assert.equal(parseAddress("0X0d"), 13);
  assert.equal(parseAddress("0x000D"), parseAddress("0xd"));  // string comparison would say different
  assert.equal(parseAddress(11138), 11138);
  assert.equal(parseAddress("11138"), 11138);
  for (const bad of ["", "0x", "0xZZ", "abc", null, undefined, -1, 1.5, {}]) assert.equal(parseAddress(bad), null);
});

test("parseLqi parses text and numbers", () => {
  assert.equal(parseLqi("157"), 157);
  assert.equal(parseLqi(" 9 "), 9);
  assert.equal(parseLqi(0), 0);
  assert.ok(parseLqi("9") < parseLqi("157"));  // numeric order, not "9" > "157"
  assert.equal(parseLqi("x"), null);
  assert.equal(parseLqi(null), null);
});

test("status counts on the sample", () => {
  const s = computeStatus(devices);
  assert.equal(s.source, "ZHA");
  assert.equal(s.devices, 45);
  // The brief expected 32 routers / 30 with a table. Those are all routers; the spec (section 6) counts only
  // available ones, and 3 routers are unavailable: 29 available routers, all 29 with a table.
  const allRouters = devices.filter((d) => d.device_type === "Router");
  assert.equal(allRouters.length, 32);
  assert.equal(allRouters.filter((d) => d.neighbors.length > 0).length, 30);
  assert.equal(s.routers, 29);
  assert.equal(s.routersWithTable, 29);
  assert.equal(s.unavailable, devices.filter((d) => !d.available).length);
  assert.ok(s.devicesInTable > 0 && s.devicesInTable <= s.devices);
});

test("coordinator is not counted as a router and an empty table does not count", () => {
  const mk = (device_type, available, neighbors) => ({ ieee: `x${Math.random()}`, device_type, available, neighbors });
  const s = computeStatus([mk("Coordinator", true, [{ ieee: "a" }]), mk("Router", true, []),
    mk("Router", false, [{ ieee: "a" }]), mk("Router", true, [{ ieee: "a" }])]);
  assert.equal(s.routers, 2);
  assert.equal(s.routersWithTable, 1);
});

test("devices in a table are matched by IEEE or by parsed network address", () => {
  const s = computeStatus([
    { ieee: "AA:01", nwk: 12, device_type: "Router", available: true, neighbors: [{ ieee: "bb:02", nwk: "0X0D" }] },
    { ieee: "bb:02", nwk: 99, device_type: "EndDevice", available: true, neighbors: [] },
    { ieee: "cc:03", nwk: 13, device_type: "EndDevice", available: true, neighbors: [] },  // matched by nwk 0X0D
    { ieee: "dd:04", nwk: 14, device_type: "EndDevice", available: false, neighbors: [] },
  ]);
  assert.equal(s.devicesInTable, 2);
  assert.equal(s.unavailable, 1);
});

test("deviceRows are sorted text rows; blockingState follows spec 9.4", () => {
  const rows = deviceRows(devices);
  assert.equal(rows.length, 45);
  assert.ok(rows.every((r) => typeof r.name === "string" && r.name));
  assert.equal(blockingState({ isAdmin: false, configEntries: [] }), "not_admin");
  assert.equal(blockingState({ isAdmin: true, configEntries: [] }), "zha_not_loaded");
  assert.equal(blockingState({ isAdmin: true, configEntries: [{ domain: "zha", state: "setup_error" }] }), "zha_not_loaded");
  assert.equal(blockingState({ isAdmin: true, configEntries: sample.responses["config_entries/get"] }), null);
});
