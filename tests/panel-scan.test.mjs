// SPDX-License-Identifier: MIT
// Following a scan (spec 6) with fake timers: the command is sent once without waiting, re-reads come every 15 s for
// 2 minutes and every 60 s up to 15 minutes, "tables changed since the scan started: x of y" is counted from
// fingerprints, stop works, and the scan is never called finished. node --test "tests/**/*.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import { ScanFollower, readTimes, changedTables, tablesDiffer } from "../custom_components/meshroute_topology_explorer/frontend/adapters/zha-scan.js";
import { sampleNetwork } from "./panel-fixture.mjs";

/** A clock with timers: advance(ms) runs due timers in order and lets their promises settle. */
function fakeClock() {
  let now = 0;
  let timers = [];
  return {
    now: () => now,
    setTimeout: (fn, ms) => { const h = { fn, at: now + ms }; timers.push(h); return h; },
    clearTimeout: (h) => { timers = timers.filter((x) => x !== h); },
    get pending() { return timers.length; },
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = timers.filter((h) => h.at <= end).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        now = due.at;
        timers = timers.filter((x) => x !== due);
        due.fn();
        for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
      }
      now = end;
    },
  };
}

/** The sample with the first neighbour reading of the given routers changed. */
function changed(network, ids) {
  const seen = new Set();
  return { ...network, readings: network.readings.map((r) => {
    if (!ids.includes(r.reporter) || seen.has(r.reporter)) return r;
    seen.add(r.reporter);
    return { ...r, lqi: r.lqi + 1 };
  }) };
}

test("the schedule: every 15 s for 2 minutes, then every 60 s up to 15 minutes", () => {
  const times = readTimes();
  assert.deepEqual(times.slice(0, 8), [15, 30, 45, 60, 75, 90, 105, 120].map((s) => s * 1000));
  assert.deepEqual(times.slice(8), [180, 240, 300, 360, 420, 480, 540, 600, 660, 720, 780, 840, 900].map((s) => s * 1000));
});

test("a scan is sent once, read again on schedule, counts changed tables and ends without claiming it finished", async () => {
  const network = sampleNetwork();
  const routers = network.devices.filter((d) => d.role === "router" && d.available && d.hasTable).map((d) => d.id);
  const clock = fakeClock();
  const sent = [];
  const readsAt = [];
  let answered = 0;
  const scan = new ScanFollower({
    send: () => sent.push(clock.now()),
    read: async () => { readsAt.push(clock.now()); answered += 3; return changed(network, routers.slice(0, answered)); },
    timers: clock, now: clock.now,
  });
  const statuses = [];
  scan.addEventListener("change", () => statuses.push(scan.state.status));
  scan.start(network);
  assert.deepEqual(sent, [0], "sent at once, without waiting for an answer");
  assert.equal(scan.state.status, "running");
  assert.deepEqual([scan.state.changed, scan.state.total], [0, 29]);
  await clock.advance(15000);
  assert.deepEqual([scan.state.changed, scan.state.total], [3, 29], "tables changed since the scan started: 3 of 29");
  await clock.advance(120000 - 15000);
  assert.equal(readsAt.length, 8);
  await clock.advance(900000 - 120000);
  assert.deepEqual(readsAt, readTimes());
  assert.equal(scan.state.status, "ended");
  assert.equal(scan.state.changed, 29);
  assert.equal(clock.pending, 0, "nothing left scheduled after 15 minutes");
  assert.ok(!statuses.includes("finished"));
  scan.start(network); // a new scan may start after the last one ended
  assert.equal(sent.length, 2);
});

test("stop ends the re-reads; a scan cannot start twice; a failed read keeps the schedule", async () => {
  const network = sampleNetwork();
  const clock = fakeClock();
  let reads = 0;
  const scan = new ScanFollower({ send: () => {}, read: async () => { reads += 1; if (reads === 2) throw new Error("busy"); return reads === 3 ? null : network; },
    timers: clock, now: clock.now });
  scan.start(network);
  scan.start(network);
  await clock.advance(60000);
  assert.equal(reads, 4, "15, 30, 45, 60 s: a thrown read and a null read do not stop the schedule");
  assert.equal(scan.state.failedReads, 2);
  scan.stop();
  assert.equal(scan.state.status, "stopped");
  await clock.advance(900000);
  assert.equal(reads, 4, "no reads after stop");
  scan.clear();
  assert.equal(scan.state.status, "idle");
});

test("a scan that cannot be sent says so and reads nothing", async () => {
  const clock = fakeClock();
  let reads = 0;
  const scan = new ScanFollower({ send: () => { throw { code: 3, message: "Connection lost" }; }, read: async () => { reads += 1; return null; },
    timers: clock, now: clock.now });
  scan.start(sampleNetwork());
  assert.equal(scan.state.status, "not-sent");
  assert.equal(scan.state.message, "Connection lost");
  await clock.advance(900000);
  assert.equal(reads, 0);
});

test("changed tables count routers only, a new table counts as changed; tablesDiffer ignores identical re-reads", () => {
  const network = sampleNetwork();
  const router = network.devices.find((d) => d.role === "router" && d.available && d.hasTable);
  const baseline = {};
  assert.deepEqual(changedTables(baseline, network), { changed: 29, total: 29 }, "no table at the start: every table is new");
  assert.equal(tablesDiffer(network, { ...network }), false);
  assert.equal(tablesDiffer(network, changed(network, [router.id])), true);
  const offline = { ...network, devices: network.devices.map((d) => (d.id === router.id ? { ...d, available: false } : d)) };
  assert.equal(tablesDiffer(network, offline), true, "availability counts too");
});
