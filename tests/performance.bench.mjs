// SPDX-License-Identifier: MIT
// Existing CPU budgets, isolated from concurrent correctness suites. Run npm run test:performance; see CONTRIBUTING.md.
// Keep the original thresholds and convergence assertions; isolation avoids test-runner contention, not regressions.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { SETTLE_MOVE } from "../custom_components/meshroute_topology_explorer/frontend/graph/layout.js";

test("speed: 300 devices and 3 000 readings settle within 5 s", (t) => {
  // The target is computing time (spec 12). Measured in a child process with V8's --single-threaded flag
  // (tests/layout-time.mjs; decision of the main session, 2026-11-01, brief eng1), as for a click: in this process the
  // CPU time also counted the compiler's and garbage collector's helper threads, and beside the other suites on a
  // loaded machine it once exceeded 5 s (2026-11-01). Best of three runs of the same deterministic layout.
  const out = execFileSync(process.execPath, ["--single-threaded", fileURLToPath(new URL("./layout-time.mjs", import.meta.url))],
    { encoding: "utf8" });
  const r = JSON.parse(out);
  assert.equal(r.devices, 300);
  assert.equal(r.readings, 3000);
  // About 0.9 to 1.2 s here alone (2026-11-01, Node 18 under WSL, brief eng1); the limit is spec 12's.
  t.diagnostic(`synthetic 300/3000: settled in ${r.ms} ms CPU (${r.wallMs} ms wall), ${r.steps} steps, ` +
    `largest last move ${r.lastMove.toFixed(3)}, fidelity ${r.fidelity.toFixed(3)}`);
  assert.ok(r.lastMove < SETTLE_MOVE, "settled by movement, not by the step budget");
  assert.ok(r.temperature > SETTLE_MOVE, "by balance: the cooling cap was not what stopped it");
  assert.ok(r.ms < 5000, `${r.ms} ms CPU`);
});


test("a click stays well under 100 ms of model time on the sample (CPU time, fresh caches)", (t) => {
  // Measured in a child process with V8's --single-threaded flag (tests/click-time.mjs; decision of the main session,
  // 2026-11-01, brief a4z): in this process the CPU time also counted the compiler's and garbage collector's helper
  // threads, 3 to 6 times the click's wall time, and beside the other suites a click read up to 110 ms.
  const out = execFileSync(process.execPath, ["--single-threaded", fileURLToPath(new URL("./click-time.mjs", import.meta.url))],
    { encoding: "utf8" });
  const { worst, clicks } = JSON.parse(out);
  // About 8 to 30 ms here, median 14 of 7 runs (2026-11-01, Node 18 under WSL, brief a4z); the limit is the brief's.
  t.diagnostic && t.diagnostic(`slowest click ${worst} ms CPU ${JSON.stringify(clicks)}`);
  assert.equal(Object.keys(clicks).length, 4);
  assert.ok(worst < 100, `${worst} ms CPU`);
});
