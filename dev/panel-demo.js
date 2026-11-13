// SPDX-License-Identifier: MIT
// Loader of dev/panel.html (not shipped): a fake `hass` for the real panel element. callWS answers from the anonymized
// sample, keeps the integration's settings and observations in memory, and can lose
// the connection on a timer. A scan (zha/topology/update) is acted out: afterwards the routers' tables change one after
// another, two seconds apart, and every fifth stays as it was. Reading a cluster's attributes answers with synthetic
// values after a short delay (a sleepy device fails, as one that does not wake up would), and `hass.states` and
// `hass.areas` carry synthetic entity states and area names, never real captures. A small "dev" tab at the top centre
// (not part of the panel) opens a menu of variants (links that reload the page with their query) and three toggles
// that keep the other keys. See dev/panel.html for the query keys.
import { removedTables, withoutTables } from "../tests/derive.mjs";
// The fake zigpy route records reuse the Zigbee engine's sources, also with bundle=1: they stand in for Home Assistant.
import { fakeZigpyRoutes } from "../tests/zigpy-fake.mjs";

const q = new URLSearchParams(location.search);
const flag = (key) => q.get(key) === "1";
const el = document.querySelector("meshroute-topology-explorer");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// Uncaught errors and rejected promises go to body[data-errors] for tools/smoke.py (a failed import leaves data-log unset).
const noteError = (what) => { document.body.dataset.errors = `${document.body.dataset.errors || ""}${what} | `; };
addEventListener("error", (e) => noteError(e.message));
addEventListener("unhandledrejection", (e) => noteError(String(e.reason)));
// bundle=1 loads the shipped bundle (frontend/dist/panel.js, what Home Assistant serves; issue #16) instead of the
// sources, never both: the panel defines its element only if the name is free, so the copy loaded first would win.
const FRONT = "../custom_components/meshroute_topology_explorer/frontend";
const { VERSION } = await import(flag("bundle") ? `${FRONT}/dist/panel.js` : `${FRONT}/panel.js`);
// The cluster dialog's modules load on first use (cluster=), so bundle=1 does not fetch them beside the bundle.
const sourceModule = (path) => import(`${FRONT}/${path}`);
// The panel modules this page fetched, for the state line: tools/smoke.py checks that bundle=1 loads no source copy.
const panelModules = () => performance.getEntriesByType("resource").map((r) => new URL(r.name).pathname)
  .filter((path) => /\/frontend\/(dist\/)?panel\.js$/.test(path)).map((path) => path.split("/frontend/")[1]).join("+") || "-";

// ---- variant menu -------------------------------------------------------------------------------------------------

/** Variants of the menu: [group, [[label, query], ...]]. Each link reloads the page with exactly its query. */
const VARIANTS = [
  ["Views", [["Default", ""], ["Narrow (phone)", "phone=1"], ["German locale (texts stay English)", "lang=de"], ["Dark", "dark=1"],
    ["German locale + dark + narrow", "lang=de&dark=1&phone=1"], ["Fill role", "fill=role"], ["Fill power", "fill=power"],
    ["Debug", "debug=1"], ["Labels with HA name", "labels=type,name,ha"], ["Labels: name only", "labels=name"]]],
  ["Thread (Matter)", [["Thread map", "network=thread"], ["Zigbee with the switch", "matter=1"],
    ["Thread: details of the leader", "network=thread&select=Matter%20node%2014&left=details"],
    ["Thread routes (synthetic, #11)", "matter=routes&network=thread"],
    ["Thread routes: Motion sensor selected", "matter=routes&network=thread&select=Motion%20sensor&left=details"],
    ["Thread routes: Plug 1, unused routes", "matter=routes&network=thread&select=Plug%201&left=details&right=view&unused=1"],
    ["Thread: View tab", "network=thread&right=view"], ["Thread: Legend", "network=thread&right=legend"],
    ["Matter too old", "matter=notsupported"], ["Narrow: Thread", "phone=1&network=thread"],
    ["Thread only", "nozha=1&matter=1"], ["Thread only: View tab", "nozha=1&matter=1&right=view"],
    ["ZHA error, Thread shown", "error=1&matter=1"], ["Thread only, Matter too old", "nozha=1&matter=notsupported"],
    ["ZHA error, Matter too old", "error=1&matter=notsupported"], ["ZHA not running, Thread shown", "zhastate=setup_retry&matter=1"],
    ["Matter not running", "matterstate=setup_retry&matter=1"],
    ["Neither running", "zhastate=setup_error&matterstate=setup_retry&matter=1"]]],
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
    ["Source route off: Router 02", "select=Router%2002&left=details&sourceroute=off"],
    ["Route record from zigpy: Router 02", "select=Router%2002&left=details&sourceroute=zigpy"],
    ["Route record differs: Router 16", "select=Router%2016&left=details&sourceroute=zigpy"],
    ["zigpy not available", "sourceroute=zigpy&zigpy=unsupported&right=view"]]],
  ["Communication paths", [["Stage 2 overview", "paths=all"], ["Heard-only checkbox, no selection", "paths=table&heard=1"],
    ["Click with panels closed: End device 06", "select=End%20device%2006&open=off"],
    ["Click, Details on click: End device 06", "select=End%20device%2006&collapsed=1"],
    ["Stage 1 click: Router 11", "select=Router%2011&open=off"],
    ["Stage 2 click: Router 11", "select=Router%2011&open=off&paths=all"],
    ["Stage 1, heard stored (draws nothing): Router 11", "select=Router%2011&open=off&heard=1"],
    ["Routing table overview", "paths=table"], ["Routing table click: Router 13", "select=Router%2013&paths=table&left=details"],
    ["Routing table with return routes: Router 13", "select=Router%2013&paths=table&returns=1&left=details"],
    ["Routing table + heard: Router 13", "select=Router%2013&paths=table&returns=1&heard=1"],
    ["Routing table, end device: End device 06", "select=End%20device%2006&paths=table&left=details"],
    ["Hover: Router 11", "hover=Router%2011"],
    ["Up and down differ: Router 16", "select=Router%2016"], ["Way down unknown: End device 08", "select=End%20device%2008"],
    ["Coloured by reception", "select=Router%2016&colors=1"],
    ["Coloured by reception, dark", "select=Router%2016&colors=1&dark=1"]]],
  ["Data variants", [["minus1", "variant=minus1"], ["minus3", "variant=minus3"], ["coordinator-only", "variant=coordinator-only"],
    ["without-coordinator", "variant=without-coordinator"]]],
  ["Errors", [["Not admin", "nonadmin=1"], ["Neither ZHA nor Matter", "nozha=1"], ["No devices", "empty=1"], ["Error", "error=1"],
    ["Connection lost (3 s, back 5 s later)", "lost=3&back=5"]]],
  ["Scan (debug mode)", [["Scan dialog", "scan=dialog"], ["Scan running", "scan=run"],
    ["Scan running, German locale", "scan=run&lang=de"]]],
  ["Settings and version", [["Old version", "version=old"]]],
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
// inset=<bottom> or inset=<top>,<bottom> in px (#4; one value: status bar 24 px on top): the system insets as Home Assistant hands them to a panel. The root carries --safe-area-inset-*
// (the app sets --app-safe-area-inset-*, the frontend derives these, main.globals.ts) and ha-panel-custom pads its
// container with them (src/panels/custom/ha-panel-custom.ts, _createPanel, panel without handle_safe_area).
if (q.has("inset")) {
  const root = document.documentElement.style;
  const given = q.get("inset").split(",").map(Number);
  root.setProperty("--safe-area-inset-top", `${given.length > 1 ? given[0] : 24}px`);
  root.setProperty("--safe-area-inset-bottom", `${given[given.length - 1]}px`);
  root.setProperty("--safe-area-inset-left", "0px");
  root.setProperty("--safe-area-inset-right", "0px");
  document.body.classList.add("inset");
  const container = document.createElement("div");
  Object.assign(container.style, { display: "block", boxSizing: "border-box", paddingTop: "var(--safe-area-inset-top)",
    paddingBottom: "var(--safe-area-inset-bottom)", paddingLeft: "var(--safe-area-inset-left)", paddingRight: "var(--safe-area-inset-right)" });
  el.replaceWith(container);
  container.append(el);
}
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

  /** thread/discover_routers (#20) with matter=borderrouters: the fixture's events before the result, the rest 20 ms
   *  after it; any other sample answers like a Home Assistant without the Thread integration. */
  async subscribeMessage(callback, message) {
    const events = matterResponses && matterResponses[message.type];
    if (!connected) throw lost().error;
    if (!events) throw { code: "unknown_command", message: "Unknown command." };
    for (const e of events.before_result) callback(e);
    setTimeout(() => { for (const e of events.after_result) callback(e); }, 20);
    return async () => console.log("unsubscribed", message.type);
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

// capture=<name> loads a real capture from captures/<name>.json instead of the anonymized sample. captures/ is
// git-ignored: real captures stay on the developer's machine (AGENTS.md, privacy), so the page shows real names
// (name_by_user) without committing them. Only a plain file name is accepted.
const captureName = q.get("capture");
const fixtureUrl = captureName && /^[A-Za-z0-9._-]+$/.test(captureName) ? `../captures/${captureName}.json`
  : "../tests/fixtures/zha-sample.json";
const fixture = await (await fetch(fixtureUrl)).json();
// A Matter capture (capture=matter-...) has no ZHA part: ZHA then comes from the sample.
const responses = fixture.responses["zha/devices"] ? fixture.responses
  : (await (await fetch("../tests/fixtures/zha-sample.json")).json()).responses;
// Thread through Matter: matter=1 loads the Matter integration with the anonymized Matter sample,
// matter=notsupported answers like a Matter server too old for the topology; network=thread starts on Thread (as a
// stored choice); a capture that holds a Matter topology implies both, with its own (real) data.
const captureTopology = fixture.responses["matter/network_topology"] || null;
// matter=routes: the synthetic network with route tables (tests/thread-routes-fixture.mjs, #11), answering
// thread_tables too; the other samples have no tables, so the panel shows why there are no routes.
const matterMode = captureTopology ? "1" : q.get("matter") || (q.get("network") === "thread" ? "1" : null);
const routesSample = matterMode === "routes" ? (await import("../tests/thread-routes-fixture.mjs"))
  .threadRoutesSample({ readAt: Math.round(Date.now() / 1000) }) : null; // read now: tables 1, 3 and 21 h unchanged
const matterResponses = captureTopology ? fixture.responses
  : routesSample ? { "matter/network_topology": routesSample.topology, "config/device_registry/list": routesSample.registry,
    "meshroute_topology_explorer/thread_tables": routesSample.tables }
    : matterMode === "1" ? (await (await fetch("../tests/fixtures/matter-sample.json")).json()).responses
      : matterMode === "borderrouters" ? (await (await fetch("../tests/fixtures/thread-border-routers.json")).json()).responses
        : null;
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
if (q.get("factor")) initial.densityFactor = Number(q.get("factor")); // with density=custom
if (q.get("open")) initial.openDetailsOnSelect = q.get("open") === "on";
if (q.get("paths")) initial.paths = q.get("paths"); // paths=coordinator|table|all
if (q.get("heard")) initial.heard = q.get("heard") === "1";
if (q.get("returns")) initial.returnRoutes = q.get("returns") === "1"; // "include return routes" of the view "table"
if (q.get("unused")) initial.unusedRoutes = q.get("unused") === "1"; // Thread: "unused routes" (#11)
// colors=1: paths coloured by reception; bad, medium, good: own colours as hex without "#" (bad=0072b2).
if (q.get("colors")) {
  const hex = (key) => (q.get(key) ? `#${q.get(key)}` : null);
  initial.pathColors = { mode: q.get("colors") === "1" ? "coloured" : "grey", bad: hex("bad"), medium: hex("medium"), good: hex("good") };
}
if (q.has("labels")) { // labels=type,name,ha: the lines that are on
  const on = q.get("labels").split(",");
  initial.labels = { type: on.includes("type"), name: on.includes("name"), haName: on.includes("ha") };
}
if (q.get("sourceroute")) initial.sourceRoute = q.get("sourceroute"); // off | assume | zigpy
if (q.get("pin") && byLabel(q.get("pin"))) initial.pins = { [byLabel(q.get("pin"))]: [2.2, -1.6] };
// history=<name>: the reception history the window reads, from captures/<name>.json (git-ignored, real) or `sample` (the
// committed tests/fixtures/zha-history-sample.json, the default); history=none: nothing recorded yet; history=off:
// recording is off; history=long: tests/fixtures/zha-history-sample-long.json (7 days, 6 h steps, made with
// `node tools/history_synth.mjs --sample --days 7 --step-hours 6`); history=unsupported: the source reported a problem; keep=<days>: the "Keep for" option (default 90).
// Records are shifted so the newest lies 6 h back (ranges then work as live) once the newest is older than 48 h.
const historyName = q.get("history") || "sample";
const historyUrl = historyName === "sample" ? "../tests/fixtures/zha-history-sample.json"
  : historyName === "long" ? "../tests/fixtures/zha-history-sample-long.json"
  : /^[A-Za-z0-9._-]+$/.test(historyName) && !["none", "off", "unsupported"].includes(historyName) ? `../captures/${historyName}.json` : null;
const historyFile = historyUrl ? await (await fetch(historyUrl)).json() : { k: [], records: [] };
const historyTimes = historyFile.records.filter((r) => Number.isFinite(r.t)).map((r) => r.t);
const historyNewest = historyTimes.length ? Math.max(...historyTimes) : 0;
// Shifted once the newest record is older than 48 h, the shortest range: between 48 h and a week the default range
// was empty and the smoke journey "pair window: Route, Mesh" found no Mesh switch (2026-11-09).
const historyShift = historyTimes.length && Date.now() / 1000 - historyNewest > 2 * 86400 ? Math.round(Date.now() / 1000) - 6 * 3600 - historyNewest : 0;
function historyRecords(msg) {
  let full = null;
  const out = [];
  for (const r of historyFile.records) {
    if (!Number.isFinite(r.t)) continue;
    if (r.e) full = r;
    const t = r.t + historyShift;
    if (t < msg.since || t > msg.until) continue;
    // The first record of an answer is always a full one (spec 10.2).
    out.push(!out.length && !r.e && full ? { ...full, t } : { ...r, t });
  }
  return { k: historyFile.k, records: out };
}
const store = { settings: new Map(), observations: new Map() };
if (q.get("network") === "thread" || captureTopology) store.settings.set("panel", { network: "thread" });

let connected = !flag("downfirst");
const lost = () => ({ type: "result", success: false, error: { code: 3, message: "Connection lost" } });

/** The Matter sample's answer to `msg`, or `error` thrown where the sample has none. */
function sampleAnswer(msg, error) {
  if (!matterResponses || !matterResponses[msg.type]) throw error;
  return matterResponses[msg.type];
}

async function callWS(msg) {
  await sleep(40);
  if (!connected) throw lost();
  const unknown = { code: "unknown_command", message: "Unknown command." };
  switch (msg.type) {
    case "config_entries/get":
      // zhastate= / matterstate=: the entry is set up but in that state (setup_retry, setup_error: not running).
      if (msg.domain === "matter") {
        return matterMode ? [{ entry_id: "entry_matter", domain: "matter", title: "", state: q.get("matterstate") || "loaded" }] : [];
      }
      if (q.get("zhastate")) return responses["config_entries/get"].map((e) => ({ ...e, state: q.get("zhastate") }));
      return flag("nozha") ? [] : responses["config_entries/get"];
    case "matter/network_topology":
      // The panel must never ask for a refresh (radio traffic): the fake refuses it loudly.
      if (msg.refresh !== false) throw { code: "invalid_format", message: "dev page: refresh must be false" };
      if (matterMode === "notsupported") throw { code: "not_supported", message: "Matter server too old" };
      if (!matterResponses) throw unknown;
      return matterResponses["matter/network_topology"];
    case "meshroute_topology_explorer/thread_tables":
      return sampleAnswer(msg, { code: "not_supported", message: "dev page: this sample has no Thread tables" });
    case "thread/list_datasets": return sampleAnswer(msg, unknown);
    case "zha/devices":
      if (flag("error")) throw { code: "home_assistant_error", message: "ZHA did not answer" };
      return flag("empty") ? [] : currentDevices();
    case "config/device_registry/list":
      return [...responses["config/device_registry/list"], ...((matterResponses && matterResponses["config/device_registry/list"]) || [])];
    case "config/area_registry/list": return responses["config/area_registry/list"];
    case "zha/devices/clusters/attributes/value": return readAttribute(msg);
    case "meshroute_topology_explorer/settings/get":
      return { settings: store.settings.has(msg.network) ? store.settings.get(msg.network) : (Object.keys(initial).length ? initial : null) };
    case "meshroute_topology_explorer/settings/set":
      store.settings.set(msg.network, msg.settings);
      console.log("settings saved", JSON.stringify(msg.settings));
      return {};
    case "meshroute_topology_explorer/observations/get":
      return { observations: store.observations.get(msg.network) || null };
    case "meshroute_topology_explorer/zigpy_routes":
      // Synthetic route records (tests/zigpy-fake.mjs): every complete way up, two of them broken on purpose.
      if (q.get("zigpy") === "unsupported") throw { code: "not_supported", message: "zha_not_loaded: ZHA is not loaded" };
      return fakeZigpyRoutes(currentDevices());
    case "meshroute_topology_explorer/history/records":
      return historyRecords(msg);
    case "meshroute_topology_explorer/history/info":
      return { records: historyFile.records.length, first: historyTimes.length ? Math.min(...historyTimes) + historyShift : null,
        last: historyTimes.length ? Math.max(...historyTimes) + historyShift : null, bytes: 0,
        problems: { zha: historyName === "unsupported" ? "zha/devices: handler not found" : null, thread: null },
        record: historyName !== "off",
        keep_days: Number(q.get("keep")) || 90 };
    case "meshroute_topology_explorer/observations/set":
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

// Matter entities and states (the sample's synthetic ones, or a capture's real ones): hass.entities is an object by
// entity id like Home Assistant's, and the Thread engine derives each device's picture from them.
const matterEntities = Object.fromEntries(((matterResponses && matterResponses["config/entity_registry/list"]) || [])
  .map((e) => [e.entity_id, e]));
const matterStates = Object.fromEntries(((matterResponses && matterResponses["get_states"]) || []).map((s) => [s.entity_id, s]));

let hass = {
  user: { id: "dev", name: "Dev", is_admin: !flag("nonadmin") },
  language: lang, locale: { language: lang, number_format: "language", time_format: "language" },
  themes: { darkMode: flag("dark"), theme: "default" }, selectedTheme: null,
  connected, connection, callWS, states: { ...syntheticStates(), ...matterStates }, areas, entities: matterEntities,
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
  // info=1|reload|all: the density note, the note beside "Read data again", or every View info note shown.
  if (q.get("info")) {
    const all = q.get("info") === "all";
    el._info = { density: all || !["reload"].includes(q.get("info")), reload: all || q.get("info") === "reload",
      colors: all, assumed: all };
  }
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
    // As the Details' cluster button does: the Zigbee engine opens the dialog through the panel's dialog host.
    const device = el._network.devices.find((d) => d.id === id);
    const [{ openClusterDialog }, { adapterFor }] = await Promise.all(
      [sourceModule("engines/zigbee/ui/cluster-dialog.js"), sourceModule("adapters/index.js")]);
    el._openDialog((host) => openClusterDialog({ ...host, t: el._t, device, endpoint: Number(q.get("ep") || 1),
      profile: 0x0104, cluster: parseInt(q.get("cluster"), 16), direction: q.get("dir") === "out" ? "out" : "in",
      opener: null, devicePage: adapterFor(el._network).devicePage }));
    if (flag("readvalues") && el._dialog) el._dialog.read();
  }
  // pair=<label>&htab=timeline|route|lane&hrange=48h|7d|30d|90d: the path history window of the selected device and
  // that device, as the "?" badge opens it (the README's history images).
  if (q.get("pair") && id && el._history) {
    const other = byLabel(q.get("pair")) || (el._network.devices.find((d) => d.label === q.get("pair")) || {}).id;
    const win = other && el._history.open(id, other, { tab: q.get("htab") || "timeline" });
    if (win && q.get("hrange")) {
      await sleep(300);
      const range = [...win.el.querySelectorAll(".hist-ranges .seg")].find((b) => b.textContent.replace(" ", "") === q.get("hrange"));
      if (range) range.click();
    }
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
/** Bottom edges (px from the window top) of the status pill and the fit button, and the window height, for #4. */
const edges = () => {
  const bottom = (node) => (node ? Math.round(node.getBoundingClientRect().bottom) : -1);
  const root = el.shadowRoot;
  return `pill ${bottom(root.querySelector(".status-pill-button"))} fit ${bottom(root.querySelector(".zoom:not(.spread) .icon-button:last-child"))} window ${innerHeight}`;
};

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
    else if (op === "pill") { // pill:<hearer label>><sender label>: the card a click on that pair's pill opens (the canvas hit test is unit-tested)
      const [a, b] = arg.split(">").map((label) => el._network.devices.find((d) => d.label === label).id);
      el._view._emit("pill-click", { a, b, x: 300, y: 300 });
    } else if (op === "key") {
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
      + `history ${(root.querySelector(".htab.on") || {}).textContent || "closed"}; `
      + `card ${root.querySelector(".pair-card") ? "open" : "closed"}; menu ${root.querySelector("#mte-pill-menu") ? "open" : "closed"}; `
      + `source ${el._network ? el._network.source : "-"}; networks ${root.querySelectorAll('[role="menuitemradio"]').length}; `
      + `zigbee-inputs ${[...root.querySelectorAll("input")].filter((n) => /-(paths|sourceRoute|heard|pathMode|color-)/.test(`${n.name} ${n.id}`)).length}; `
      + `greyed ${[...root.querySelectorAll('[role="menuitemradio"][aria-disabled="true"]')].map((n) => n.title).join(" / ") || "-"}; `
      + `message ${(root.querySelector(".message:not([hidden])") || {}).textContent || "-"}; `
      + `module ${panelModules()}; `
      + `edges ${edges()}; `
      + `drawn ${el._view && el._view.lastDraw ? `${el._view.lastDraw.lanes} lanes ${JSON.stringify(el._view.lastDraw.classes)}` : "-"}`);
  }
  document.body.dataset.log = log.join(" | ");
}
drive().then(replay);
