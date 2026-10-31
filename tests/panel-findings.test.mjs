// SPDX-License-Identifier: MIT
// How findings reach the user (spec 5.6, 9.1): the badge counts findings without hints, hints form their own group,
// "data incomplete" is grouped by the missing table, and every finding has words in both languages.
// node --test "tests/**/*.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import { badgeCount, groupFindings, missingTables, HINT_KINDS } from "../custom_components/meshroute_topology_explorer/frontend/ui/findings.js";
import { findingText } from "../custom_components/meshroute_topology_explorer/frontend/ui/finding-text.js";
import { translator } from "../custom_components/meshroute_topology_explorer/frontend/ui/i18n.js";
import { sampleNetwork, VARIANTS } from "./panel-fixture.mjs";

const labeller = (network) => (id) => network.devices.find((d) => d.id === id).label;

test("on the sample the badge shows 5: 3 offline and 2 routes to offline devices; 10 hints are grouped apart", () => {
  const network = sampleNetwork();
  assert.equal(badgeCount(network.findings), 5);
  const grouped = groupFindings(network.findings, labeller(network));
  assert.equal(grouped.count, 5);
  assert.deepEqual(grouped.groups.map((g) => [g.kind, g.findings.length]), [["offline", 3], ["route to offline device", 2]]);
  assert.deepEqual(grouped.hints.map((g) => [g.kind, g.findings.length]), [["very low reading", 10]]);
  assert.ok(grouped.groups.every((g) => !HINT_KINDS.includes(g.kind)));
  const offline = grouped.groups[0].findings.map((f) => labeller(network)(f.device));
  assert.deepEqual(offline, [...offline].sort((a, b) => a.localeCompare(b)), "sorted by label");
});

test("with three tables removed, data incomplete is grouped by the missing table and counted once", () => {
  const network = sampleNetwork("minus3");
  const label = labeller(network);
  const grouped = groupFindings(network.findings, label);
  const incomplete = grouped.groups.find((g) => g.kind === "data incomplete");
  assert.equal(incomplete.findings.length, 26);
  assert.equal(incomplete.byTable.length, 3, "one group per missing table");
  const missing = new Set(network.findings.flatMap((f) => (f.kind === "data incomplete" ? f.missing : [])));
  assert.deepEqual(new Set(incomplete.byTable.map((g) => g.table)), missing);
  for (const sub of incomplete.byTable) {
    assert.ok(sub.findings.every((f) => f.missing.includes(sub.table)), "each entry lacks that table");
  }
  const sizes = incomplete.byTable.map((g) => g.findings.length);
  assert.deepEqual(sizes, [...sizes].sort((a, b) => b - a), "largest group first");
  assert.ok(sizes.reduce((a, b) => a + b, 0) > incomplete.findings.length, "a finding lacking several tables is listed under each");
});

test("the badge counts data incomplete once per missing table (decision 2026-10-31)", () => {
  // minus1: 3 offline, 1 route to an offline device, 21 data incomplete about one table, 2 parent unknown, 7 hints.
  const minus1 = sampleNetwork("minus1");
  assert.equal(minus1.findings.filter((f) => f.kind !== "very low reading").length, 27);
  assert.equal(missingTables(minus1.findings).size, 1);
  assert.equal(badgeCount(minus1.findings), 3 + 1 + 1 + 2);
  assert.equal(badgeCount(sampleNetwork("minus3").findings), 3 + 1 + 3 + 6);
  const coordinatorOnly = sampleNetwork("coordinator-only");
  assert.equal(badgeCount(coordinatorOnly.findings), 3 + 29 + 11);
  // In the tab, a table that only one device misses is no group to open: 29 such tables, no group at all.
  const grouped = groupFindings(coordinatorOnly.findings, labeller(coordinatorOnly));
  const incomplete = grouped.groups.find((g) => g.kind === "data incomplete");
  assert.equal(incomplete.byTable.length, 29);
  assert.ok(incomplete.byTable.every((g) => g.findings.length === 1), "rendered flat by findings-tab.js");
});

test("every finding of every variant has a title and evidence without open placeholders, in English and German", () => {
  for (const lang of ["en", "de"]) {
    const t = translator(lang);
    for (const variant of VARIANTS) {
      const network = sampleNetwork(variant);
      for (const f of network.findings) {
        const { title, lines } = findingText(f, t, labeller(network));
        assert.ok(title && !title.startsWith("kind."), `${lang} ${f.kind}`);
        assert.ok(lines.length > 0, `${lang} ${f.kind} has evidence`);
        for (const line of lines) assert.ok(!/\{\w+\}|undefined|NaN/.test(line), `${lang} ${variant} ${f.kind}: ${line}`);
      }
    }
  }
});

test("hedged and certain parent findings read differently; the last known parent is said", () => {
  const t = translator("en");
  const name = (id) => id.toUpperCase();
  const hedged = findingText({ kind: "parent unknown", device: "e", evidence: { verdict: "parent unknown" }, missing: ["r1", "r2"] }, t, name);
  assert.equal(hedged.title, "Parent unknown");
  assert.match(hedged.lines[0], /R1, R2/);
  const certain = findingText({ kind: "parent unknown", device: "e", evidence: { verdict: "no parent" }, missing: [] }, t, name);
  assert.equal(certain.title, "No parent");
  const last = findingText({ kind: "parent offline", device: "e", evidence: { parent: "p", parentLastSeen: "2026-01-01T02:00:00",
    lastKnown: true }, missing: [] }, t, name);
  assert.equal(last.lines.length, 2);
  assert.match(last.lines[1], /Last known parent/);
});
