// SPDX-License-Identifier: MIT
// How the Findings tab and the badge present the model's findings (spec 5.6, 9.1). Pure functions, no DOM.
// - The badge counts findings without hints: "very low reading" is a hint, not a verdict (decision 2026-10-31).
//   "data incomplete" counts once per missing table, not once per device that misses it: one router that did not
//   answer is one thing to look at, even if twenty devices are affected (decision 2026-10-31, calm default).
// - Groups follow the order of FINDING_KINDS; hints form their own group, shown collapsed.
// - "data incomplete" is grouped by the missing table, so the list says which router to look at. A finding that
//   lacks several tables appears under each of them; counts count it once.
// Tested in Node: node --test tests/
import { FINDING_KINDS } from "../model/index.js";

export const HINT_KINDS = Object.freeze(["very low reading"]);
export const isHint = (finding) => HINT_KINDS.includes(finding.kind);

/** Tables named by "data incomplete" findings (the device itself when a finding names none). */
export function missingTables(findings) {
  const tables = new Set();
  for (const f of findings) {
    if (f.kind !== "data incomplete") continue;
    for (const table of f.missing && f.missing.length ? f.missing : [f.device]) tables.add(table);
  }
  return tables;
}

/** The number on the findings badge: findings without hints, "data incomplete" once per missing table. */
export function badgeCount(findings) {
  return findings.filter((f) => !isHint(f) && f.kind !== "data incomplete").length + missingTables(findings).size;
}

/** { count, groups: [{ kind, findings, byTable? }], hints: [{ kind, findings }] }. byTable (only for "data incomplete")
 *  is [{ table, findings }], largest first, then by the label of the table's owner. label(id) names a device.
 *  count is the badge's number (badgeCount). */
export function groupFindings(findings, label = (id) => id) {
  const byKind = new Map();
  for (const f of findings) {
    if (!byKind.has(f.kind)) byKind.set(f.kind, []);
    byKind.get(f.kind).push(f);
  }
  const kinds = [...FINDING_KINDS, ...[...byKind.keys()].filter((k) => !FINDING_KINDS.includes(k))];
  const groups = [];
  const hints = [];
  for (const kind of kinds) {
    const list = byKind.get(kind);
    if (!list) continue;
    const sorted = [...list].sort((a, b) => label(a.device).localeCompare(label(b.device)) || a.device.localeCompare(b.device));
    if (HINT_KINDS.includes(kind)) {
      hints.push({ kind, findings: sorted });
    } else if (kind === "data incomplete") {
      groups.push({ kind, findings: sorted, byTable: byMissingTable(sorted, label) });
    } else {
      groups.push({ kind, findings: sorted });
    }
  }
  return { count: badgeCount(findings), groups, hints };
}

function byMissingTable(findings, label) {
  const tables = new Map();
  for (const f of findings) {
    for (const table of f.missing && f.missing.length ? f.missing : [f.device]) {
      if (!tables.has(table)) tables.set(table, []);
      tables.get(table).push(f);
    }
  }
  return [...tables].map(([table, list]) => ({ table, findings: list }))
    .sort((a, b) => b.findings.length - a.findings.length || label(a.table).localeCompare(label(b.table)));
}
