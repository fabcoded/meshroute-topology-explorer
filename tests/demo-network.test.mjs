// SPDX-License-Identifier: MIT
// The demo house (demo/demo-network.mjs) tells the story its head promises, read by the Zigbee engine where it can:
// 25 devices per network, the unplugged garage plug with a stale route into it, the office desk plug's missing table,
// the weak front door lamp, the nightly terrace outage and the microwave in the history, and Thread route tables that
// follow the link costs. npm test
import assert from "node:assert/strict";
import test from "node:test";

import { buildNetwork } from "../custom_components/meshroute_topology_explorer/frontend/engines/zigbee/model.js";
import { downPath, upPath } from "../custom_components/meshroute_topology_explorer/frontend/engines/zigbee/paths.js";
import { demoHistory, demoThread, demoZha, microwaveOn, terraceOff, unpluggedAt, ZIGBEE } from "../demo/demo-network.mjs";

const NOW = 1794000000; // a fixed moment, so every run sees the same house
const zha = demoZha({ now: NOW });
const network = buildNetwork(zha["zha/devices"], { deviceRegistry: zha["config/device_registry/list"],
  areaRegistry: zha["config/area_registry/list"], configEntries: zha["config_entries/get"] });
const idOf = (name) => zha["zha/devices"].find((d) => d.user_given_name === name).ieee;

test("the demo house has 25 Zigbee and 25 Thread devices, with names and areas", () => {
  assert.equal(zha["zha/devices"].length, 25);
  assert.equal(demoThread({ readAt: NOW }).topology.nodes.length, 25);
  const areas = new Set(zha["config/area_registry/list"].map((a) => a.area_id));
  for (const d of zha["zha/devices"]) assert.ok(areas.has(d.area_id), d.user_given_name);
});

test("front door lamp: up over the hallway light on a weak link, back over the offline garage plug", () => {
  const up = upPath(network, idOf("Front door lamp"));
  assert.deepEqual(up.ids, [idOf("Front door lamp"), idOf("Hallway ceiling light"), idOf("Coordinator")]);
  const heard = zha["zha/devices"].find((d) => d.user_given_name === "Hallway ceiling light").neighbors
    .find((n) => n.ieee === idOf("Front door lamp"));
  assert.ok(Number(heard.lqi) < 60, `LQI ${heard.lqi}`);
  const down = downPath(network, idOf("Front door lamp"));
  assert.equal(down.complete, false);
  assert.deepEqual(down.ids.slice(0, 2), [idOf("Coordinator"), idOf("Garage plug")]);
  for (const name of ["Garage plug", "Garage door contact"]) {
    assert.equal(zha["zha/devices"].find((d) => d.user_given_name === name).available, false, name);
  }
});

test("office desk plug: never answers table requests, so the office window contact has no listed parent", () => {
  const plug = zha["zha/devices"].find((d) => d.user_given_name === "Office desk plug");
  assert.equal(plug.available, true);
  assert.deepEqual([plug.neighbors.length, plug.routes.length], [0, 0]);
  const listed = zha["zha/devices"].flatMap((d) => d.neighbors).some((n) => n.ieee === idOf("Office window contact"));
  assert.equal(listed, false);
});

test("last_seen is local wall-clock time without a zone, as ZHA reports it", () => {
  const plug = zha["zha/devices"].find((d) => d.user_given_name === "Garage plug");
  const at = new Date(unpluggedAt(NOW) * 1000);
  assert.match(plug.last_seen, /^\d{4}-\d\d-\d\dT17:20:00$/);
  assert.equal(new Date(plug.last_seen).getTime(), at.getTime());
});

test("history: the terrace light and the shed are gone at night, the kitchen dips at mealtimes", () => {
  const history = demoHistory({ now: NOW });
  const key = (name) => history.k.indexOf(idOf(name));
  const full = history.records.filter((r) => r.e);
  assert.ok(history.records.length >= 8 * 48, `${history.records.length} records`);
  const hears = (r, rx, tx) => r.e.find(([a, b]) => a === key(rx) && b === key(tx));
  const night = full.filter((r) => terraceOff(r.t));
  const day = full.filter((r) => !terraceOff(r.t));
  assert.ok(night.length > 50 && day.length > 50);
  assert.ok(night.every((r) => !hears(r, "Terrace light", "Garden shed plug")));
  assert.ok(day.every((r) => hears(r, "Terrace light", "Garden shed plug")));
  // The coordinator hears the kitchen light at about 55 % of its usual LQI while the microwave runs.
  const mean = (rs) => rs.reduce((s, r) => s + hears(r, "Coordinator", "Kitchen ceiling light")[2], 0) / rs.length;
  const cooking = full.filter((r) => microwaveOn(r.t));
  assert.ok(mean(cooking) < 0.7 * mean(full.filter((r) => !microwaveOn(r.t))));
  // The garage plug answers until it is unplugged, never after.
  const unplugged = unpluggedAt(NOW);
  const gpHeard = (r) => r.e.some(([a]) => a === key("Garage plug"));
  assert.ok(full.filter((r) => r.t < unplugged).every(gpHeard));
  assert.ok(full.filter((r) => r.t >= unplugged).every((r) => !gpHeard(r)));
  // The front door lamp's own route to the coordinator: over the garage plug before, over the hallway light after.
  const upHop = (r) => r.r.find(([h, d]) => h === key("Front door lamp") && d === key("Coordinator"))[2];
  assert.ok(full.filter((r) => r.t < unplugged).every((r) => upHop(r) === key("Garage plug")));
  assert.ok(full.filter((r) => r.t >= unplugged).every((r) => upHop(r) === key("Hallway ceiling light")));
});

test("Thread: route tables follow the costs; the garage hangs on one weak link, the terrace plug's tables are old", () => {
  const thread = demoThread({ readAt: NOW });
  const ext = (name) => {
    const id = thread.registry.find((r) => r.name === name)?.id;
    return thread.topology.nodes.find((n) => n.ha_device_id === id || n.host_name === name).ext_address.toLowerCase();
  };
  const table = (name) => thread.tables.nodes.find((t) => t.ext_address === ext(name));
  const freezer = table("Freezer plug");
  const kitchenEntry = freezer.route_table.find((e) => e.extAddress.toLowerCase() === ext("Kitchen plug"));
  assert.deepEqual([kitchenEntry.LQIIn, kitchenEntry.LQIOut, kitchenEntry.linkEstablished], [1, 1, true]);
  const routers = freezer.neighbor_table.filter((n) => !n.isChild).map((n) => n.extAddress.toLowerCase()).sort();
  assert.deepEqual(routers, [ext("Kitchen plug"), ext("Terrace plug")].sort());
  assert.equal(table("Terrace plug").times.route_table.lo, null);
  assert.equal(table("Terrace plug").times.route_table.hi, NOW - 20 * 3600);
  // Every router's entry for itself and a next hop for every other router (the network is connected).
  for (const t of thread.tables.nodes.filter((x) => x.routing_role >= 5)) {
    for (const e of t.route_table) {
      if (e.extAddress.toLowerCase() === t.ext_address) assert.equal(e.nextHop, 63);
      else assert.notEqual(e.nextHop, 63, `${t.ext_address} -> ${e.extAddress}`);
    }
  }
});

test("names are unique across both networks", () => {
  const thread = demoThread({ readAt: NOW });
  const names = [...Object.values(ZIGBEE).map((z) => z[0]), ...thread.registry.map((r) => r.name),
    ...thread.topology.nodes.filter((n) => n.host_name).map((n) => n.host_name)];
  assert.equal(new Set(names).size, names.length);
});
