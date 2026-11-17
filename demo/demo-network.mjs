// SPDX-License-Identifier: MIT
// The demo house of the online demo (dev/panel.html?demo=1, GitHub Pages): an invented detached house with 25 Zigbee
// and 25 Thread devices and some weak spots common in real homes. A pure, deterministic builder in the formats the dev
// page fakes (zha/devices, history/records, matter/network_topology, thread_tables); no capture went into it.
// Checked by tests/demo-network.test.mjs.
//
// Zigbee: 13 routers, 11 battery devices. Front door lamp behind the facade lost its route when the garage plug was
// unplugged (stale routes remain); terrace light off at night with the shed plug and motion sensor behind it; office
// plug answers no table request; the microwave lowers the kitchen links at mealtimes.
// Thread: 10 routers, 2 border routers, 13 sleepy devices. Weak freezer link through the garage wall; upper floor only
// via the landing light strip; the terrace plug's tables are 20 hours old.

const HOUR = 3600;

/** Deterministic hash of a text to [0, 1), for jitter and gaps that look random but never change. */
function unit(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return ((h >>> 0) % 100000) / 100000;
}
const hex4 = (n) => `0x${n.toString(16).toUpperCase().padStart(4, "0")}`;
const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

// ---- shared: areas -------------------------------------------------------------------------------------------------

const AREAS = [["utility", "Utility room"], ["hallway", "Hallway"], ["living_room", "Living room"],
  ["kitchen", "Kitchen"], ["dining_room", "Dining room"], ["office", "Office"], ["landing", "Landing"],
  ["bedroom", "Bedroom"], ["kids_room", "Kids' room"], ["bathroom", "Bathroom"], ["garage", "Garage"],
  ["front_door", "Front door"], ["terrace", "Terrace"], ["garden", "Garden"]];

// ---- Zigbee --------------------------------------------------------------------------------------------------------

/** Zigbee devices: key -> [name, area, kind, role]; end devices also name their parent (the router that lists them). */
export const ZIGBEE = {
  C: ["Coordinator", "utility", "hub", "coordinator"],
  HL: ["Hallway ceiling light", "hallway", "light", "router"],
  LC: ["Living room ceiling light", "living_room", "light", "router"],
  LF: ["Living room floor lamp", "living_room", "light", "router"],
  KL: ["Kitchen ceiling light", "kitchen", "light", "router"],
  DL: ["Dining table lamp", "dining_room", "light", "router"],
  OP: ["Office desk plug", "office", "outlet", "router"],
  LA: ["Landing light", "landing", "light", "router"],
  BL: ["Bedroom ceiling light", "bedroom", "light", "router"],
  KR: ["Kids' room lamp", "kids_room", "light", "router"],
  GP: ["Garage plug", "garage", "outlet", "router"],
  FD: ["Front door lamp", "front_door", "light", "router"],
  TL: ["Terrace light", "terrace", "light", "router"],
  SP: ["Garden shed plug", "garden", "outlet", "router"],
  FC: ["Front door contact", "hallway", "contact", "end", "HL"],
  HM: ["Hallway motion sensor", "hallway", "motion", "end", "HL"],
  LR: ["Living room remote", "living_room", "remote", "end", "LF"],
  LM: ["Living room motion sensor", "living_room", "motion", "end", "LC"],
  KT: ["Kitchen climate sensor", "kitchen", "climate", "end", "KL"],
  KW: ["Kitchen leak sensor", "kitchen", "contact", "end", "KL"],
  BB: ["Bedroom button", "bedroom", "remote", "end", "BL"],
  OW: ["Office window contact", "office", "contact", "end", "OP"],
  BM: ["Backyard motion sensor", "terrace", "motion", "end", "TL"],
  MB: ["Mailbox sensor", "garden", "contact", "end", "SP"],
  GD: ["Garage door contact", "garage", "contact", "end", "GP"],
};
const ZKEYS = Object.keys(ZIGBEE);
const zIeee = (k) => `aa:bb:cc:dd:de:00:00:${(ZKEYS.indexOf(k) + 1).toString(16).padStart(2, "0")}`;
const zNwk = (k) => (k === "C" ? 0 : 0x1000 + Math.floor(unit(`nwk${k}`) * 0xe000));
const isRouter = (k) => ZIGBEE[k][3] !== "end";

/** Router links: [a, b, LQI at which a hears b, LQI at which b hears a]. The front door lamp is outside the facade,
 *  the garden shed at the far end of the garden; GP's links are gone since it was unplugged (see zigbeeAt). */
const ZLINKS = [
  ["C", "HL", 208, 202], ["C", "LC", 188, 181], ["C", "KL", 174, 179], ["C", "OP", 221, 216], ["C", "GP", 158, 149],
  ["HL", "LC", 179, 172], ["HL", "KL", 151, 156], ["HL", "LA", 139, 131], ["HL", "FD", 47, 62], ["HL", "GP", 168, 163],
  ["LC", "LF", 231, 226], ["LC", "DL", 162, 167], ["LC", "TL", 96, 82], ["LF", "TL", 108, 91],
  ["KL", "DL", 201, 194], ["KL", "TL", 71, 58],
  ["LA", "BL", 192, 186], ["LA", "KR", 178, 174], ["BL", "KR", 121, 113], ["OP", "LA", 102, 94],
  ["GP", "FD", 151, 143], ["TL", "SP", 74, 57],
];
/** What a parent hears from its sleepy child, and the child's last-hop LQI (device.lqi). */
const CHILD_LQI = { FC: 152, HM: 171, LR: 198, LM: 183, KT: 140, KW: 96, BB: 176, OW: 158, BM: 88, MB: 61, GD: 132 };
/** Each router's next hop towards the coordinator; upOf() gives the front door lamp's hop while the garage plug
 *  had power. */
const UP = { HL: "C", LC: "C", KL: "C", OP: "C", GP: "C", LF: "LC", DL: "KL", LA: "HL", BL: "LA", KR: "LA", FD: "HL",
  TL: "LC", SP: "TL" };
/** Routes towards a destination: [holder, destination, next hop]. C -> FD over GP and HL -> GD over GP are stale:
 *  they were right before the garage plug was unplugged and nothing has used them since. */
const ROUTES = [
  ["C", "FD", "GP"], ["C", "LA", "HL"], ["C", "BL", "HL"], ["C", "KR", "HL"], ["C", "LF", "LC"], ["C", "TL", "LC"],
  ["C", "SP", "LC"], ["C", "DL", "KL"], ["HL", "LA", "LA"], ["HL", "BL", "LA"], ["HL", "KR", "LA"], ["HL", "FD", "FD"],
  ["HL", "GD", "GP"], ["LA", "BL", "BL"], ["LA", "KR", "KR"], ["LC", "TL", "TL"], ["LC", "SP", "TL"],
  ["LC", "LF", "LF"],
  ["TL", "SP", "SP"], ["KL", "DL", "DL"],
];

/** Next hop of router k towards the coordinator: the front door lamp took the garage plug (LQI 143) while it had
 *  power. */
const upOf = (k, gpOn) => (k === "FD" && gpOn ? "GP" : UP[k]);

/** Local hour of day (fractional) of a Unix time, in the visitor's time zone. */
const localHour = (t) => { const d = new Date(t * 1000); return d.getHours() + d.getMinutes() / 60; };
/** The terrace light hangs on a wall switch that is off at night. */
export const terraceOff = (t) => { const h = localHour(t); return h >= 23.5 || h < 6.5; };
/** Microwave at lunch and dinner time: the kitchen's links lose reception. */
export const microwaveOn = (t) => {
  const h = localHour(t);
  return (h >= 11.75 && h < 12.75) || (h >= 18 && h < 19.5);
};
/** Local wall-clock time without a zone, as ZHA reports last_seen (the panel shows it as it comes). */
function localIso(t) {
  const d = new Date(t * 1000);
  const p = (n) => String(n).padStart(2, "0");
  const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return `${date}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
const KITCHEN = new Set(["KL", "DL", "KT", "KW"]);

/** The network at time t (null: the last table read, without jitter): which devices answer and what each holder
 *  hears. unplugged: the moment the garage plug lost power. Returns { available, heard: Map "rx|tx" -> lqi, tables,
 *  gpOn (the garage plug has power) }. */
function zigbeeAt(t, unplugged) {
  const gpOn = t !== null && t < unplugged;
  const gdLost = t === null || t >= unplugged + 6 * HOUR; // the orphaned contact, unavailable after ZHA's 6 h
  const night = t !== null && terraceOff(t);
  const off = new Set([...(gpOn ? [] : ["GP"]), ...(gdLost ? ["GD"] : []), ...(night ? ["TL", "SP", "BM"] : [])]);
  const available = new Set(ZKEYS.filter((k) => !off.has(k)));
  // Tables that were read: every available router except the office desk plug, which never answers.
  const tables = new Set([...available].filter((k) => isRouter(k) && k !== "OP"));
  const heard = new Map();
  const put = (rx, tx, base) => {
    if (!tables.has(rx) || !available.has(tx)) return;
    let lqi = base;
    if (t !== null) {
      const weak = rx === "FD" || tx === "FD";
      if (rx === "FD" && unit(`gap${t}${tx}`) < 0.12) return; // the lamp loses its weak neighbours now and then
      if (microwaveOn(t) && (KITCHEN.has(rx) || KITCHEN.has(tx))) lqi *= 0.45;
      lqi += (unit(`j${t}${rx}${tx}`) - 0.5) * (weak ? 36 : 10);
    }
    heard.set(`${rx}|${tx}`, Math.max(1, Math.min(255, Math.round(lqi))));
  };
  for (const [a, b, ab, ba] of ZLINKS) {
    put(a, b, ab);
    put(b, a, ba);
  }
  for (const [c, lqi] of Object.entries(CHILD_LQI)) put(ZIGBEE[c][4], c, lqi);
  return { available, heard, tables, gpOn };
}

const SIGNATURES = {
  hub: { type: "0x0400", inputs: ["0x0000", "0x0006", "0x000a", "0x0019", "0x0501"], outputs: ["0x0001", "0x0500"] },
  light: { type: "0x010c", inputs: ["0x0000", "0x0003", "0x0004", "0x0005", "0x0006", "0x0008", "0x0300", "0x1000"],
    outputs: ["0x0019"] },
  outlet: { type: "0x010a", inputs: ["0x0000", "0x0003", "0x0004", "0x0005", "0x0006", "0x0702", "0x0b04"],
    outputs: ["0x0019"] },
  contact: { type: "0x0402", inputs: ["0x0000", "0x0001", "0x0003", "0x0500"], outputs: ["0x0019"] },
  motion: { type: "0x0107", inputs: ["0x0000", "0x0001", "0x0003", "0x0400", "0x0406"], outputs: ["0x0019"] },
  climate: { type: "0x0302", inputs: ["0x0000", "0x0001", "0x0003", "0x0402", "0x0405"], outputs: ["0x0019"] },
  remote: { type: "0x0820", inputs: ["0x0000", "0x0001", "0x0003"],
    outputs: ["0x0003", "0x0004", "0x0006", "0x0008", "0x0019"] },
};
const MODELS = { hub: "ZB-Coordinator", light: "Ceiling light CT", outlet: "Smart plug P1",
  contact: "Contact sensor C2", motion: "Motion sensor M3", climate: "Climate sensor T1", remote: "Remote R4" };
const ENTITIES = { hub: [], light: ["light", "update"], outlet: ["switch", "sensor", "sensor"],
  contact: ["binary_sensor", "sensor"], motion: ["binary_sensor", "sensor", "sensor"],
  climate: ["sensor", "sensor", "sensor"], remote: ["sensor"] };

/** One `zha/devices` entry. */
function zhaDevice(k, state, now, unplugged) {
  const [name, area, kind, role] = ZIGBEE[k];
  const sig = SIGNATURES[kind];
  const sleepy = role === "end";
  const typeOf = (x) => (x === "C" ? "Coordinator" : isRouter(x) ? "Router" : "EndDevice");
  const neighbors = [...state.heard].filter(([key]) => key.startsWith(`${k}|`)).map(([key, lqi]) => {
    const tx = key.split("|")[1];
    const child = !isRouter(tx);
    return { device_type: typeOf(tx), rx_on_when_idle: child ? "Off" : "On", relationship: child ? "Child" : "Sibling",
      extended_pan_id: "aa:bb:cc:dd:de:00:00:99", ieee: zIeee(tx), nwk: hex4(zNwk(tx)), permit_joining: "Unknown",
      depth: tx === "C" ? "0" : "1", lqi: String(lqi) };
  });
  const route = (dest, hop, manyToOne) => ({ dest_nwk: hex4(zNwk(dest)), route_status: "Active",
    memory_constrained: false, many_to_one: manyToOne, route_record_required: false, next_hop: hex4(zNwk(hop)) });
  const routes = !state.tables.has(k) ? [] : [...(UP[k] ? [route("C", UP[k], true)] : []),
    ...ROUTES.filter(([h]) => h === k).map(([, d, n]) => route(d, n, false))];
  const parentLqi = sleepy ? CHILD_LQI[k] : (state.heard.get(`${UP[k]}|${k}`) ?? null);
  const seen = k === "GP" || k === "GD" ? unplugged : now - Math.round(unit(`seen${k}`) * 1500);
  const entityName = slug(name);
  return {
    ieee: zIeee(k), nwk: zNwk(k), manufacturer: "Example", model: MODELS[kind], name: `Example ${MODELS[kind]}`,
    quirk_applied: false, quirk_class: "zigpy.device.ZigbeeDevice", exposes_features: [], manufacturer_code: 4660,
    power_source: sleepy ? "Battery or Unknown" : "Mains", lqi: k === "C" ? null : parentLqi, rssi: null,
    last_seen: localIso(seen), available: state.available.has(k),
    device_type: typeOf(k), active_coordinator: k === "C",
    signature: {
      node_descriptor: { logical_type: k === "C" ? 0 : sleepy ? 2 : 1, mac_capability_flags: sleepy ? 128 : 142,
        manufacturer_code: 4660, maximum_buffer_size: 82 },
      endpoints: { 1: { profile_id: "0x0104", device_type: sig.type, input_clusters: sig.inputs,
        output_clusters: sig.outputs } },
      manufacturer: "Example", model: MODELS[kind],
    },
    entities: ENTITIES[kind].map((domain, i) => ({ entity_id: `${domain}.${entityName}${i ? `_${i}` : ""}` })),
    neighbors, routes, endpoint_names: [], user_given_name: name, device_reg_id: `demo-${k}`, area_id: area,
  };
}

/** The moment the garage plug lost power: two days ago at 17:20 local time. */
export function unpluggedAt(now) {
  const d = new Date(now * 1000);
  d.setDate(d.getDate() - 2);
  d.setHours(17, 20, 0, 0);
  return Math.round(d.getTime() / 1000);
}

/** The ZHA answers of the demo: { "zha/devices", "config/device_registry/list", "config/area_registry/list",
 *  "config_entries/get" }, as at the last table read (now). */
export function demoZha({ now = Math.round(Date.now() / 1000) } = {}) {
  const unplugged = unpluggedAt(now);
  const state = zigbeeAt(null, unplugged);
  const devices = ZKEYS.map((k) => zhaDevice(k, state, now, unplugged));
  return {
    "zha/devices": devices,
    "config/device_registry/list": ZKEYS.map((k) => ({ id: `demo-${k}`, identifiers: [["zha", zIeee(k)]],
      area_id: ZIGBEE[k][1], name: `Example ${MODELS[ZIGBEE[k][2]]}`, name_by_user: ZIGBEE[k][0] })),
    "config/area_registry/list": AREAS.map(([id, name]) => ({ area_id: id, name })),
    "config_entries/get": [{ entry_id: "entry_demo_zha", domain: "zha", title: "", state: "loaded" }],
  };
}

const STEP = 1800;
/** Reception history of the demo (the answer of history/records): eight days in 30-minute steps up to now, local
 *  midnight aligned, so the microwave and the wall switch show at their clock times. Unchanged steps are `{ t }`. */
export function demoHistory({ now = Math.round(Date.now() / 1000) } = {}) {
  const unplugged = unpluggedAt(now);
  const start = new Date(now * 1000);
  start.setDate(start.getDate() - 8);
  start.setHours(0, 0, 0, 0);
  const keys = [];
  const index = new Map();
  const key = (x) => {
    const ieee = zIeee(x);
    if (!index.has(ieee)) {
      index.set(ieee, keys.length);
      keys.push(ieee);
    }
    return index.get(ieee);
  };
  const records = [];
  let previous = null;
  for (let t = Math.round(start.getTime() / 1000); t <= now; t += STEP) {
    const state = zigbeeAt(t, unplugged);
    const e = [...state.heard].map(([pair, lqi]) => {
      const [rx, tx] = pair.split("|");
      return [key(rx), key(tx), lqi];
    }).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const upRoutes = Object.keys(UP).map((h) => [h, "C", upOf(h, state.gpOn)]);
    const r = [...upRoutes, ...ROUTES].filter(([h]) => state.tables.has(h))
      .map(([h, d, n]) => [key(h), key(d), key(n), "Active"]);
    const p = Object.entries(CHILD_LQI).filter(([c]) => state.heard.has(`${ZIGBEE[c][4]}|${c}`))
      .map(([c]) => [key(c), key(ZIGBEE[c][4])]);
    const signature = JSON.stringify([e, r, p]);
    records.push(signature === previous ? { t } : { t, e, r, p });
    previous = signature;
  }
  return { k: keys, records };
}

// ---- Thread --------------------------------------------------------------------------------------------------------

/** Thread routers: key -> [name, area, Matter node id (null for a border router), router ID]; the leader is KP. */
const THREAD_ROUTERS = {
  BRL: ["Border router (living room)", "living_room", null, 8],
  BRO: ["Border router (office)", "office", null, 52],
  KP: ["Kitchen plug", "kitchen", 2, 17],
  LB: ["Living room blinds", "living_room", 3, 24],
  DP: ["Dining room plug", "dining_room", 4, 33],
  OP2: ["Office plug", "office", 5, 41],
  AQ: ["Air quality monitor", "office", 6, 46],
  LS: ["Landing light strip", "landing", 7, 12],
  BD: ["Bedroom blinds", "bedroom", 8, 29],
  KD: ["Kids' room plug", "kids_room", 9, 37],
  FZ: ["Freezer plug", "garage", 10, 58],
  TP: ["Terrace plug", "terrace", 11, 4],
};
const LEADER = "KP";
/** Sleepy end devices: key -> [name, area, Matter node id, parent]. */
const THREAD_CHILDREN = {
  VL: ["Radiator valve living room", "living_room", 12, "LB"],
  VO: ["Radiator valve office", "office", 13, "OP2"],
  VB: ["Radiator valve bedroom", "bedroom", 14, "BD"],
  VK: ["Radiator valve kids' room", "kids_room", 15, "KD"],
  VT: ["Radiator valve bathroom", "bathroom", 16, "KD"],
  WL: ["Window sensor living room", "living_room", 17, "LB"],
  WB: ["Window sensor bedroom", "bedroom", 18, "BD"],
  WK: ["Window sensor kids' room", "kids_room", 19, "KD"],
  BK: ["Back door sensor", "dining_room", 20, "DP"],
  OC: ["Office climate sensor", "office", 21, "AQ"],
  GM: ["Garage motion sensor", "garage", 22, "FZ"],
  BN: ["Bedside button", "bedroom", 23, "LS"],
  LK: ["Bathroom leak sensor", "bathroom", 24, "LS"],
};
const TKEYS = [...Object.keys(THREAD_ROUTERS), ...Object.keys(THREAD_CHILDREN)];
const tExt = (k) => `AABBCCDDDE0000${(TKEYS.indexOf(k) + 1).toString(16).padStart(2, "0").toUpperCase()}`;
const isBorder = (k) => k in THREAD_ROUTERS && THREAD_ROUTERS[k][2] === null;
/** Router links: [a, b, [rssi, LQI] of b hearing a, [rssi, LQI] of a hearing b]; a border router's own table is not in
 *  the Matter cache, so what it hears has no RSSI. Floors and the garage wall cost link quality. */
const TLINKS = [
  ["BRL", "LB", [-44, 3], [null, 3]], ["BRL", "KP", [-57, 3], [null, 3]], ["BRL", "DP", [-63, 3], [null, 3]],
  ["KP", "DP", [-49, 3], [-52, 3]], ["KP", "LB", [-61, 3], [-60, 3]], ["KP", "OP2", [-82, 2], [-84, 2]],
  ["BRO", "OP2", [-41, 3], [null, 3]], ["BRO", "AQ", [-38, 3], [null, 3]], ["OP2", "AQ", [-35, 3], [-36, 3]],
  ["LB", "LS", [-80, 2], [-83, 2]], ["OP2", "LS", [-81, 2], [-85, 2]], ["LS", "BD", [-58, 3], [-60, 3]],
  ["LS", "KD", [-55, 3], [-57, 3]], ["BD", "KD", [-84, 2], [-86, 2]], ["KP", "FZ", [-93, 1], [-95, 1]],
  ["FZ", "TP", [-62, 3], [-64, 3]], ["DP", "TP", [-94, 1], [-96, 1]],
];
/** What each side of a parent link hears: [rssi of the child at the parent, LQI], [rssi of the parent at the child,
 *  LQI]. */
const TCHILD = {
  VL: [[-52, 3], [-50, 3]], VO: [[-47, 3], [-46, 3]], VB: [[-55, 3], [-53, 3]], VK: [[-51, 3], [-49, 3]],
  VT: [[-93, 1], [-92, 1]], WL: [[-58, 3], [-57, 3]], WB: [[-61, 3], [-60, 3]], WK: [[-64, 3], [-62, 3]],
  BK: [[-66, 3], [-65, 3]], OC: [[-40, 3], [-39, 3]], GM: [[-82, 2], [-84, 2]], BN: [[-83, 2], [-82, 2]],
  LK: [[-84, 2], [-86, 2]],
};
const LQ_COST = { 3: 1, 2: 2, 1: 4 };
const RKEYS = Object.keys(THREAD_ROUTERS);
const rid = (k) => THREAD_ROUTERS[k][3];
/** Two-way link quality (the lower of both directions) of a router pair, or null without a link. */
function linkQuality(a, b) {
  const l = TLINKS.find(([x, y]) => (x === a && y === b) || (x === b && y === a));
  return l ? Math.min(l[2][1], l[3][1]) : null;
}
/** Converged path costs between routers over the link costs (Floyd-Warshall): what MLE advertisements settle on. */
function threadCosts() {
  const cost = Object.fromEntries(RKEYS.map((a) => [a, Object.fromEntries(RKEYS.map((b) => {
    const q = linkQuality(a, b);
    return [b, a === b ? 0 : q === null ? Infinity : LQ_COST[q]];
  }))]));
  for (const m of RKEYS) {
    for (const a of RKEYS) {
      for (const b of RKEYS) cost[a][b] = Math.min(cost[a][b], cost[a][m] + cost[m][b]);
    }
  }
  return cost;
}

/** Route table of router h in the Matter client's field names, as tests/thread-routes-fixture.mjs builds it: per router
 *  the next hop other than the destination itself with the lowest advertised cost plus link cost (ties to the lower
 *  router ID) and that neighbour's advertised cost; LQI in and out of a direct link. */
function routeTable(h, cost) {
  return RKEYS.map((d) => {
    const e = { extAddress: tExt(d), rloc16: rid(d) << 10, routerId: rid(d), age: 200, allocated: true };
    if (d === h) return { ...e, nextHop: 63, pathCost: 0, LQIIn: 0, LQIOut: 0, linkEstablished: false };
    const via = RKEYS.filter((n) => n !== d && n !== h && linkQuality(h, n) !== null && Number.isFinite(cost[n][d]))
      .map((n) => ({ n, c: cost[n][d] + LQ_COST[linkQuality(h, n)] }))
      .sort((a, b) => a.c - b.c || rid(a.n) - rid(b.n))[0];
    const heard = (rx, tx) => { const l = TLINKS.find(([x, y]) => (x === tx && y === rx) || (x === rx && y === tx));
      return l ? (l[0] === tx ? l[2] : l[3])[1] : 0; };
    return { ...e, nextHop: via ? rid(via.n) : 63, pathCost: via ? cost[via.n][d] : 0, LQIIn: heard(h, d),
      LQIOut: heard(d, h), linkEstablished: linkQuality(h, d) !== null };
  });
}

const neighbour = (sender, [rssi, lqi], child = false) => ({
  extAddress: tExt(sender), age: 30, rloc16: 0, linkFrameCounter: 5, mleFrameCounter: 2, lqi, averageRssi: rssi,
  lastRssi: rssi, frameErrorRate: 0, messageErrorRate: 0, rxOnWhenIdle: !child, fullThreadDevice: !child,
  fullNetworkData: !child, isChild: child,
});
const readBetween = (hi, lo = hi - 600) => ({ neighbor_table: { lo, hi }, route_table: { lo, hi } });
const NET = { ext_pan_id: "aabbccddeeffde01", network_name: "demo-home" };

/** The Thread network of the demo: { topology (matter/network_topology), tables (thread_tables), registry }, read at
 *  readAt; the terrace plug's tables were read 20 h before, the others within the last hours. */
export function demoThread({ readAt = Math.round(Date.now() / 1000) } = {}) {
  const cost = threadCosts();
  const children = Object.keys(THREAD_CHILDREN);
  const nodes = [...RKEYS.map(routerNode), ...children.map(childNode)];
  const tables = [...RKEYS.filter((k) => !isBorder(k)).map((k) => routerTables(k, cost, readAt)),
    ...children.map((k) => childTables(k, readAt))];
  return { topology: { collected_at: readAt * 1000, nodes, connections: connectionsOf(nodes, tables) },
    tables: { nodes: tables, read_at: readAt, observe_seconds: 600 },
    registry: TKEYS.filter((k) => !isBorder(k)).map(registryEntry) };
}

/** The snapshot node (matter/network_topology) of router or border router k. */
function routerNode(k) {
  const [name, , node] = THREAD_ROUTERS[k];
  const border = node === null;
  return { id: border ? `br_${tExt(k)}` : String(node), kind: border ? "border_router" : "matter",
    network_type: "thread", node_id: node, role: k === LEADER ? "leader" : "router",
    available: border ? null : true, ext_address: tExt(k), rloc16: null, ...NET,
    vendor_name: border ? "Example" : null, model_name: border ? "Border router" : null, last_seen: null,
    ha_device_id: border ? null : `demo-${k}`, host_name: border ? name : null };
}

/** Router k's tables (thread_tables): the routers and children it hears, its route table, when both were read. */
function routerTables(k, cost, readAt) {
  const heard = TLINKS.flatMap(([a, b, toB, toA]) => {
    if (b === k) return [neighbour(a, toB)];
    return a === k ? [neighbour(b, toA)] : [];
  });
  for (const [c, [, , , parent]] of Object.entries(THREAD_CHILDREN)) {
    if (parent === k) heard.push(neighbour(c, TCHILD[c][0], true));
  }
  // The terrace plug's tables are 20 h old, read before Meshroute first looked.
  const old = k === "TP";
  const age = old ? 20 * HOUR : Math.round((0.5 + 3 * unit(`age${k}`)) * HOUR);
  return { node_id: THREAD_ROUTERS[k][2], available: true, routing_role: k === LEADER ? 6 : 5,
    ext_address: tExt(k).toLowerCase(), rloc16: null, neighbor_table: heard, route_table: routeTable(k, cost),
    times: old ? readBetween(readAt - age, null) : readBetween(readAt - age) };
}

/** The snapshot node of sleepy end device k. */
function childNode(k) {
  const node = THREAD_CHILDREN[k][2];
  return { id: String(node), kind: "matter", network_type: "thread", node_id: node, role: "sleepy_end_device",
    available: true, ext_address: tExt(k), rloc16: null, ...NET, vendor_name: null, model_name: null, last_seen: null,
    ha_device_id: `demo-${k}` };
}

/** Sleepy end device k's tables: its parent as the only neighbour and the only linked route entry (NextHop 0, PathCost
 *  0, as real devices report). */
function childTables(k, readAt) {
  const [, , node, parent] = THREAD_CHILDREN[k];
  const [atParent, atChild] = TCHILD[k];
  const routes = RKEYS.map((d) => ({ extAddress: tExt(d), rloc16: rid(d) << 10, routerId: rid(d), nextHop: 0,
    pathCost: 0, LQIIn: d === parent ? atChild[1] : 0, LQIOut: d === parent ? atParent[1] : 0, age: 3, allocated: true,
    linkEstablished: d === parent }));
  return { node_id: node, available: true, routing_role: 2, ext_address: tExt(k).toLowerCase(), rloc16: null,
    neighbor_table: [neighbour(parent, atChild)], route_table: routes,
    times: readBetween(readAt - Math.round((1 + 5 * unit(`age${k}`)) * HOUR)) };
}

/** Device registry entry of Matter node k, with a model guessed from its name. */
function registryEntry(k) {
  const [name, area] = THREAD_ROUTERS[k] || THREAD_CHILDREN[k];
  const model = [["Radiator", "Radiator valve"], ["button", "Button"], ["blinds", "Blinds"], ["strip", "Light strip"],
    ["Air quality", "Air quality monitor"], ["plug", "Plug"]].find(([word]) => name.includes(word));
  return { id: `demo-${k}`, name, name_by_user: null, manufacturer: "Example", model: model ? model[1] : "Sensor",
    area_id: area, sw_version: null };
}

/** The snapshot's links, both directions, from the neighbour tables (source hears target), as the Matter server
 *  derives them; a border router's side comes only from its neighbour's table. */
function connectionsOf(nodes, tables) {
  const idOf = (ext) => nodes.find((n) => n.ext_address.toLowerCase() === ext.toLowerCase()).id;
  const connections = [];
  const seen = new Set();
  for (const t of tables) {
    for (const n of t.neighbor_table) {
      const pair = [t.ext_address, n.extAddress.toLowerCase()].sort().join("|");
      if (seen.has(pair)) continue;
      seen.add(pair);
      const back = tables.find((x) => x.ext_address === n.extAddress.toLowerCase());
      const rev = back && back.neighbor_table.find((m) => m.extAddress.toLowerCase() === t.ext_address);
      const dir = (e) => (e ? { strength: "strong", lqi: e.lqi, rssi: e.averageRssi } : null);
      connections.push({ source: idOf(t.ext_address), target: idOf(n.extAddress), network: "thread",
        source_to_target: dir(n), target_to_source: dir(rev), via_route_table: null, path_cost: null });
    }
  }
  return connections;
}
