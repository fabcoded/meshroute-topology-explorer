// SPDX-License-Identifier: MIT
// The Findings tab (spec 5.6, 9.1): findings grouped by kind with their evidence. Consequences of missing tables
// ("data incomplete" and the hedged "parent unknown") are grouped by the missing table; a table that only one device
// misses is listed flat, without a group to open. Hints sit in their own collapsed group. Each entry is a button: it
// selects its device and zooms to it (spec 9.3). Runs in the browser; grouping lives in findings.js.
import { h } from "./dom.js";
import { groupFindings } from "./findings.js";
import { findingText } from "./finding-text.js";

/** Fill `container`. ctx: { network, t, selected (id or null), onSelect(id) }. */
export function renderFindings(container, ctx) {
  const { network, t } = ctx;
  container.replaceChildren();
  const name = (id) => (network.devices.find((x) => x.id === id) || { label: id }).label;
  const grouped = groupFindings(network.findings, name);
  /** One entry; the finding's own kind is named when it differs from its group's (a hedged "parent unknown" in the
   *  missing-table group). */
  const item = (f, groupKind) => {
    const { title, lines } = findingText(f, t, name);
    return h("li", {}, h("button", { type: "button", class: "finding", "data-device": f.device,
      "aria-current": f.device === ctx.selected ? "true" : null, on: { click: () => ctx.onSelect(f.device) } },
    h("span", { class: "finding-device", text: f.kind === groupKind ? name(f.device) : `${name(f.device)} · ${title}` }),
    lines.map((line) => h("span", { class: "evidence", text: line }))));
  };
  if (!grouped.groups.length) container.append(h("p", { class: "empty", text: t("findings.none") }));
  for (const group of grouped.groups) {
    const kindName = group.kind === "parent unknown" && group.findings.every((f) => f.evidence && f.evidence.verdict === "no parent")
      ? t("kind.no parent") : t(`kind.${group.kind}`);
    const heading = group.byTable
      ? t("findings.incomplete_group", { kind: kindName, tables: group.byTable.length, count: group.devices })
      : t("findings.group", { kind: kindName, count: group.findings.length });
    const section = h("section", { class: "group" }, h("h3", { text: heading }));
    if (group.byTable) {
      const singles = [];
      for (const sub of group.byTable) {
        if (sub.findings.length === 1) { singles.push(sub.findings[0]); continue; }
        section.append(h("details", { class: "sub" },
          h("summary", { text: t("findings.missing_table", { name: name(sub.table), count: sub.findings.length }) }),
          h("ul", { class: "plain" }, sub.findings.map((f) => item(f, group.kind)))));
      }
      // A finding may lack several tables; listed flat it appears once.
      if (singles.length) section.append(h("ul", { class: "plain" }, [...new Set(singles)].map((f) => item(f, group.kind))));
    } else {
      section.append(h("ul", { class: "plain" }, group.findings.map((f) => item(f, group.kind))));
    }
    container.append(section);
  }
  if (grouped.hints.length) {
    const count = grouped.hints.reduce((n, g) => n + g.findings.length, 0);
    const hints = h("details", { class: "hints" }, h("summary", { text: t("findings.hints", { count }) }),
      h("p", { class: "muted small", text: t("findings.hints_note") }));
    for (const group of grouped.hints) {
      hints.append(h("h4", { text: t("findings.group", { kind: t(`kind.${group.kind}`), count: group.findings.length }) }),
        h("ul", { class: "plain" }, group.findings.map((f) => item(f, group.kind))));
    }
    container.append(hints);
  }
}

/** Mark the entries of the selected device without rebuilding the list (keeps focus and open groups). */
export function markFindings(container, selected) {
  for (const b of container.querySelectorAll("button.finding")) {
    if (b.getAttribute("data-device") === selected) b.setAttribute("aria-current", "true");
    else b.removeAttribute("aria-current");
  }
}
