// SPDX-License-Identifier: MIT
// The device list, the keyboard path to every device (spec 9.3): rows, filter and the listbox keys.
// node --test "tests/**/*.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import { deviceRows, filterRows, moveIndex, ListModel } from "../custom_components/meshroute_topology_explorer/frontend/ui/device-list.js";
import { sampleNetwork } from "./panel-fixture.mjs";

test("arrows, Home, End and Page keys move within bounds; other keys are not ours", () => {
  assert.equal(moveIndex(-1, "ArrowDown", 5), 0);
  assert.equal(moveIndex(-1, "ArrowUp", 5), 4);
  assert.equal(moveIndex(4, "ArrowDown", 5), 4);
  assert.equal(moveIndex(0, "ArrowUp", 5), 0);
  assert.equal(moveIndex(2, "Home", 5), 0);
  assert.equal(moveIndex(2, "End", 5), 4);
  assert.equal(moveIndex(0, "PageDown", 45), 10);
  assert.equal(moveIndex(40, "PageDown", 45), 44);
  assert.equal(moveIndex(3, "PageUp", 45), 0);
  assert.equal(moveIndex(1, "a", 5), null);
  assert.equal(moveIndex(-1, "ArrowDown", 0), -1);
});

test("every device can be reached with the arrow keys alone and selected with Enter", () => {
  const network = sampleNetwork();
  const model = new ListModel(deviceRows(network));
  const seen = new Set();
  let r = model.key("ArrowDown");
  while (r && !seen.has(r.id)) { seen.add(r.id); r = model.key("ArrowDown"); }
  assert.equal(seen.size, network.devices.length);
  assert.deepEqual(model.key("Enter"), { action: "select", id: model.activeId });
  assert.equal(model.key("Tab"), null, "Tab leaves the list");
});

test("the filter matches label, model, area and addresses; the active row follows the filter", () => {
  const network = sampleNetwork();
  const rows = deviceRows(network);
  assert.deepEqual(rows.map((r) => r.label), [...rows.map((r) => r.label)].sort((a, b) => a.localeCompare(b)));
  const coordinator = network.devices.find((d) => d.role === "coordinator");
  assert.equal(filterRows(rows, "0x0000").map((r) => r.id).join(), coordinator.id, "network address in hex");
  assert.ok(filterRows(rows, "router 1").every((r) => /router/i.test(r.search) && r.search.includes("1")));
  assert.ok(filterRows(rows, "area_03").length > 1);
  assert.equal(filterRows(rows, "").length, rows.length);
  const model = new ListModel(rows);
  model.activate(coordinator.id);
  assert.ok(filterRows(rows, "router 17").some((r) => r.label === "Router 17"), "words in any order and place");
  model.setFilter(rows[5].id);
  assert.equal(model.visible.length, 1);
  assert.equal(model.activeId, model.visible[0].id, "the active row moves into the filtered list");
  model.setFilter("no such device");
  assert.equal(model.activeId, null);
  assert.equal(model.key("Enter"), null);
});

test("rows per spec 9.1: the coordinator first, the parent of end devices, 'direct to the coordinator' where true", async () => {
  const { rowMeta } = await import("../custom_components/meshroute_topology_explorer/frontend/ui/device-list.js");
  const { connectionOf } = await import("../custom_components/meshroute_topology_explorer/frontend/engines/zigbee/connection.js");
  const { translator } = await import("../custom_components/meshroute_topology_explorer/frontend/ui/i18n.js");
  const { upPath } = await import("../custom_components/meshroute_topology_explorer/frontend/engines/zigbee/paths.js");
  const network = sampleNetwork();
  const rows = deviceRows(network);
  const coordinator = network.devices.find((d) => d.role === "coordinator");
  assert.equal(rows[0].id, coordinator.id, "the coordinator comes first");
  assert.deepEqual(rows.slice(1).map((r) => r.label), [...rows.slice(1).map((r) => r.label)].sort((a, b) => a.localeCompare(b)));
  const en = translator("en");
  const row = (label) => rows.find((r) => r.label === label);
  assert.equal(rowMeta(rows[0], en).split(" \u00B7 ").slice(0, 2).join(" \u00B7 "), "Coordinator \u00B7 Network");
  // An end device names its parent; a sleepy one says it sleeps instead of its role.
  const end = network.devices.find((d) => d.role === "end device" && d.parent && d.parent !== coordinator.id && d.sleepy);
  const parent = network.devices.find((d) => d.id === end.parent);
  assert.ok(rowMeta(row(end.label), en).includes(`sleeps \u00B7 via ${parent.label}`));
  // A router whose way up is the one hop to the coordinator.
  const direct = network.devices.filter((d) => d.role === "router" && upPath(network, d.id).complete
    && upPath(network, d.id).ids.length === 2);
  assert.ok(direct.length > 0);
  for (const d of direct) {
    assert.deepEqual(connectionOf(network, d, coordinator.id), { kind: "direct" });
    assert.ok(rowMeta(row(d.label), en).includes("Router \u00B7 direct to the coordinator"), d.label);
  }
  const far = network.devices.find((d) => d.role === "router" && upPath(network, d.id).ids.length > 2);
  assert.equal(connectionOf(network, far, coordinator.id), null, "a router's next hop is a route, not a bond");
  assert.ok(!rowMeta(row(far.label), en).includes("rank"), "the reception rank lives in Details");
  // An end device whose parent is the coordinator is direct too.
  assert.deepEqual(connectionOf(network, { role: "end device", parent: coordinator.id }, coordinator.id), { kind: "direct" });
  const off = rows.find((r) => !r.available);
  assert.ok(rowMeta(off, en).endsWith("unavailable"));
});
