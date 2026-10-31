// SPDX-License-Identifier: MIT
// Development only, not shipped: a seeded synthetic network for the speed target of spec 12 (300 devices, 3 000
// readings) and for looking at large maps in dev/graph.html?synthetic=300. Devices sit at random points; routers
// report their nearest devices, LQI falls with distance plus noise, about 2 % of readings are 0 (unknown).

import { seededRandom } from "../custom_components/meshroute_topology_explorer/frontend/graph/layout.js";

export function syntheticNetwork({ devices = 300, readings = 3000, seed = 7, routerShare = 0.6 } = {}) {
  const rnd = seededRandom(seed);
  const side = Math.sqrt(devices) * 10;
  const pts = [];
  const list = [];
  for (let i = 0; i < devices; i++) {
    pts.push([rnd() * side, rnd() * side]);
    const role = i === 0 ? "coordinator" : rnd() < routerShare ? "router" : "end device";
    list.push({
      id: "aa:bb:cc:dd:" + [24, 16, 8, 0].map((s) => ((i >> s) & 255).toString(16).padStart(2, "0")).join(":"),
      role,
      label: role === "end device" ? `Sensor ${String(i).padStart(3, "0")}` : `Lamp ${String(i).padStart(3, "0")}`,
      available: rnd() > 0.03,
      rating: rnd() < 0.1 ? null : rnd(),
      nwk: (i * 7919) & 0xffff,
    });
  }
  const reporters = list.map((d, i) => i).filter((i) => list[i].role !== "end device");
  const order = reporters.map((r) => list.map((_, j) => j).filter((j) => j !== r)
    .sort((a, b) => Math.hypot(pts[a][0] - pts[r][0], pts[a][1] - pts[r][1]) -
      Math.hypot(pts[b][0] - pts[r][0], pts[b][1] - pts[r][1])));
  const out = [];
  for (let round = 0; out.length < readings && round < devices; round++) {
    for (let k = 0; k < reporters.length && out.length < readings; k++) {
      const r = reporters[k];
      const s = order[k][round];
      if (s === undefined) continue;
      const dist = Math.hypot(pts[s][0] - pts[r][0], pts[s][1] - pts[r][1]);
      const lqi = rnd() < 0.02 ? 0 : Math.max(1, Math.min(255, Math.round(255 * Math.exp(-dist / 18) + (rnd() - 0.5) * 40)));
      out.push({ reporter: list[r].id, subject: list[s].id, lqi });
    }
  }
  return { source: "zha", id: `synthetic-${devices}`, devices: list, readings: out };
}
