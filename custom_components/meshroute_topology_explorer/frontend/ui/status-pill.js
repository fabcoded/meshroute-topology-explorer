// SPDX-License-Identifier: MIT
// The status pill (spec 6, 9.1, 11): a floating control at the bottom centre of the map that replaces the former status
// line. Left to right: a round arrow button, two lines (the network's name; its data state), a dot in the state's colour
// (green: all router tables read and current; amber: something missing or old; red: no connection). The colour is never
// the only signal: the second line says the same. The whole pill is the WAI-ARIA menu button of the network switch; its
// menu opens upwards with the networks (only when there are two or more), the full data state and the link to the
// integration's page in Home Assistant (only for administrators). pillModel() is pure and tested in Node, statusPill()
// builds the DOM (browser only). npm test
import { h, icon } from "./dom.js";
import { inApp, INTEGRATION_PATH } from "./ha-links.js";
import { adapterByKey } from "../adapters/index.js";

export const PILL_MENU_ID = "mte-pill-menu";

/** Everything the pill shows, as data. ctx: { t, status (the engine's full status line: { parts, right, level }),
 *  short (its compact form), namesMissing, lost (connection lost), choices (networkChoices), active (network key),
 *  admin }. Returns { level, name, shortName, line, state: [{ text, title, stop }], networks: [{ key, label, available,
 *  why }], settings: { path } | null }. */
export function pillModel({ t, status, short, namesMissing = false, lost = false, choices = [], active, admin = false }) {
  const level = lost ? "error" : status.level;
  const line = lost ? t("status.lost") : short.parts.map(([key, params]) => t(key, params)).join(" · ");
  const state = status.parts.filter(([key]) => key !== "status.source").map(([key, params, long]) => ({
    text: t(key, params),
    title: key === "status.unchanged" ? t("status.unchanged_note") : long ? t(long, params) : "",
    stop: key === "status.scan_running",
  }));
  const right = status.right;
  if (right) state.push({ text: t(right[0], right[1]), title: right[2] ? t(right[2], right[1]) : "", stop: false });
  if (namesMissing) state.push({ text: t("status.names_missing"), title: "", stop: false });
  const networks = choices.length < 2 ? [] : choices.map((c) => ({
    key: c.key, label: t(`source.${c.key}`), available: c.available,
    why: c.available ? null : adapterByKey(c.key).reasonText(c, t),
  }));
  return { level, activeKey: active, name: t(`source.${active}`), shortName: t(`source_short.${active}`), line, state, networks,
    settings: admin ? { path: INTEGRATION_PATH } : null };
}

/** A settings link row: a real link that stays in Home Assistant's app (history + "location-changed"). */
export function settingsLink(path, label, attrs = {}) {
  return h("a", { href: path, on: { click: inApp(path) }, ...attrs }, icon("settings", 16), h("span", { text: label }),
    icon("link", 14));
}

/** The pill's DOM as a list of children for the status section. ctx: { t, model, open, onToggle(open),
 *  onChoose(key), onStop() }. */
export function statusPill({ t, model, open, onToggle, onChoose, onStop }) {
  const pill = h("button", { type: "button", id: "mte-pill", class: `status-pill-button level-${model.level}`,
    "aria-haspopup": "menu", "aria-expanded": String(open), "aria-controls": PILL_MENU_ID,
    "aria-label": t("status.pill_label", { name: model.name, state: model.line }), on: { click: () => onToggle(!open) } },
  h("span", { class: "pill-arrow", "aria-hidden": "true" }, icon(open ? "down" : "up", 16)),
  h("span", { class: "pill-text", id: "mte-status" },
    h("span", { class: "pill-name" }, h("span", { class: "pill-full", text: model.name }),
      h("span", { class: "pill-short", text: model.shortName })),
    h("span", { class: "pill-line", text: model.line })),
  h("span", { class: "pill-dot", "aria-hidden": "true" }));
  if (!open) return [pill];
  const items = [];
  const parts = [];
  if (model.networks.length) {
    parts.push(h("div", { class: "menu-title", text: t("status.network") }));
    for (const n of model.networks) {
      const item = h("button", { type: "button", role: "menuitemradio", id: `mte-pill-net-${n.key}`, class: "menu-row",
        "aria-checked": String(n.key === model.activeKey), "aria-disabled": String(!n.available),
        title: n.why ? t("status.network_unavailable", { source: n.label, reason: n.why }) : "",
        on: { click: () => { if (n.available) onChoose(n.key); } } },
      h("span", { text: n.label }), n.why ? h("span", { class: "muted small", text: n.why }) : null);
      items.push(item);
      parts.push(item);
    }
    parts.push(h("div", { class: "menu-sep", role: "separator" }));
  }
  const stop = h("button", { type: "button", role: "menuitem", id: "mte-pill-stop", class: "link status-stop", text: t("status.scan_stop"),
    "aria-label": t("status.scan_stop_label"), on: { click: onStop } });
  const state = h("div", { class: "menu-state", role: "group", "aria-label": t("status.label") },
    model.state.map((s) => h("div", { class: "menu-line", title: s.title || null }, h("span", { text: s.text }), s.stop ? stop : null)));
  if (model.state.some((s) => s.stop)) items.push(stop);
  parts.push(state);
  if (model.settings) {
    const link = settingsLink(model.settings.path, t("status.settings"), { role: "menuitem", id: "mte-pill-settings", class: "menu-row" });
    items.push(link);
    parts.push(h("div", { class: "menu-sep", role: "separator" }), link);
  }
  const menu = h("div", { class: "pill-menu", role: "menu", id: PILL_MENU_ID, tabIndex: -1, "aria-label": t("status.label"),
    on: { keydown: (e) => {
      const list = items.filter((el) => el.getAttribute("aria-disabled") !== "true");
      const at = list.indexOf(e.target);
      if (e.key === "Escape") { e.preventDefault(); onToggle(false); pill.focus(); }
      if ((e.key === "ArrowDown" || e.key === "ArrowUp") && list.length) {
        e.preventDefault();
        list[(at + (e.key === "ArrowDown" ? 1 : list.length - 1)) % list.length].focus();
      }
    } } }, ...parts);
  return [pill, menu];
}
