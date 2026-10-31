// SPDX-License-Identifier: MIT
// Loader of dev/panel.html (not shipped): a fake `hass` for the real panel element. callWS answers from the anonymized
// sample, keeps the integration's settings and observations in memory (or answers "unknown_command"), and can lose
// the connection on a timer. See dev/panel.html for the query keys.
import "../custom_components/meshroute_topology_explorer/frontend/panel.js";
import { VERSION } from "../custom_components/meshroute_topology_explorer/frontend/panel.js";
import { removedTables, withoutTables } from "../tests/derive.mjs";

const q = new URLSearchParams(location.search);
const flag = (key) => q.get(key) === "1";
const el = document.querySelector("meshroute-topology-explorer");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

if (flag("dark")) document.documentElement.dataset.theme = "dark";
const lang = q.get("lang") || "en";
document.documentElement.lang = lang;

/** Connection stand-in: the events home-assistant-js-websocket's Connection emits ("ready", "disconnected"). */
class FakeConnection extends EventTarget {}
const connection = new FakeConnection();

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
      return flag("empty") ? [] : devices;
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

el.narrow = q.has("narrow") ? flag("narrow") : innerWidth < 870;
el.panel = { url_path: "meshroute-topology", config: { version: q.get("version") === "old" ? "0.0.0" : VERSION } };
el.hass = hass;
addEventListener("resize", () => { if (!q.has("narrow")) el.narrow = innerWidth < 870; });
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
  const id = q.get("select") && byLabel(q.get("select"));
  if (id && flag("collapsed")) { el._view.select(id); el._select(id, "map"); } // as a tap on the map would
  else if (id) el._select(id, "list");
  const tab = q.get("tab");
  if (tab) el._toggleTab(tab, null);
  if (q.get("scroll") === "end") { await sleep(100); el._drawer.body.scrollTop = el._drawer.body.scrollHeight; }
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
    log.push(`${step} -> focus ${describe(root.activeElement)}; selected ${el._selected || "-"}; drawer ${el._drawer.isOpen ? el._drawer.tab : "closed"}; path ${location.pathname}`);
  }
  document.body.dataset.log = log.join(" | ");
}
drive().then(replay);
