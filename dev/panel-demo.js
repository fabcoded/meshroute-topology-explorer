// SPDX-License-Identifier: MIT
// Loader of dev/panel.html (not shipped): a fake `hass` for the real panel element. callWS answers from the anonymized
// sample, keeps the integration's settings and observations in memory (or answers "unknown_command"), and can lose
// the connection on a timer. A scan (zha/topology/update) is acted out: afterwards the routers' tables change one after
// another, two seconds apart, and every fifth stays as it was. A burger button at the left edge opens a menu of variants (links that reload the page
// with their query) and three toggles that keep the other keys. See dev/panel.html for the query keys.
import "../custom_components/meshroute_topology_explorer/frontend/panel.js";
import { VERSION } from "../custom_components/meshroute_topology_explorer/frontend/panel.js";
import { removedTables, withoutTables } from "../tests/derive.mjs";

const q = new URLSearchParams(location.search);
const flag = (key) => q.get(key) === "1";
const el = document.querySelector("meshroute-topology-explorer");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---- variant menu -------------------------------------------------------------------------------------------------

/** Variants of the menu: [group, [[label, query], ...]]. Each link reloads the page with exactly its query. */
const VARIANTS = [
  ["Views", [["Default", ""], ["Narrow (phone)", "phone=1"], ["German", "lang=de"], ["Dark", "dark=1"],
    ["German + dark + narrow", "lang=de&dark=1&phone=1"], ["Fill role", "fill=role"], ["Fill power", "fill=power"],
    ["Debug", "debug=1"], ["Legend collapsed", "legend=closed"], ["Narrow, legend open", "phone=1&legend=open"]]],
  ["Node view", [["Path to coordinator: End device 06", "select=End%20device%2006"],
    ["Up and down differ: Router 16", "select=Router%2016"], ["Way down unknown: End device 08", "select=End%20device%2008"],
    ["All paths: Router 11", "select=Router%2011&nodeview=all"], ["Colour by reception", "select=Router%2016&colors=1"],
    ["Colour by reception, dark", "select=Router%2016&colors=1&dark=1"]]],
  ["Data variants", [["minus1", "variant=minus1"], ["minus3", "variant=minus3"], ["coordinator-only", "variant=coordinator-only"],
    ["without-coordinator", "variant=without-coordinator"]]],
  ["Errors", [["Not admin", "nonadmin=1"], ["ZHA missing", "nozha=1"], ["No devices", "empty=1"], ["Error", "error=1"],
    ["Connection lost (3 s, back 5 s later)", "lost=3&back=5"]]],
  ["Scan (debug mode)", [["Scan dialog", "scan=dialog"], ["Scan running", "scan=run"],
    ["Scan running, German", "scan=run&lang=de"]]],
  ["Settings and version", [["Settings without backend", "settings=unknown"], ["Old version", "version=old"]]],
];
/** Toggles keep every other key: [label, key, value]. */
const TOGGLES = [["Narrow (phone)", "phone", "1"], ["Dark", "dark", "1"], ["German", "lang", "de"]];
/** Keys that only steer this menu, never part of a variant. */
const MENU_KEYS = ["devmenu"];

/** Query as sorted "key=value" pairs, without the menu's own keys (and optionally without the toggle keys). */
function pairs(query, { withoutToggles = false } = {}) {
  const skip = new Set([...MENU_KEYS, ...(withoutToggles ? TOGGLES.map(([, key]) => key) : [])]);
  return [...new URLSearchParams(query)].filter(([key]) => !skip.has(key)).map(([k, v]) => `${k}=${v}`).sort().join("&");
}

/** The variant to mark: the one whose query equals the page's; else the one that equals it apart from the toggles
 *  (minus3 stays marked when Dark is switched on). */
function currentVariant() {
  const all = VARIANTS.flatMap(([, list]) => list);
  const exact = all.find(([, query]) => pairs(query) === pairs(location.search));
  if (exact) return exact;
  const base = pairs(location.search, { withoutToggles: true });
  return all.find(([, query]) => pairs(query, { withoutToggles: true }) === base && pairs(query) === base) || null;
}

/** Burger button at the left edge and its menu. Text only through DOM nodes; links and checkboxes are native, so Tab
 *  reaches everything; Esc closes and returns focus to the button; a press outside or tabbing out closes it. */
function buildVariantMenu() {
  const make = (tag, props = {}, ...children) => {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (key === "text") node.textContent = value;
      else if (key.startsWith("aria-") || key === "role" || key === "id" || key === "for") node.setAttribute(key, value);
      else node[key] = value;
    }
    node.append(...children);
    return node;
  };
  const button = make("button", { type: "button", id: "dev-burger", className: "dev-burger", "aria-label": "Dev variants",
    title: "Dev variants", "aria-expanded": "false", "aria-controls": "dev-menu" }, make("span"), make("span"), make("span"));
  const current = currentVariant();
  const menu = make("div", { id: "dev-menu", className: "dev-menu", hidden: true, role: "dialog", "aria-label": "Dev variants" });
  menu.append(make("h2", { text: "Dev variants" }));

  const toggles = make("fieldset", {}, make("legend", { text: "Toggles (keep the rest)" }));
  for (const [label, key, value] of TOGGLES) {
    const box = make("input", { type: "checkbox", checked: q.get(key) === value });
    box.addEventListener("change", () => {
      const next = new URLSearchParams(location.search);
      for (const k of MENU_KEYS) next.delete(k);
      if (box.checked) next.set(key, value); else next.delete(key);
      if (key === "phone") next.delete("narrow"); // phone sets the narrow flag itself
      location.search = next.toString();
    });
    toggles.append(make("label", { className: "dev-toggle" }, box, make("span", { text: label })));
  }
  menu.append(toggles);

  for (const [group, list] of VARIANTS) {
    menu.append(make("h3", { text: group }));
    menu.append(make("ul", {}, ...list.map((variantEntry) => {
      const [label, query] = variantEntry;
      const link = make("a", { href: query ? `?${query}` : location.pathname, text: label });
      if (variantEntry === current) {
        link.setAttribute("aria-current", "page");
        link.prepend(make("span", { className: "dev-mark", "aria-hidden": "true", text: "\u25CF " }));
      }
      return make("li", {}, link);
    })));
  }

  const close = (focusButton) => {
    if (menu.hidden) return;
    menu.hidden = true;
    button.setAttribute("aria-expanded", "false");
    removeEventListener("pointerdown", outside, true);
    if (focusButton) button.focus();
  };
  const open = (focusFirst) => {
    menu.hidden = false;
    button.setAttribute("aria-expanded", "true");
    addEventListener("pointerdown", outside, true);
    if (focusFirst) (menu.querySelector("[aria-current]") || menu.querySelector("input, a")).focus();
  };
  const outside = (e) => { if (!menu.contains(e.target) && !button.contains(e.target)) close(false); };
  button.addEventListener("click", () => (menu.hidden ? open(true) : close(true)));
  // Tabbing out of the menu closes it, so it never lingers over the panel unnoticed.
  menu.addEventListener("focusout", (e) => {
    if (e.relatedTarget && !menu.contains(e.relatedTarget) && e.relatedTarget !== button) close(false);
  });
  menu.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    close(true);
  });
  document.body.append(button, menu);
  if (flag("devmenu")) open(false);
}

// ---- page setup ------------------------------------------------------------------------------------------------

if (flag("dark")) document.documentElement.dataset.theme = "dark";
const lang = q.get("lang") || "en";
document.documentElement.lang = lang;
// phone=1: the panel in a 390 × 844 frame, with Home Assistant's narrow flag, as on a phone.
if (flag("phone")) document.body.classList.add("phone");
buildVariantMenu(); // before the sample loads, so the menu is there even if loading fails

/** Connection stand-in: the events home-assistant-js-websocket's Connection emits ("ready", "disconnected"). */
/** Connection stand-in: the events home-assistant-js-websocket's Connection emits ("ready", "disconnected") and its
 *  fire-and-forget sendMessage, which the panel uses for the scan. */
class FakeConnection extends EventTarget {
  sendMessage(message) {
    if (!connected) throw lost();
    if (message.type === "zha/topology/update") {
      scanStartedAt = Date.now();
      console.log("scan started");
    }
  }
}
const connection = new FakeConnection();
let scanStartedAt = null;

/** The tables as ZHA has them now: during an acted-out scan, router i answers 2 s × i after the start with a slightly
 *  different first LQI (every fifth answers with the same table). */
function currentDevices() {
  if (scanStartedAt === null) return devices;
  const elapsed = Date.now() - scanStartedAt;
  let router = 0;
  return devices.map((d) => {
    if (d.device_type !== "Router" || !d.neighbors.length) return d;
    router += 1;
    if (elapsed < router * 2000 || router % 5 === 0) return d;
    const [first, ...rest] = d.neighbors;
    return { ...d, neighbors: [{ ...first, lqi: String(Math.max(1, Number(first.lqi) - 3)) }, ...rest] };
  });
}

const fixture = await (await fetch("../tests/fixtures/zha-sample.json")).json();
const responses = fixture.responses;
let devices = responses["zha/devices"];
const variant = q.get("variant");
if (variant) devices = withoutTables(devices, removedTables(devices)[variant] || []);

const byLabel = (label) => {
  const entry = responses["config/device_registry/list"].find((e) => e.name_by_user === label || e.name === label);
  const zha = devices.find((d) => d.user_given_name === label || d.model === label || (entry && d.device_reg_id === entry.id));
  return zha ? zha.ieee : null;
};

const initial = {};
if (q.get("fill")) initial.fill = q.get("fill");
if (q.get("density")) initial.density = q.get("density");
if (q.get("open")) initial.openDetailsOnSelect = q.get("open") === "on";
if (q.get("links")) initial.links = Object.fromEntries(["up", "route", "heard"].map((c) => [c, q.get("links").split(",").includes(c)])); // links=up,route
if (q.get("legend")) initial.legendOpen = q.get("legend") === "open";
if (q.get("nodeview")) initial.nodeView = q.get("nodeview"); // nodeview=all|coordinator
if (q.get("colors")) initial.receptionColors = q.get("colors") === "1";
if (q.get("pin") && byLabel(q.get("pin"))) initial.pins = { [byLabel(q.get("pin"))]: [2.2, -1.6] };
const store = { settings: new Map(), observations: new Map() };

let connected = !flag("downfirst");
const lost = () => ({ type: "result", success: false, error: { code: 3, message: "Connection lost" } });

async function callWS(msg) {
  await sleep(40);
  if (!connected) throw lost();
  const unknown = { code: "unknown_command", message: "Unknown command." };
  switch (msg.type) {
    case "config_entries/get": return flag("nozha") ? [] : responses["config_entries/get"];
    case "zha/devices":
      if (flag("error")) throw { code: "home_assistant_error", message: "ZHA did not answer" };
      return flag("empty") ? [] : currentDevices();
    case "config/device_registry/list": return responses["config/device_registry/list"];
    case "config/area_registry/list": return responses["config/area_registry/list"];
    case "meshroute_topology_explorer/settings/get":
      if (q.get("settings") === "unknown") throw unknown;
      return { settings: store.settings.has(msg.network) ? store.settings.get(msg.network) : (Object.keys(initial).length ? initial : null) };
    case "meshroute_topology_explorer/settings/set":
      if (q.get("settings") === "unknown") throw unknown;
      store.settings.set(msg.network, msg.settings);
      console.log("settings saved", JSON.stringify(msg.settings));
      return {};
    case "meshroute_topology_explorer/observations/get":
      if (q.get("settings") === "unknown") throw unknown;
      return { observations: store.observations.get(msg.network) || null };
    case "meshroute_topology_explorer/observations/set":
      if (q.get("settings") === "unknown") throw unknown;
      store.observations.set(msg.network, msg.observations);
      return {};
    default:
      throw unknown;
  }
}

let hass = {
  user: { id: "dev", name: "Dev", is_admin: !flag("nonadmin") },
  language: lang, locale: { language: lang, number_format: "language", time_format: "language" },
  themes: { darkMode: flag("dark"), theme: "default" }, selectedTheme: null,
  connected, connection, callWS,
};
const push = (patch) => { hass = { ...hass, ...patch }; el.hass = hass; };

el.narrow = flag("phone") || (q.has("narrow") ? flag("narrow") : innerWidth < 870);
el.panel = { url_path: "meshroute-topology", config: { version: q.get("version") === "old" ? "0.0.0" : VERSION } };
el.hass = hass;
addEventListener("resize", () => { if (!q.has("narrow") && !flag("phone")) el.narrow = innerWidth < 870; });
el.addEventListener("hass-toggle-menu", () => console.log("hass-toggle-menu"));
addEventListener("location-changed", () => console.log("navigate", location.pathname));

// Every few seconds a new hass object, as Home Assistant does on state changes: must not reload anything.
setInterval(() => push({}), 2000);

// switchdark=<s>: Home Assistant switches to the dark theme after s seconds (variables first, then a new hass).
if (q.get("switchdark")) {
  setTimeout(() => {
    document.documentElement.dataset.theme = "dark";
    push({ themes: { darkMode: true, theme: "default" } });
  }, Number(q.get("switchdark")) * 1000);
}

const back = q.has("back") ? Number(q.get("back")) : 4;
function goDown() { connected = false; push({ connected: false }); connection.dispatchEvent(new Event("disconnected")); }
function comeBack() { connected = true; push({ connected: true }); connection.dispatchEvent(new Event("ready")); }
if (flag("downfirst") && back > 0) setTimeout(comeBack, back * 1000);
if (q.get("lost")) {
  setTimeout(() => {
    goDown();
    if (back > 0) setTimeout(comeBack, back * 1000);
  }, Number(q.get("lost")) * 1000);
}

// Drive the panel into a state for screenshots once the data is in (dev only: uses the element's internals).
async function drive() {
  for (let i = 0; i < 100 && !el._network; i++) await sleep(50);
  if (!el._network) return;
  if (flag("debug")) el._onMenu("debug");
  if (flag("linksopen")) el._options.linksPanel.open();
  if (flag("nodeviewopen")) el._options.nodeViewMenu.open();
  // By registry or ZHA name, else by the label the panel shows (the coordinator's is the model's own word).
  const id = q.get("select") && (byLabel(q.get("select"))
    || (el._network.devices.find((d) => d.label === q.get("select")) || {}).id);
  if (id && flag("collapsed")) { el._view.select(id); el._select(id, "map"); } // as a tap on the map would
  else if (id) el._select(id, "list");
  const tab = q.get("tab");
  if (tab) el._toggleTab(tab, null);
  if (q.get("scroll") === "end") { await sleep(100); el._drawer.body.scrollTop = el._drawer.body.scrollHeight; }
  // scan=dialog opens the scan's confirmation; scan=run also confirms it (debug mode is switched on for both).
  if (q.get("scan")) {
    if (!el._debug) el._onMenu("debug");
    el._startScan();
    await sleep(100);
    if (q.get("scan") === "run") el.shadowRoot.querySelector("dialog.confirm .primary").click();
  }
}

/** steps=click:<selector>;focus:<selector>;key:<Key>;wait:<ms>;note:<text> replays input inside the panel and records
 *  after each step which element has focus, what is selected and which tab is open, in body[data-log] (read it with
 *  the browser's --dump-dom). A synthetic Enter on a button clicks it, as a real key press would. */
async function replay() {
  const list = q.get("steps");
  if (!list) return;
  const root = el.shadowRoot;
  const log = [];
  const describe = (n) => (n ? `${n.tagName.toLowerCase()}${n.className ? "." + String(n.className).split(" ")[0] : ""}` +
    `${n.getAttribute("role") ? "[" + n.getAttribute("role") + "]" : ""}${n.textContent && n.tagName === "BUTTON" ? "(" + n.textContent.trim().slice(0, 20) + ")" : ""}` : "none");
  for (const step of list.split(";")) {
    const at = step.indexOf(":");
    const op = step.slice(0, at);
    const arg = step.slice(at + 1);
    if (op === "click") root.querySelector(arg).click();
    else if (op === "focus") root.querySelector(arg).focus();
    else if (op === "key") {
      const target = root.activeElement || el;
      const handled = !target.dispatchEvent(new KeyboardEvent("keydown", { key: arg, bubbles: true, composed: true, cancelable: true }));
      if (!handled && (arg === "Enter" || arg === " ") && target.tagName === "BUTTON") target.click();
    }
    await sleep(op === "wait" ? Number(arg) : 150);
    log.push(`${step} -> focus ${describe(root.activeElement)}; selected ${el._selected || "-"}; drawer ${el._drawer.isOpen ? el._drawer.tab : "closed"}; path ${location.pathname}; `
      + `density ${el._settings && el._settings.settings.density}; legendOpen ${el._settings && el._settings.settings.legendOpen}`);
  }
  document.body.dataset.log = log.join(" | ");
}
drive().then(replay);

