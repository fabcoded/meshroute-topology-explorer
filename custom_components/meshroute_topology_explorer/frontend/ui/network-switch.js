// SPDX-License-Identifier: MIT
// Which network the map shows, Zigbee (ZHA) or Thread (Matter), and the control that switches it (board design
// "Variant A", not yet approved): with two or more networks the first part of the status line ("Source: ZHA") is a chip with a caret that
// opens a small menu upward; with one network it stays plain text, no extra element. A network that cannot be read
// is a greyed entry with the reason. sourcePart() is the one place that builds the control, so the approved design
// can replace it. The choice is stored under the reserved network id PANEL_STORE through the integration's settings
// commands (spec 10, 11); settings of each network stay under its own id. Runs in the browser; the choice logic is
// pure and tested in Node: npm test
import { h } from "./dom.js";
import { ADAPTERS, adapterByKey } from "../adapters/index.js";

/** Networks the panel can show, in menu order: one per adapter (adapters/index.js); the keys are stored values. */
export const NETWORK_KEYS = Object.freeze(ADAPTERS.map((a) => a.key));
/** The first load shows the first adapter's network, Zigbee (board Variant A). */
export const DEFAULT_NETWORK = NETWORK_KEYS[0];
/** Reserved network id for settings of the panel itself (the chosen network); valid under spec 10's id rule. */
export const PANEL_STORE = "panel";

/** Menu entries from the controller state: [{ key, available, reason?, message? }], in the adapters' order. A network
 *  is listed when it was read; a source that could not be used is listed greyed with its reason where its adapter
 *  says so (the Matter topology: not supported, empty or an error; never ZHA). */
export function networkChoices(state) {
  const networks = (state && state.networks) || {};
  const reads = (state && state.reads) || {};
  const out = [];
  for (const adapter of ADAPTERS) {
    const read = reads[adapter.key] || null;
    if (networks[adapter.key]) out.push({ key: adapter.key, available: true });
    else if (adapter.unavailable(read)) {
      out.push({ key: adapter.key, available: false, reason: read.status, message: read.message || null });
    }
  }
  return out;
}

/** The network to show: the wanted one if it can be shown, else the first that can; null if none. */
export function activeNetwork(choices, wanted) {
  const usable = choices.filter((c) => c.available);
  return (usable.find((c) => c.key === wanted) || usable.find((c) => c.key === DEFAULT_NETWORK) || usable[0] || {}).key || null;
}

/** The stored choice (one of NETWORK_KEYS), or null when none is stored or the store cannot be read. */
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

/** Why a network cannot be shown, in its adapter's words. */
function reasonText(choice, t) {
  return adapterByKey(choice.key).reasonText(choice, t);
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
