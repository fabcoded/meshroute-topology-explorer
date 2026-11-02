// SPDX-License-Identifier: MIT
// Details of a device in a Thread network (spec 3.2, 9.2): Thread data has no routes, no signature and no clusters, so
// instead of the three sub-tabs one stack of cards: the head (name, type · role · vendor model, the state), the
// neighbours with the reception in both directions (RSSI in dBm and link quality 0-3, each measured by its receiver),
// parent or children, the findings, and the Thread facts (role, extended address, RLOC16, Matter node id).
// Names are set as text. Runs in the browser; the rows are pure (threadNeighbourRows) and tested in Node.
import { h } from "../../ui/dom.js";
import { findingText } from "./findings.js";
import { roleText } from "../../ui/format.js";
import { unknownGlyph } from "../unknown-reason.js";

/** A direction's reception as text: "−75 dBm · LQI 3", what is known of it, or the unknown glyph. */
export function threadReception(dir) {
  if (!dir || dir.state !== "measured") return unknownGlyph(dir && dir.reason);
  const parts = [];
  if (typeof dir.rssi === "number") parts.push(`${String(dir.rssi).replace("-", "−")} dBm`);
  if (typeof dir.lqi === "number") parts.push(`LQI ${dir.lqi}`);
  return parts.join(" · ") || "?";
}

/** One row per neighbour of device `id`: { id, hears (id hears it), heardBy (it hears id), parent, child }, the
 *  parent first, then by label in natural order. */
export function threadNeighbourRows(network, id) {
  const byId = new Map(network.devices.map((d) => [d.id, d]));
  const self = byId.get(id);
  const rows = [];
  for (const p of network.pairs || []) {
    if (p.a !== id && p.b !== id) continue;
    const other = p.a === id ? p.b : p.a;
    rows.push({ id: other, hears: p.a === id ? p.ab : p.ba, heardBy: p.a === id ? p.ba : p.ab,
      parent: Boolean(self && self.parent === other), child: Boolean(self && self.children.includes(other)) });
  }
  const label = (r) => (byId.get(r.id) || { label: r.id }).label;
  return rows.sort((x, y) => (y.parent - x.parent) || label(x).localeCompare(label(y), undefined, { numeric: true }));
}

const card = (title, ...children) => h("section", { class: "card" }, title ? h("h3", { class: "card-title", text: title }) : null,
  ...children);

/** Fill `container` for a Thread device. ctx: the Details context of panel.js (network, t, id, onSelect, onFindings). */
export function renderThreadDetails(container, ctx) {
  const { network, t } = ctx;
  container.replaceChildren();
  const d = ctx.id ? network.devices.find((x) => x.id === ctx.id) : null;
  if (!d) {
    container.append(h("p", { class: "empty", text: t("details.empty") }));
    return;
  }
  const name = (id) => (network.devices.find((x) => x.id === id) || { label: id }).label;
  const product = [d.vendor, d.model].filter(Boolean).join(" ");
  const role = d.leader ? `${roleText(d.role, t)} (${t("details.thread_leader")})` : roleText(d.role, t);
  const line = [role, product].filter(Boolean).join(" · ");
  const head = h("div", { class: "details-head" }, h("h2", { class: "device-name", text: d.label }),
    h("p", { class: "muted", text: line }));
  if (!d.available) head.append(h("p", { class: "warn-text", text: t("details.thread_stale") }));
  if (!d.availabilityKnown) head.append(h("p", { class: "muted small", text: t("details.thread_availability_unknown") }));
  container.append(head);

  const link = (id) => h("button", { type: "button", class: "link", text: name(id), on: { click: () => ctx.onSelect(id) } });
  const rows = threadNeighbourRows(network, d.id);
  const list = rows.length ? h("ul", { class: "plain" }, rows.map((r) => h("li", {},
    h("div", {}, link(r.id), r.parent ? ` · ${t("lane.parent")}` : r.child ? ` · ${t("role.end device")}` : ""),
    h("div", { class: "muted small", text: t("details.thread_hears", { name: name(r.id), value: threadReception(r.hears) }) }),
    h("div", { class: "muted small", text: t("details.thread_heard_by", { name: name(r.id), value: threadReception(r.heardBy) }) }))))
    : h("p", { class: "muted", text: t("details.thread_none") });
  container.append(card(t("details.thread_title"), h("p", { class: "muted small", text: t("details.thread_note") }), list));

  const findings = (network.findings || []).filter((f) => f.device === d.id);
  if (findings.length) {
    container.append(card(t("tab.findings"), ...findings.map((f) => {
      const { title, lines } = findingText(f, t, name);
      return h("div", {}, h("strong", { text: title }), ...lines.map((l) => h("p", { class: "muted small", text: l })));
    })));
  }

  const hex = (n) => (typeof n === "number" ? `0x${n.toString(16).toUpperCase().padStart(4, "0")}` : t("details.thread_unknown"));
  container.append(card(t("details.tab_entity"), h("ul", { class: "plain" },
    h("li", { text: t("details.thread_role", { role: d.threadRole || "?" }) }),
    h("li", { text: t("details.thread_ext", { value: d.extAddress || "?" }) }),
    h("li", { text: t("details.thread_rloc", { value: hex(d.rloc16) }) }),
    d.nodeId !== null ? h("li", { text: t("details.thread_node", { value: String(d.nodeId) }) }) : null)));
}
