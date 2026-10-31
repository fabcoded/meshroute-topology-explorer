// SPDX-License-Identifier: MIT
// How the Findings tab and the badge present the model's findings (spec 5.6, 9.1). Pure functions, no DOM.
// - The badge counts findings without hints: "very low reading" is a hint, not a verdict (decision 2026-10-31).
// - Missing tables count once each, not once per device they affect: one router that did not answer is one thing to
//   look at, even if twenty devices are affected (decision 2026-10-31, calm default). They are named by "data
//   incomplete" and by the hedged "parent unknown (tables of … missing)", which is a consequence of missing tables,
//   not a verdict (decision 2026-10-31). The unhedged "no parent" stays a finding of its own.
// - Groups follow the order of FINDING_KINDS; hints form their own group, shown collapsed.
// - The missing-table group lists both kinds by the table they name, so the list says which router to look at. A
//   finding that lacks several tables appears under each of them.
// Tested in Node: node --test tests/
import { FINDING_KINDS } from "../model/index.js";

export const HINT_KINDS = Object.freeze(["very low reading"]);
export const isHint = (finding) => HINT_KINDS.includes(finding.kind);

/** The group that collects consequences of missing tables. */
export const MISSING_KIND = "data incomplete";

/** Whether a finding only says that tables are missing: "data incomplete", or "parent unknown" in its hedged form. */
export function isMissingTable(f) {
  return f.kind === MISSING_KIND
    || (f.kind === "parent unknown" && !(f.evidence && f.evidence.verdict === "no parent") && Boolean(f.missing && f.missing.length));
}

/** Tables a finding lacks (the device itself when a "data incomplete" finding names none). */
const tablesOf = (f) => (f.missing && f.missing.length ? f.missing : [f.device]);

/** Tables named by the findings that only say tables are missing. */
export function missingTables(findings) {
  const tables = new Set();
  for (const f of findings) if (isMissingTable(f)) for (const table of tablesOf(f)) tables.add(table);
  return tables;
}

/** The number on the findings badge: findings without hints, with every missing table counted once instead of the
 *  findings it causes. */
export function badgeCount(findings) {
  return findings.filter((f) => !isHint(f) && !isMissingTable(f)).length + missingTables(findings).size;
}

/** { count, groups: [{ kind, findings, byTable?, devices? }], hints: [{ kind, findings }] }. The missing-table group
 *  (kind "data incomplete") holds "data incomplete" and hedged "parent unknown" findings, byTable [{ table, findings }]
 *  largest first, then by the label of the table's owner, and devices (distinct devices affected). label(id) names a
 *  device. count is the badge's number (badgeCount). */
export function groupFindings(findings, label = (id) => id) {
  const byKind = new Map();
  for (const f of findings) {
    const kind = isMissingTable(f) ? MISSING_KIND : f.kind;
    if (!byKind.has(kind)) byKind.set(kind, []);
    byKind.get(kind).push(f);
  }
  const kinds = [...FINDING_KINDS, ...[...byKind.keys()].filter((k) => !FINDING_KINDS.includes(k))];
  const order = (f) => FINDING_KINDS.indexOf(f.kind);
  const groups = [];
  const hints = [];
  for (const kind of kinds) {
    const list = byKind.get(kind);
    if (!list) continue;
    const sorted = [...list].sort((a, b) => label(a.device).localeCompare(label(b.device)) || a.device.localeCompare(b.device)
      || order(a) - order(b));
    if (HINT_KINDS.includes(kind)) {
      hints.push({ kind, findings: sorted });
    } else if (kind === MISSING_KIND) {
      groups.push({ kind, findings: sorted, byTable: byMissingTable(sorted, label), devices: new Set(sorted.map((f) => f.device)).size });
    } else {
      groups.push({ kind, findings: sorted });
    }
  }
  return { count: badgeCount(findings), groups, hints };
}

function byMissingTable(findings, label) {
  const tables = new Map();
  for (const f of findings) {
    for (const table of tablesOf(f)) {
      if (!tables.has(table)) tables.set(table, []);
      tables.get(table).push(f);
    }
  }
  return [...tables].map(([table, list]) => ({ table, findings: list }))
    .sort((a, b) => b.findings.length - a.findings.length || label(a.table).localeCompare(label(b.table)));
}
