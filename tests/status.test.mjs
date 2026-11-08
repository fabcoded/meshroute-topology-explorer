// SPDX-License-Identifier: MIT
// Tests for the panel helpers on the anonymized sample.  node --test "tests/**/*.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { entryState } from "../custom_components/meshroute_topology_explorer/frontend/adapters/ws.js";
import { statusParts, isIncomplete } from "../custom_components/meshroute_topology_explorer/frontend/engines/zigbee/status.js";
import { deviceRows } from "../custom_components/meshroute_topology_explorer/frontend/ui/device-list.js";
import { buildNetwork } from "../custom_components/meshroute_topology_explorer/frontend/engines/zigbee/model.js";

const sample = JSON.parse(readFileSync(new URL("./fixtures/zha-sample.json", import.meta.url), "utf8"));

test("status counts on the sample: only available routers count (spec 6), the coordinator is not a router", () => {
  const devices = sample.responses["zha/devices"];
  const s = buildNetwork(devices).status;
  // 32 routers in total, 30 with a table; 3 routers are unavailable, so 29 available routers, all with a table.
  assert.equal(devices.filter((d) => d.device_type === "Router").length, 32);
  assert.equal(devices.filter((d) => d.device_type === "Router" && d.neighbors.length > 0).length, 30);
  assert.equal(s.routersAvailable, 29);
  assert.equal(s.routersWithTable, 29);
});

test("deviceRows are sorted text rows; entryState follows spec 9.4 (#15: ignored and disabled entries do not count)", () => {
  const rows = deviceRows(buildNetwork(sample.responses["zha/devices"]));
  assert.equal(rows.length, 45);
  assert.ok(rows.every((r) => typeof r.label === "string" && r.label));
  assert.deepEqual(entryState([], "zha"), { status: "not_set_up" });
  assert.deepEqual(entryState(null, "zha"), { status: "not_set_up" });
  assert.deepEqual(entryState([{ domain: "zha", state: "setup_retry" }], "zha"), { status: "not_running", state: "setup_retry" });
  assert.deepEqual(entryState([{ domain: "zha", state: "not_loaded", source: "ignore" },
    { domain: "zha", state: "not_loaded", disabled_by: "user" }], "zha"), { status: "not_set_up" });
  assert.deepEqual(entryState([{ domain: "zha", state: "setup_error" }, { domain: "zha", state: "loaded" }], "zha"),
    { status: "loaded" });
  assert.deepEqual(entryState(sample.responses["config_entries/get"], "zha"), { status: "loaded" });
  assert.deepEqual(entryState(sample.responses["config_entries/get"], "matter"), { status: "not_set_up" });
});

test("status line parts on the sample and a network below 90 %", () => {
  const network = buildNetwork(sample.responses["zha/devices"]);
  const parts = statusParts(network);
  assert.deepEqual(parts.map(([key]) => key),
    ["status.source", "status.tables"], "source and router tables; no completeness percentage");
  assert.deepEqual(parts[1][1], { x: 29, y: 29 });
  assert.equal(isIncomplete(network.status), false);
  const low = { ...network.status, completeness: 26 / 29 };
  assert.equal(isIncomplete(low), true);
  assert.equal(isIncomplete({ completeness: 0.9 }), false);
  const later = statusParts(network, { unchangedSince: "2026-01-01 11:30" }).map(([key]) => key);
  assert.equal(later.at(-1), "status.unchanged", "observed unchanged since closes the line (spec 6)");
});
