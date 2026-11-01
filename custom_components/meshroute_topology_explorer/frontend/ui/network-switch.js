// SPDX-License-Identifier: MIT
// Which network the map shows, Zigbee (ZHA) or Thread (Matter), and the control that switches it (owner request
// 2026-11-01 "how would we switch it in our app?"; board design "Variant A" by the design agent, not yet approved by
// the owner): with two or more networks the first part of the status line ("Source: ZHA") is a chip with a caret that
// opens a small menu upward; with one network it stays plain text, no extra element. A network that cannot be read
// is a greyed entry with the reason. sourcePart() is the one place that builds the control, so the approved design
// can replace it. The choice is stored under the reserved network id PANEL_STORE through the integration's settings
// commands (spec 10, 11); settings of each network stay under its own id. Runs in the browser; the choice logic is
// pure and tested in Node: node --test tests/
import { h } from "./dom.js";

/** Networks the panel can show, in menu order. */
export const NETWORK_KEYS = Object.freeze(["zha", "thread"]);
/** The first load shows Zigbee (board Variant A). */
export const DEFAULT_NETWORK = "zha";
/** Reserved network id for settings of the panel itself (the chosen network); valid under spec 10's id rule. */
export const PANEL_STORE = "panel";

/** Menu entries from the controller state: [{ key, available, reason?, message? }]. ZHA is listed when it was read;
 *  Thread when the Matter integration is loaded, greyed with its reason when its topology could not be used. */
export function networkChoices(state) {
  const networks = (state && state.networks) || {};
  const thread = (state && state.thread) || null;
  const out = [];
  if (networks.zha) out.push({ key: "zha", available: true });
  if (networks.thread) out.push({ key: "thread", available: true });
  else if (thread && thread.status && thread.status !== "not_loaded" && thread.status !== "ok") {
    out.push({ key: "thread", available: false, reason: thread.status, message: thread.message || null });
  }
  return out;
}

/** The network to show: the wanted one if it can be shown, else the first that can; null if none. */
export function activeNetwork(choices, wanted) {
  const usable = choices.filter((c) => c.available);
  return (usable.find((c) => c.key === wanted) || usable.find((c) => c.key === DEFAULT_NETWORK) || usable[0] || {}).key || null;
}

/** The stored choice ("zha" | "thread"), or null when none is stored or the store cannot be read. */
export async function loadNetworkChoice(callWS) {
  try {
    const result = await callWS({ type: "meshroute_topology_explorer/settings/get", network: PANEL_STORE });
    const value = result && result.settings && result.settings.network;
    return NETWORK_KEYS.includes(value) ? value : null;
  } catch {
    return null;
  }
}

/** Store the choice by read-merge-write (keys the panel does not know are kept); failures leave it in memory. */
export async function saveNetworkChoice(callWS, key) {
  try {
    const result = await callWS({ type: "meshroute_topology_explorer/settings/get", network: PANEL_STORE });
    const stored = result && result.settings && typeof result.settings === "object" ? result.settings : {};
    await callWS({ type: "meshroute_topology_explorer/settings/set", network: PANEL_STORE,
      settings: { ...stored, network: key } });
    return true;
  } catch {
    return false;
  }
}

/** Why a network cannot be shown, as a text key and its parameters. */
function reasonText(choice, t) {
  if (choice.reason === "not_supported") return t("status.thread_not_supported");
  if (choice.reason === "empty") return t("status.thread_empty");
  return t("status.thread_error", { message: choice.message || "?" });
}

/** The status line's source part (the one place that builds the switch). ctx: { t, choices, active, open (menu
 *  shown), compact, onToggle(open), onChoose(key) }. One choice or none: plain text "Source: X". */
export function sourcePart({ t, choices, active, open = false, compact = false, onToggle, onChoose }) {
  const name = (key) => t(`source.${key}`);
  const label = t("status.source", { source: name(active) });
  if (!choices || choices.length < 2) {
    return h("span", { class: "part sep", text: compact ? name(active) : label });
  }
  const menuId = "mte-network-menu";
  const chip = h("button", { type: "button", class: "network-chip", "aria-haspopup": "menu", "aria-expanded": String(open),
    "aria-controls": menuId, "aria-label": t("status.network_menu", { source: name(active) }),
    on: { click: () => onToggle(!open) } },
  h("span", { text: compact ? name(active) : label }), h("span", { class: "caret", "aria-hidden": "true", text: "▴" }));
  const wrap = h("span", { class: "part sep network-switch" }, chip);
  if (!open) return wrap;
  const items = choices.map((c) => {
    const why = c.available ? null : reasonText(c, t);
    const item = h("button", { type: "button", role: "menuitemradio", class: "network-item",
      "aria-checked": String(c.key === active), "aria-disabled": String(!c.available),
      title: why ? t("status.network_unavailable", { source: name(c.key), reason: why }) : "",
      on: { click: () => { if (c.available) onChoose(c.key); } } },
    h("span", { text: name(c.key) }), why ? h("span", { class: "muted small", text: why }) : null);
    return item;
  });
  const menu = h("div", { class: "network-menu", role: "menu", id: menuId,
    on: { keydown: (e) => {
      const list = items.filter((el) => el.getAttribute("aria-disabled") !== "true");
      const at = list.indexOf(e.target);
      if (e.key === "Escape") { e.preventDefault(); onToggle(false); chip.focus(); }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const next = list[(at + (e.key === "ArrowDown" ? 1 : list.length - 1)) % list.length];
        if (next) next.focus();
      }
    } } }, ...items);
  wrap.append(menu);
  return wrap;
}
