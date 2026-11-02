// SPDX-License-Identifier: MIT
// CPU-time budget of the quality-view layout (spec 12, Speed). Not a *.test.mjs file: `npm test` runs it alone after
// the regular suite (concurrency 1), because a busy machine inflates CPU time even in the single-threaded child.
// Run alone: node --test --test-concurrency=1 "tests/**/*.budget.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { SETTLE_MOVE } from "../custom_components/meshroute_topology_explorer/frontend/graph/layout.js";

const report = (t, msg) => (t.diagnostic ? t.diagnostic(msg) : console.log(msg));

test("speed: 300 devices and 3 000 readings settle within 5 s", (t) => {
  // The target is computing time (spec 12). Measured in a child process with V8's --single-threaded flag
  // (tests/layout-time.mjs), as for a click: in this process the
  // CPU time also counted the compiler's and garbage collector's helper threads, and beside the other suites on a
  // loaded machine it once exceeded 5 s (2026-11-01). Best of three runs of the same deterministic layout.
  const out = execFileSync(process.execPath, ["--single-threaded", fileURLToPath(new URL("./layout-time.mjs", import.meta.url))],
    { encoding: "utf8" });
  const r = JSON.parse(out);
  assert.equal(r.devices, 300);
  assert.equal(r.readings, 3000);
  // About 0.9 to 1.2 s here alone (2026-11-01, Node 18 under WSL); the limit is spec 12's.
  report(t, `synthetic 300/3000: settled in ${r.ms} ms CPU (${r.wallMs} ms wall), ${r.steps} steps, ` +
    `largest last move ${r.lastMove.toFixed(3)}, fidelity ${r.fidelity.toFixed(3)}`);
  assert.ok(r.lastMove < SETTLE_MOVE, "settled by movement, not by the step budget");
  assert.ok(r.temperature > SETTLE_MOVE, "by balance: the cooling cap was not what stopped it");
  assert.ok(r.ms < 5000, `${r.ms} ms CPU`);
});
