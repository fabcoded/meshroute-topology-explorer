// SPDX-License-Identifier: MIT
// Words for a Thread finding (spec 5.6, 4.6): its title and the sentences that name its evidence. Thread raises only
// offline, parent offline and parent unknown (model/thread.js threadFindings); none of them names missing tables.
// Pure: t is the translator (ui/i18n.js), name(id) labels a device. node --test tests/

/** { title, lines: [text] } for one finding. */
export function findingText(f, t, name) {
  const e = f.evidence || {};
  const lines = [];
  if (f.kind === "offline") lines.push(t("evidence.offline", { time: t.time(e.lastSeen) }));
  if (f.kind === "parent offline") {
    lines.push(t("evidence.parent_offline", { parent: name(e.parent), time: t.time(e.parentLastSeen) }));
  }
  // No table count to hedge with: the topology lists no link between the end device and a router.
  if (f.kind === "parent unknown") lines.push(t("evidence.thread_no_parent"));
  return { title: t(`kind.${f.kind}`), lines };
}
