// SPDX-License-Identifier: MIT
// The observations client (spec 6, 10): first-seen times per router table, stored through the integration with
// read-merge-write per router, cleaned as untrusted input, kept under the size limit by dropping the oldest entries,
// in memory when the integration lacks the commands. node --test "tests/**/*.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import {
  ObservationsClient, sanitizeObservations, fitObservations,
} from "../custom_components/meshroute_topology_explorer/frontend/ui/observations-client.js";
import { fingerprints } from "../custom_components/meshroute_topology_explorer/frontend/engines/zigbee/model.js";
import { sampleNetwork } from "./panel-fixture.mjs";

const LOST = { type: "result", success: false, error: { code: 3, message: "Connection lost" } };
const T1 = "2026-10-31T10:00:00.000Z";
const T2 = "2026-10-31T11:00:00.000Z";
const T3 = "2026-10-31T12:00:00.000Z";

function fakeServer({ stored = null, unknown = false } = {}) {
  const server = { stored, calls: [], failGet: null };
  server.callWS = async (msg) => {
    server.calls.push(msg);
    if (unknown) throw { code: "unknown_command", message: "Unknown command." };
    if (msg.type === "meshroute_topology_explorer/observations/get") {
      if (server.failGet) { const err = server.failGet; server.failGet = null; throw err; }
      return { observations: server.stored === null ? null : JSON.parse(JSON.stringify(server.stored)) };
    }
    if (msg.type === "meshroute_topology_explorer/observations/set") {
      server.stored = JSON.parse(JSON.stringify(msg.observations));
      return {};
    }
    throw { code: "unknown_command" };
  };
  server.sets = () => server.calls.filter((c) => c.type.endsWith("/set"));
  return server;
}

const noTimers = { setTimeout: () => 1, clearTimeout: () => {} };
const client = (server, now, extra = {}) => new ObservationsClient({ callWS: server.callWS, network: "entry_01",
  timers: noTimers, now: () => now.value, ...extra });

/** The sample with one router's first neighbour reading changed: its table's fingerprint changes. */
function withChangedTable(network, id) {
  let done = false;
  const readings = network.readings.map((r) => {
    if (done || r.reporter !== id) return r;
    done = true;
    return { ...r, lqi: r.lqi + 1 };
  });
  return { ...network, readings };
}

test("stored observations are untrusted: device keys, valid fingerprints and times only; unknown keys survive", () => {
  const clean = sanitizeObservations(JSON.parse(`{"version": 2, "routers": {
    "AA:BB:CC:DD:00:00:00:02": {"fingerprint": "0123456789abcdef", "firstSeen": "${T1}"},
    "__proto__": {"fingerprint": "0123456789abcdef", "firstSeen": "${T1}"},
    "aa:bb:cc:dd:00:00:00:03": {"fingerprint": "<script>", "firstSeen": "${T1}"},
    "aa:bb:cc:dd:00:00:00:04": {"fingerprint": "0123456789abcdef", "firstSeen": "yesterday"},
    "aa:bb:cc:dd:00:00:00:05": "nope"}}`));
  assert.equal(clean.version, 2, "an unknown top-level key is kept");
  assert.equal(Object.getPrototypeOf(clean.routers), null);
  assert.deepEqual(Object.keys(clean.routers), ["aa:bb:cc:dd:00:00:00:02"]);
  assert.deepEqual(sanitizeObservations(null), { routers: Object.create(null) });
});

test("every load records new tables at the time seen; an unchanged table keeps its time", async () => {
  const server = fakeServer({ stored: { version: 2 } });
  const now = { value: T1 };
  const c = client(server, now);
  await c.load();
  const network = sampleNetwork();
  const changed = c.observe(network);
  assert.equal(changed.length, Object.keys(fingerprints(network)).length, "first sight: every table");
  assert.equal(c.newest(network), T1);
  now.value = T2;
  assert.deepEqual(c.observe(network), [], "the same tables again: nothing new");
  const router = network.devices.find((d) => d.role === "router" && d.hasTable).id;
  const later = withChangedTable(network, router);
  assert.deepEqual(c.observe(later), [router]);
  assert.equal(c.firstSeen(router), T2);
  assert.equal(c.newest(later), T2, "observed unchanged since the newest change");
  await c.flush();
  assert.equal(server.sets().length, 1);
  assert.equal(server.stored.version, 2, "unknown keys survive a save");
  assert.equal(server.stored.routers[router].firstSeen, T2);
});

test("two panels merge per router: the same table keeps the earlier time, a different one takes the newer view", async () => {
  const network = sampleNetwork();
  const ids = Object.keys(fingerprints(network));
  const server = fakeServer();
  const early = { value: T1 };
  const first = client(server, early);
  await first.load();
  first.observe(network);
  await first.flush();
  const late = { value: T3 };
  const second = new ObservationsClient({ callWS: server.callWS, network: "entry_01", timers: noTimers, now: () => late.value });
  // The second panel had not read the store yet and saw the same tables later.
  second.observe(network);
  second.mode = "stored";
  const changedId = ids[1];
  second.observe(withChangedTable(network, changedId));
  await second.flush();
  assert.equal(server.stored.routers[ids[0]].firstSeen, T1, "same fingerprint: the earlier time stays");
  assert.equal(server.stored.routers[changedId].firstSeen, T3, "different fingerprint: what the second panel sees now");
  assert.equal(second.firstSeen(ids[0]), T1, "the second panel adopts the earlier time");
});

test("without the commands the observations live in memory; a lost connection is retried", async () => {
  const network = sampleNetwork();
  const old = fakeServer({ unknown: true });
  const memory = client(old, { value: T1 });
  await memory.load();
  assert.equal(memory.mode, "memory");
  assert.equal(memory.reason, "unsupported");
  memory.observe(network);
  assert.equal(memory.newest(network), T1, "still observed in this session");
  await memory.flush();
  assert.equal(old.calls.length, 1, "nothing is sent");

  const server = fakeServer({ stored: { routers: {} } });
  server.failGet = LOST;
  const offline = client(server, { value: T2 });
  await offline.load();
  assert.equal(offline.retryable, true);
  offline.observe(network);
  await offline.load();
  assert.equal(offline.mode, "stored");
  await offline.flush();
  assert.equal(Object.keys(server.stored.routers).length, Object.keys(fingerprints(network)).length);
});

test("the size guard drops the oldest routers first and says how many", async () => {
  const routers = {};
  for (let i = 0; i < 40; i++) {
    const hex = i.toString(16).padStart(2, "0");
    routers[`aa:bb:cc:dd:00:00:01:${hex}`] = { fingerprint: "0123456789abcdef", firstSeen: `2026-10-${String(1 + (i % 28)).padStart(2, "0")}T00:00:00.000Z` };
  }
  const object = { routers };
  const full = new TextEncoder().encode(JSON.stringify(object)).length;
  const { object: fitted, dropped } = fitObservations(object, Math.floor(full / 2));
  assert.ok(dropped > 0);
  assert.ok(new TextEncoder().encode(JSON.stringify(fitted)).length <= Math.floor(full / 2));
  const kept = Object.values(fitted.routers).map((e) => e.firstSeen).sort();
  const gone = Object.keys(routers).filter((id) => !(id in fitted.routers)).map((id) => routers[id].firstSeen);
  assert.ok(gone.every((t) => t <= kept[0]), "only older entries were dropped");

  const server = fakeServer({ stored: object });
  const c = client(server, { value: T3 }, { maxBytes: Math.floor(full / 2) });
  await c.load();
  c.observe(sampleNetwork());
  await c.flush();
  assert.ok(c.dropped > 0, "the client says it dropped entries (shown in debug mode)");
  assert.ok(new TextEncoder().encode(JSON.stringify(server.stored)).length <= Math.floor(full / 2));
});
