// SPDX-License-Identifier: MIT
// Synthetic Thread network with route tables (#11), for the route tests and the dev page (?matter=routes). Shaped
// after the owner's Atelier as issue #11 and the research note give it (routers 28 sofaunten / leader, 10 sofaoben,
// 60 border router A; sofaunten <-> border router A LQI 2 at -86 dBm, the 2 = 2 tie; two sleepy sensors whose parent
// changed to border router A), plus the example extension of board M38 for routes of several hops (plugs 1-3, a motion
// sensor, border router B). Names and addresses are invented; no capture. Pure data builder. npm test
//
// Hand-checked routing state: COST[n][d] is the converged path cost from router n to router d over the link costs
// (3 -> 1, 2 -> 2, 1 -> 4) of LINKS; each route entry of holder h for d carries the next hop n (a neighbour other
// than d with the lowest COST[n][d] + link(h, n), ties to the lower router ID) and its claimed cost COST[n][d].
// Expected routes in tests/model-thread-routes.test.mjs are worked out by hand from these tables.

const ext = (n) => `AABBCCDD000000${n.toString(16).padStart(2, "0").toUpperCase()}`;
/** Routers: key -> { node (Matter node id, null for a border router), rid (router ID), name, br }. */
export const ROUTERS = {
  LU: { node: 14, rid: 28, name: "sofaunten", leader: true },
  LO: { node: 15, rid: 10, name: "sofaoben" },
  BRA: { node: null, rid: 60, name: "Border router A", br: true },
  P1: { node: 21, rid: 40, name: "Plug 1" },
  P2: { node: 22, rid: 50, name: "Plug 2" },
  P3: { node: 23, rid: 45, name: "Plug 3" },
  BRB: { node: null, rid: 5, name: "Border router B", br: true },
};
/** Sleepy end devices: key -> { node, name, parent (cache), fresh (parent after the parent change) }. */
export const CHILDREN = {
  TE: { node: 16, name: "Tür Eingang", parent: "LO", fresh: "BRA" },
  KF: { node: 18, name: "Klima Flur", parent: "LU", fresh: "BRA" },
  XS: { node: 24, name: "Motion sensor", parent: "P2" },
};
const KEYS = { ...ROUTERS, ...CHILDREN };
let serial = 1;
for (const k of Object.keys(KEYS)) KEYS[k].ext = ext(serial++);

/** What b hears from a: HEARD["a>b"] = [rssi, lqi]; a border router's own table is not in the cache (no entries
 *  heard by BRA or BRB), its side comes from the neighbour's LQI out. */
export const HEARD = {
  "BRA>LU": [-86, 2], "LU>BRA": [null, 2],
  "BRA>LO": [-71, 3], "LO>BRA": [null, 3],
  "LU>LO": [-37, 3], "LO>LU": [-37, 3],
  "LO>P1": [-72, 3], "P1>LO": [-74, 3],
  "BRA>P1": [-94, 1], "P1>BRA": [null, 1],
  "P1>P2": [-86, 2], "P2>P1": [-88, 2],
  "P2>P3": [-70, 3], "P3>P2": [-72, 3],
  "P3>BRB": [null, 3], "BRB>P3": [-66, 3],
};
/** Parent links of the cache, what each side hears: [rssi, lqi] (a sleepy child's average -13 next to last -42). */
const CHILD_HEARD = {
  "TE>LO": [-21, 3], "LO>TE": [-77, 3],
  "KF>LU": [{ average: -13, last: -42 }, 3], "LU>KF": [-85, 2],
  "XS>P2": [-83, 2], "P2>XS": [-80, 2],
};
/** Two-way link quality (the lower of both) of every router link. */
const LINKS = { "LU|LO": 3, "LU|BRA": 2, "LO|BRA": 3, "LO|P1": 3, "P1|BRA": 1, "P1|P2": 2, "P2|P3": 3, "P3|BRB": 3 };
const LQ_COST = { 3: 1, 2: 2, 1: 4 };
const R = Object.keys(ROUTERS);
/** Converged path costs, by hand (see the file head). */
export const COST = {
  LU: { LU: 0, LO: 1, BRA: 2, P1: 2, P2: 4, P3: 5, BRB: 6 },
  LO: { LU: 1, LO: 0, BRA: 1, P1: 1, P2: 3, P3: 4, BRB: 5 },
  BRA: { LU: 2, LO: 1, BRA: 0, P1: 2, P2: 4, P3: 5, BRB: 6 },
  P1: { LU: 2, LO: 1, BRA: 2, P1: 0, P2: 2, P3: 3, BRB: 4 },
  P2: { LU: 4, LO: 3, BRA: 4, P1: 2, P2: 0, P3: 1, BRB: 2 },
  P3: { LU: 5, LO: 4, BRA: 5, P1: 3, P2: 1, P3: 0, BRB: 1 },
  BRB: { LU: 6, LO: 5, BRA: 6, P1: 4, P2: 2, P3: 1, BRB: 0 },
};
const lq = (a, b) => LINKS[`${a}|${b}`] ?? LINKS[`${b}|${a}`] ?? null;
const rloc = (k) => ROUTERS[k].rid << 10;

/** Route table of router h as the Matter cache holds it (field names of the Matter client); also for a border
 *  router, whose table the tests add where they need it. */
export function routeTable(h) {
  return R.map((d) => {
    const e = { extAddress: KEYS[d].ext, rloc16: rloc(d), routerId: ROUTERS[d].rid, age: 200, allocated: true };
    if (d === h) return { ...e, nextHop: 63, pathCost: 0, LQIIn: 0, LQIOut: 0, linkEstablished: false };
    const options = R.filter((n) => n !== d && n !== h && lq(h, n) !== null)
      .map((n) => ({ n, cost: COST[n][d] + LQ_COST[lq(h, n)] }))
      .sort((a, b) => a.cost - b.cost || ROUTERS[a.n].rid - ROUTERS[b.n].rid);
    const via = options[0];
    const linked = lq(h, d) !== null;
    const inQ = linked ? (HEARD[`${d}>${h}`] || [null, 0])[1] : 0;
    const outQ = linked ? (HEARD[`${h}>${d}`] || [null, 0])[1] : 0;
    return { ...e, nextHop: via ? ROUTERS[via.n].rid : 63, pathCost: via ? COST[via.n][d] : 0, LQIIn: inQ,
      LQIOut: outQ, linkEstablished: linked };
  });
}

/** Read intervals of both tables as thread_tables answers them: read between `hi` minus 10 minutes (the observer's
 *  period) and `hi`, or with an unknown lower bound (lo null). */
const readBetween = (hi, lo = hi - 600) => ({ neighbor_table: { lo, hi }, route_table: { lo, hi } });

const neighbour = (sender, [rssi, lqi], child = false) => ({
  extAddress: KEYS[sender].ext, age: 30, rloc16: 0, linkFrameCounter: 5, mleFrameCounter: 2, lqi,
  averageRssi: typeof rssi === "object" && rssi ? rssi.average : rssi, lastRssi: typeof rssi === "object" && rssi ? rssi.last : rssi,
  frameErrorRate: 0, messageErrorRate: 0, rxOnWhenIdle: !child, fullThreadDevice: !child, fullNetworkData: !child,
  isChild: child,
});

/** The network: { topology (matter/network_topology), tables (meshroute_topology_explorer/thread_tables), registry }.
 *  fresh: the sensors TE and KF hang on border router A (the parent change of the owner's fresh read). atelier: only
 *  the owner-shaped part (sofaunten, sofaoben, border router A, the two sensors), without the example extension. */
export function threadRoutesSample({ fresh = false, readAt = 1767268800, atelier = false } = {}) {
  const full = buildSample({ fresh, readAt });
  if (!atelier) return full;
  const keep = new Set(["LU", "LO", "BRA", "TE", "KF"].map((k) => KEYS[k].ext.toLowerCase()));
  const kept = (ext) => keep.has(String(ext).toLowerCase());
  const nodes = full.topology.nodes.filter((n) => kept(n.ext_address));
  const ids = new Set(nodes.map((n) => n.id));
  return {
    topology: { ...full.topology, nodes,
      connections: full.topology.connections.filter((c) => ids.has(c.source) && ids.has(c.target)) },
    tables: { ...full.tables, nodes: full.tables.nodes.filter((n) => kept(n.ext_address)).map((n) => ({ ...n,
      neighbor_table: n.neighbor_table.filter((e) => kept(e.extAddress)),
      route_table: n.route_table.filter((e) => kept(e.extAddress)) })) },
    registry: full.registry.filter((r) => ["LU", "LO", "TE", "KF"].some((k) => r.id === `routes-${k}`)),
  };
}

function buildSample({ fresh, readAt }) {
  const parentOf = (k) => (fresh && CHILDREN[k].fresh) || CHILDREN[k].parent;
  const childHeard = (key) => {
    if (CHILD_HEARD[key]) return CHILD_HEARD[key];
    return [-80, 3]; // a fresh parent link to border router A (only the child's side is in the cache)
  };
  const nodes = [];
  const tables = [];
  for (const [k, r] of Object.entries(ROUTERS)) {
    nodes.push({ id: r.node === null ? `br_${KEYS[k].ext}` : String(r.node), kind: r.br ? "border_router" : "matter",
      network_type: "thread", node_id: r.node, role: r.leader ? "leader" : "router", available: r.br ? null : true,
      ext_address: KEYS[k].ext, rloc16: null, ext_pan_id: "aabbccddeeff0099", network_name: "thread-net-99",
      vendor_name: r.br ? "Example" : null, model_name: r.br ? "Border router" : null, last_seen: null,
      ha_device_id: r.br ? null : `routes-${k}`, host_name: r.br ? r.name : null });
    if (r.br) continue;
    const heardHere = Object.entries(HEARD).filter(([key]) => key.endsWith(`>${k}`))
      .map(([key, v]) => neighbour(key.split(">")[0], v));
    for (const [c] of Object.entries(CHILDREN).filter(([ck]) => parentOf(ck) === k)) {
      heardHere.push(neighbour(c, childHeard(`${c}>${k}`), true));
    }
    tables.push({ node_id: r.node, available: true, routing_role: r.leader ? 6 : 5, ext_address: KEYS[k].ext.toLowerCase(),
      rloc16: null, neighbor_table: heardHere, route_table: routeTable(k), times: readBetween(readAt - 3 * 3600) });
  }
  for (const [k, c] of Object.entries(CHILDREN)) {
    const p = parentOf(k);
    nodes.push({ id: String(c.node), kind: "matter", network_type: "thread", node_id: c.node, role: "sleepy_end_device",
      available: true, ext_address: KEYS[k].ext, rloc16: null, ext_pan_id: "aabbccddeeff0099",
      network_name: "thread-net-99", vendor_name: null, model_name: null, last_seen: null, ha_device_id: `routes-${k}` });
    const [, inQ] = childHeard(`${p}>${k}`);
    const [, outQ] = childHeard(`${k}>${p}`);
    // An end device's own table: one linked entry, its parent (NextHop 0, PathCost 0 as the owner's devices report).
    const routes = R.map((d) => ({ extAddress: KEYS[d].ext, rloc16: rloc(d), routerId: ROUTERS[d].rid, nextHop: 0,
      pathCost: 0, LQIIn: d === p ? inQ : 0, LQIOut: d === p ? outQ : 0, age: 3, allocated: true, linkEstablished: d === p }));
    tables.push({ node_id: c.node, available: true, routing_role: 2, ext_address: KEYS[k].ext.toLowerCase(), rloc16: null,
      neighbor_table: [neighbour(p, childHeard(`${p}>${k}`))], route_table: routes,
      // The motion sensor's tables were there before Meshroute first looked (lower bound unknown), 21 h ago.
      times: k === "XS" ? readBetween(readAt - 21 * 3600, null) : readBetween(readAt - 3600) });
  }
  // The snapshot's links, both directions, from the same neighbour tables (source hears target).
  const nodeOf = (k) => nodes.find((n) => n.ext_address === KEYS[k].ext).id;
  const connections = [];
  const seen = new Set();
  for (const t of tables) {
    const self = Object.keys(KEYS).find((k) => KEYS[k].ext.toLowerCase() === t.ext_address);
    for (const n of t.neighbor_table) {
      const other = Object.keys(KEYS).find((k) => KEYS[k].ext === n.extAddress);
      const key = [self, other].sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      const back = tables.find((x) => x.ext_address === KEYS[other].ext.toLowerCase());
      const rev = back && back.neighbor_table.find((m) => m.extAddress === KEYS[self].ext);
      const dir = (e) => (e ? { strength: "strong", lqi: e.lqi, rssi: e.isChild && !e.rxOnWhenIdle ? e.lastRssi : e.averageRssi } : null);
      connections.push({ source: nodeOf(self), target: nodeOf(other), network: "thread", source_to_target: dir(n),
        target_to_source: dir(rev), via_route_table: null, path_cost: null });
    }
  }
  // Device registry entries for the Matter nodes, so the map shows the names.
  const registry = Object.entries(KEYS).filter(([, v]) => v.node !== null)
    .map(([k, v]) => ({ id: `routes-${k}`, name: v.name, name_by_user: null, manufacturer: "Example", model: k.startsWith("P")
      ? "Plug" : k in CHILDREN ? "Sensor" : "Bulb", area_id: null, sw_version: null }));
  return { topology: { collected_at: readAt * 1000, nodes, connections },
    tables: { nodes: tables, read_at: readAt, observe_seconds: 600 }, registry };
}

/** Device id (colon form) of a key, as the Thread engine keys devices. */
export const idOf = (k) => KEYS[k].ext.toLowerCase().match(/../g).join(":");
