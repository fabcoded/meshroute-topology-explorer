// SPDX-License-Identifier: MIT
// CPU-time budget of a click on the sample (spec 12, Speed). Not a *.test.mjs file: `npm test` runs it alone after
// the regular suite (concurrency 1), because a busy machine inflates CPU time even in the single-threaded child.
// Run alone: node --test --test-concurrency=1 "tests/**/*.budget.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("a click stays well under 100 ms of model time on the sample (CPU time, fresh caches)", (t) => {
  // Measured in a child process with V8's --single-threaded flag (tests/click-time.mjs):
  // in this process the CPU time also counted the compiler's and garbage collector's helper
  // threads, 3 to 6 times the click's wall time, and beside the other suites a click read up to 110 ms.
  const out = execFileSync(process.execPath, ["--single-threaded", fileURLToPath(new URL("./click-time.mjs", import.meta.url))],
    { encoding: "utf8" });
  const { worst, clicks } = JSON.parse(out);
  // About 8 to 30 ms here, median 14 of 7 runs (2026-11-01, Node 18 under WSL); the limit is the brief's.
  t.diagnostic && t.diagnostic(`slowest click ${worst} ms CPU ${JSON.stringify(clicks)}`);
  assert.equal(Object.keys(clicks).length, 4);
  assert.ok(worst < 100, `${worst} ms CPU`);
});
