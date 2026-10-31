// SPDX-License-Identifier: MIT
// How the Findings tab and the badge present the model's findings (spec 5.6, 9.1). Pure functions, no DOM.
// - The badge counts findings without hints: "very low reading" is a hint, not a verdict (decision 2026-10-31).
// - Groups follow the order of FINDING_KINDS; hints form their own group, shown collapsed.
// - "data incomplete" is grouped by the missing table, so the list says which router to look at. A finding that
//   lacks several tables appears under each of them; counts count it once.
// Tested in Node: node --test tests/
import { FINDING_KINDS } from "../model/index.js";

export const HINT_KINDS = Object.freeze(["very low reading"]);
export const isHint = (finding) => HINT_KINDS.includes(finding.kind);

/** The number on the findings badge. */
export function badgeCount(findings) {
  return findings.filter((f) => !isHint(f)).length;
}

/** { count, groups: [{ kind, findings, byTable? }], hints: [{ kind, findings }] }. byTable (only for "data incomplete")
 *  is [{ table, findings }], largest first, then by the label of the table's owner. label(id) names a device. */
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
