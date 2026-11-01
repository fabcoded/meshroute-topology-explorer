// SPDX-License-Identifier: MIT
// Loader of dev/panel.html (not shipped): a fake `hass` for the real panel element. callWS answers from the anonymized
// sample, keeps the integration's settings and observations in memory (or answers "unknown_command"), and can lose
// the connection on a timer. A scan (zha/topology/update) is acted out: afterwards the routers' tables change one after
// another, two seconds apart, and every fifth stays as it was. Reading a cluster's attributes answers with synthetic
// values after a short delay (a sleepy device fails, as one that does not wake up would), and `hass.states` and
// `hass.areas` carry synthetic entity states and area names, never real captures. A small "dev" tab at the top centre
// (not part of the panel) opens a menu of variants (links that reload the page with their query) and three toggles
// that keep the other keys. See dev/panel.html for the query keys.
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
  ["Views", [["Default", ""], ["Narrow (phone)", "phone=1"], ["German locale (texts stay English)", "lang=de"], ["Dark", "dark=1"],
    ["German locale + dark + narrow", "lang=de&dark=1&phone=1"], ["Fill role", "fill=role"], ["Fill power", "fill=power"],
    ["Debug", "debug=1"], ["Labels with HA name", "labels=type,name,ha"], ["Labels: name only", "labels=name"]]],
  ["Panels", [["Left: Devices", "left=devices"], ["Left: Findings", "left=findings"],
    ["Left: Details (Router 03)", "select=Router%2003&left=details"], ["Right: View", "right=view"],
    ["Right: View, coloured", "right=view&colors=1"], ["Right: View, own colours", "right=view&colors=1&bad=0072b2&good=e69f00"],
    ["Right: Legend", "right=legend"], ["Right: Legend, coloured", "right=legend&colors=1"], ["Both panels", "left=devices&right=view"],
    ["Narrow: Devices", "phone=1&left=devices"], ["Narrow: View", "phone=1&right=view"], ["Narrow: Legend", "phone=1&right=legend"]]],
  ["Details", [["Communication: Router 03", "select=Router%2003&left=details"],
    ["Entity: Router 03", "select=Router%2003&left=details&dtab=entity"],
    ["Entity: End device 06 (sleeps)", "select=End%20device%2006&left=details&dtab=entity"],
    ["Cluster: Router 03", "select=Router%2003&left=details&dtab=cluster"],
    ["Cluster popup: On/Off", "select=Router%2003&left=details&dtab=cluster&cluster=0x0006&ep=1&dir=in"],
    ["Cluster popup: read values", "select=Router%2003&left=details&dtab=cluster&cluster=0x0006&ep=1&dir=in&readvalues=1"],
    ["Cluster popup: Level, read", "select=Router%2003&left=details&dtab=cluster&cluster=0x0008&ep=1&dir=in&readvalues=1"],
    ["Cluster popup: sleepy device fails", "select=End%20device%2006&left=details&dtab=cluster&cluster=0x0001&ep=1&dir=in&readvalues=1"],
    ["Cluster popup: manufacturer-specific", "select=Router%2003&left=details&dtab=cluster&cluster=0xfc7c&ep=1&dir=in"],
    ["Assumed return path: Router 02", "select=Router%2002&left=details"],
    ["Source route off: Router 02", "select=Router%2002&left=details&sourceroute=off"]]],
  ["Communication paths", [["Stage 2 overview", "paths=all"], ["Heard-only checkbox, no selection", "heard=1"],
    ["Click with panels closed: End device 06", "select=End%20device%2006&open=off"],
    ["Click, Details on click: End device 06", "select=End%20device%2006&collapsed=1"],
    ["Stage 1 click: Router 11", "select=Router%2011&open=off"],
    ["Stage 2 click: Router 11", "select=Router%2011&open=off&paths=all"],
    ["Stage 1 + heard: Router 11", "select=Router%2011&open=off&heard=1"],
    ["Stage 2 + heard: Router 11", "select=Router%2011&open=off&paths=all&heard=1"],
    ["Stored stage \"heard\" (migration)", "select=Router%2011&open=off&paths=heard"], ["Hover: Router 11", "hover=Router%2011"],
    ["Up and down differ: Router 16", "select=Router%2016"], ["Way down unknown: End device 08", "select=End%20device%2008"],
    ["Stage 2 from a stored node view", "select=Router%2011&nodeview=all"],
    ["Coloured by reception", "select=Router%2016&colors=1"],
    ["Coloured by reception, dark", "select=Router%2016&colors=1&dark=1"]]],
  ["Data variants", [["minus1", "variant=minus1"], ["minus3", "variant=minus3"], ["coordinator-only", "variant=coordinator-only"],
    ["without-coordinator", "variant=without-coordinator"]]],
  ["Errors", [["Not admin", "nonadmin=1"], ["ZHA missing", "nozha=1"], ["No devices", "empty=1"], ["Error", "error=1"],
    ["Connection lost (3 s, back 5 s later)", "lost=3&back=5"]]],
  ["Scan (debug mode)", [["Scan dialog", "scan=dialog"], ["Scan running", "scan=run"],
    ["Scan running, German locale", "scan=run&lang=de"]]],
  ["Settings and version", [["Settings without backend", "settings=unknown"], ["Old version", "version=old"]]],
];
/** Toggles keep every other key: [label, key, value]. */
const TOGGLES = [["Narrow (phone)", "phone", "1"], ["Dark", "dark", "1"], ["German locale", "lang", "de"]];
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

/** The "dev" tab at the top centre and its menu. Text only through DOM nodes; links and checkboxes are native, so Tab
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
    title: "Dev variants (dev page only, not part of the panel)", "aria-expanded": "false", "aria-controls": "dev-menu",
    text: "dev ▾" });
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
if (q.get("paths")) initial.paths = q.get("paths"); // paths=coordinator|all|heard (heard: legacy)
if (q.get("heard")) initial.heard = q.get("heard") === "1";
if (q.get("nodeview")) initial.nodeView = q.get("nodeview"); // nodeview=all: a setting as stored before A4j (migration)
// colors=1: paths coloured by reception; bad, medium, good: own colours as hex without "#" (bad=0072b2).
if (q.get("colors")) {
  const hex = (key) => (q.get(key) ? `#${q.get(key)}` : null);
  initial.pathColors = { mode: q.get("colors") === "1" ? "coloured" : "grey", bad: hex("bad"), medium: hex("medium"), good: hex("good") };
}
if (q.has("labels")) { // labels=type,name,ha: the lines that are on
  const on = q.get("labels").split(",");
  initial.labels = { type: on.includes("type"), name: on.includes("name"), haName: on.includes("ha") };
}
if (q.get("receptioncolors")) initial.receptionColors = true; // a setting as A4g stored it (migration)
if (q.get("sourceroute")) initial.sourceRoute = q.get("sourceroute"); // off | assume
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
    case "zha/devices/clusters/attributes/value": return readAttribute(msg);
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

// ---- synthetic entity states, area names and attribute values (never real captures) --------------------------------

const AREA_NAMES = ["Living room", "Kitchen", "Hall", "Garden", "Office", "Bedroom", "Bathroom", "Garage", "Attic",
  "Cellar", "Workshop", "Terrace"];
const areas = Object.fromEntries(responses["config/area_registry/list"].map((a, i) =>
  [a.area_id, { area_id: a.area_id, name: AREA_NAMES[i % AREA_NAMES.length] }]));

/** A plausible state per entity: lights on with brightness and colour temperature, switches off, sensors get the
 *  device classes their device's clusters suggest, in order. */
function syntheticStates() {
  const states = {};
  for (const d of devices) {
    const inputs = new Set(Object.values((d.signature && d.signature.endpoints) || {}).flatMap((ep) => ep.input_clusters || [])
      .map((c) => parseInt(c, 16)));
    const sensorClasses = [[0x0001, "battery", "%", "87"], [0x0402, "temperature", "°C", "21.4"], [0x0405, "humidity", "%", "48"],
      [0x0400, "illuminance", "lx", "312"], [0x0b04, "power", "W", "4.2"], [0x0702, "energy", "kWh", "12.8"]]
      .filter(([c]) => inputs.has(c));
    let n = 0;
    for (const { entity_id: id } of d.entities || []) {
      const domain = id.split(".")[0];
      const attributes = { friendly_name: id };
      let state = "unknown";
      if (domain === "light") { state = "on"; Object.assign(attributes, { brightness: 180, color_temp_kelvin: 2700 }); }
      else if (domain === "switch") state = "off";
      else if (domain === "binary_sensor") { state = "off"; if (inputs.has(0x0406)) attributes.device_class = "occupancy"; }
      else if (domain === "sensor" && n < sensorClasses.length) {
        const [, cls, unit, value] = sensorClasses[n++];
        Object.assign(attributes, { device_class: cls, unit_of_measurement: unit });
        state = value;
      }
      states[id] = { entity_id: id, state, attributes };
    }
  }
  return states;
}

/** Synthetic answers of ZHA's attribute read: text like ZHA sends it (str() of the value), "None" for attributes a
 *  device does not have; a sleepy device fails like one that does not wake up. readfail=error|timeout forces it. */
const SAMPLE_VALUES = { "0:0": "8", "0:1": "33", "0:4": "Vendor", "0:5": "Model", "0:7": "1", "0:16384": "2.4.5",
  "6:0": "Bool.true", "6:16384": "Bool.true", "6:16385": "0", "6:16386": "0", "6:16387": "255",
  "8:0": "180", "8:1": "0", "8:15": "<bitmap8.0: 0>", "8:16": "None", "8:17": "255", "8:16384": "255",
  "768:7": "370", "768:8": "<ColorMode.Color_temperature: 2>", "768:16394": "<ColorCapabilities.Color_temperature: 16>",
  "768:16395": "250", "768:16396": "454", "1:32": "30", "1:33": "174" };
async function readAttribute(msg) {
  const device = devices.find((d) => d.ieee === msg.ieee);
  await sleep(q.get("readfail") === "timeout" ? 60000 : 350);
  const sleepy = device && device.device_type === "EndDevice";
  if (q.get("readfail") === "error" || sleepy) throw { code: "home_assistant_error", message: "Failed to deliver message (synthetic)" };
  return SAMPLE_VALUES[`${msg.cluster_id}:${msg.attribute}`] || "None";
}

let hass = {
  user: { id: "dev", name: "Dev", is_admin: !flag("nonadmin") },
  language: lang, locale: { language: lang, number_format: "language", time_format: "language" },
  themes: { darkMode: flag("dark"), theme: "default" }, selectedTheme: null,
  connected, connection, callWS, states: syntheticStates(), areas,
};
const push = (patch) => { hass = { ...hass, ...patch }; el.hass = hass; };

el.narrow = flag("phone") || (q.has("narrow") ? flag("narrow") : innerWidth < 870);
el.panel = { url_path: "meshroute-topology", config: { version: q.get("version") === "old" ? "0.0.0" : VERSION } };
el.hass = hass;
addEventListener("resize", () => { if (!q.has("narrow") && !flag("phone")) el.narrow = innerWidth < 870; });
el.addEventListener("hass-toggle-menu", () => console.log("hass-toggle-menu"));
addEventListener("location-changed", () => console.log("navigate", location.pathname + location.search));
el.addEventListener("hass-more-info", (e) => console.log("more-info", e.detail.entityId));

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
  if (flag("debug")) el._setDebug(true);
  // info=1|reload: the density note or the note beside "Read data again" shown.
  if (q.get("info")) el._info = { density: q.get("info") !== "reload", reload: q.get("info") === "reload" };
  // By registry or ZHA name, else by the label the panel shows (the coordinator's is the model's own word).
  const id = q.get("select") && (byLabel(q.get("select"))
    || (el._network.devices.find((d) => d.label === q.get("select")) || {}).id);
  // collapsed=1: as a tap on the map ("Details on click" decides); else as from a finding (selects, no panel).
  if (q.get("dtab")) el._detailsSub = q.get("dtab"); // communication | entity | cluster
  if (id && flag("collapsed")) { el._view.select(id); el._select(id, "map"); }
  else if (id) el._select(id, "findings");
  if (q.get("left")) el._request("left", q.get("left"), null);
  if (q.get("right")) el._request("right", q.get("right"), null);
  // hover=<label>: the device under the pointer, as a mouse over it would set it (the preview of its lanes).
  const hover = q.get("hover")
    && (byLabel(q.get("hover")) || (el._network.devices.find((d) => d.label === q.get("hover")) || {}).id);
  if (hover && el._view && el._view.scene.index.has(hover)) el._view._setHover(el._view.scene.index.get(hover));
  // cluster=0x0006&ep=1&dir=in opens that cluster's details; readvalues=1 then presses "Read values from the device".
  if (q.get("cluster") && id) {
    await sleep(100);
    el._openCluster({ endpoint: Number(q.get("ep") || 1), profile: 0x0104, cluster: parseInt(q.get("cluster"), 16),
      direction: q.get("dir") === "out" ? "out" : "in" }, null);
    if (flag("readvalues") && el._cluster) el._cluster.read();
  }
  const panel = q.get("right") ? el._right : el._left;
  // expand=theory[:n]: the Details card "Paths to other devices" opened, and its first n rows (default 2).
  if (q.get("expand") && q.get("expand").startsWith("theory")) {
    await sleep(100);
    const card = el.shadowRoot.querySelector("details.theory");
    if (card) {
      card.open = true;
      const n = Number(q.get("expand").split(":")[1] || 2);
      [...card.querySelectorAll("details.theory-row")].slice(0, n).forEach((row) => { row.open = true; });
    }
  }
  if (q.get("scroll") === "theory") { // the "Paths to other devices" card to the top of the open panel
    await sleep(100);
    const card = el.shadowRoot.querySelector("details.theory");
    if (card) panel.body.scrollTop += card.getBoundingClientRect().top - panel.body.getBoundingClientRect().top;
  }
  if (q.get("scroll") === "end") { await sleep(100); panel.body.scrollTop = panel.body.scrollHeight; }
  // scan=dialog opens the scan's confirmation; scan=run also confirms it (debug mode is switched on for both).
  if (q.get("scan")) {
    if (!el._debug) el._setDebug(true);
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
    log.push(`${step} -> focus ${describe(root.activeElement)}; selected ${el._selected || "-"}; `
      + `left ${el._left.isOpen ? el._left.tab : "closed"}; right ${el._right.isOpen ? el._right.tab : "closed"}; `
      + `path ${location.pathname}; density ${el._settings && el._settings.settings.density}; `
      + `openDetailsOnSelect ${el._settings && el._settings.settings.openDetailsOnSelect}; `
      + `paths ${el._settings && el._settings.settings.paths}; view ${el._view && el._view.paths}; `
      + `drawn ${el._view && el._view.lastDraw ? `${el._view.lastDraw.lanes} lanes ${JSON.stringify(el._view.lastDraw.classes)}` : "-"}`);
  }
  document.body.dataset.log = log.join(" | ");
}
drive().then(replay);

