// SPDX-License-Identifier: MIT
// Words for a finding (spec 5.6): its title and the sentences that name its evidence and the tables it lacks.
// Shared by the Details and Findings tabs. Pure: t is the translator (i18n.js), name(id) labels a device.
// Tested in Node on the sample and its derived variants: node --test tests/

/** { title, lines: [text] } for one finding. */
export function findingText(f, t, name) {
  const e = f.evidence || {};
  const list = (ids) => t.list((ids || []).map(name));
  const lines = [];
  let title = t(`kind.${f.kind}`);
  switch (f.kind) {
    case "offline":
      lines.push(t("evidence.offline", { time: t.time(e.lastSeen) }));
      break;
    case "parent offline":
      lines.push(t("evidence.parent_offline", { parent: name(e.parent), time: t.time(e.parentLastSeen) }));
      if (e.lastKnown) lines.push(t("evidence.last_known"));
      break;
    case "route to offline device":
      lines.push(t("evidence.route_offline", { destination: name(e.destination), next: name(e.nextHop), list: list(e.unavailable) }));
      break;
    case "data incomplete":
      lines.push(/without table$/.test(e.reason || "") && e.reason !== "expected reporter without table"
        ? t("evidence.no_table", { name: name(f.device) })
        : t("evidence.reporter_no_table", { list: list(f.missing) }));
      break;
    case "weak reception":
      lines.push(t("evidence.weak", { lqi: e.lqi, reporter: name(e.reporter), median: t.number(e.reporterMedian) })
        + (e.medianOf === "vendor" ? ` ${t("rank.vendor")}` : ""));
      break;
    case "very low reading":
      for (const r of e.readings || []) lines.push(t("evidence.very_low", { lqi: r.lqi, reporter: name(r.reporter) }));
      break;
    case "parent unknown":
      if (e.verdict === "no parent link") {
        lines.push(t("evidence.thread_no_parent")); // Thread: no table count to hedge with (model/thread.js)
      } else if (e.verdict === "no parent") {
        title = t("kind.no parent");
        lines.push(t("evidence.no_parent"));
      } else {
        lines.push(t("evidence.parent_unknown", { list: list(f.missing) }));
      }
      break;
    case "isolated":
      lines.push(t("evidence.isolated"));
      break;
    case "many end-device children":
      lines.push(t("evidence.children", { count: (e.children || []).length, list: list(e.children) }));
      break;
    default:
      break;
  }
  // Kinds whose sentence does not already name the missing tables get them as a line of their own.
  if (f.missing && f.missing.length && f.kind !== "data incomplete" && f.kind !== "parent unknown") {
    lines.push(t("evidence.missing", { list: list(f.missing) }));
  }
  return { title, lines };
}
