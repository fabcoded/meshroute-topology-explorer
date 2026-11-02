// SPDX-License-Identifier: MIT
// What a Thread lane says (spec 3.2, 4.6, 7.1): the value under "RX:" (the RSSI in dBm, else the link quality 0-3,
// "Parent" where only the parent link implies the direction), the glyph of a direction without a reading, and the
// legend rows of what a Thread map draws: parent links, measured neighbours, the glyphs, RX in dBm; no views, no
// stages. Drawn by the shared renderer through the engine (engines/index.js). Pure. npm test
import { laneStyle } from "../../graph/links.js";

/** A reading's quality for the layout's springs (spec 7.1): Thread link quality 1..3 as 1/3..1; null where it is no
 *  spring: link quality 0 or none (an RSSI alone gives no spring; the reception model, quality.js, is not wired
 *  yet). */
export function springQuality(r) {
  if (!r || r.measured === false || !(typeof r.lqi === "number" && r.lqi > 0)) return null;
  return Math.min(r.lqi, 3) / 3;
}

/** Glyph for a direction without a reading: "–" where the hearer's neighbour table was read and does not list the
 *  sender (model.js reason "not in the neighbour table"), "?" where there is no table to ask. */
export function unknownGlyph(reason) {
  return typeof reason === "string" && /^not in the neighbour table/.test(reason) ? "–" : "?";
}

/** What a Thread lane shows at its arrow (spec 7.1; board recommendation, main session 2026-11-01, M15 asks the owner):
 *  "rssi" = the RSSI in dBm, the link quality 0-3 only where no RSSI was reported (the details list both); "lqi" = the
 *  link quality first. The one switch for the owner's choice. */
export const THREAD_VALUE = "rssi";

/** A Thread direction's value at the arrow: "-75 dBm", or "LQI 3" (THREAD_VALUE); the unknown glyph without either. */
export function threadValue(dir, mode = THREAD_VALUE) {
  const rssi = dir && typeof dir.rssi === "number" ? `${String(dir.rssi).replace("-", "−")} dBm` : null;
  const lqi = dir && typeof dir.lqi === "number" ? `LQI ${dir.lqi}` : null;
  const text = mode === "lqi" ? lqi || rssi : rssi || lqi;
  return dir && dir.state === "measured" && text ? text : unknownGlyph(dir && dir.reason);
}

/** The value of a lane: "Parent" where only the parent link implies the direction, else threadValue; never a number
 *  on the Zigbee LQI scale. Texts: the panel's words. */
export function laneValue(dir, texts) {
  if (dir && dir.state === "implied") return dir.source === "parent" ? texts.parent : texts.route;
  return threadValue(dir);
}

/** The link rows of the legend (spec 3.2): what a Thread map draws, parent links, measured neighbours, the glyphs a
 *  click shows, RX with an RSSI sample; no stage or option notes. */
export function legendEntries(theme) {
  return [
    { id: "parent", kind: "lane", style: laneStyle("solid", 1, theme) },
    { id: "neighbour", kind: "lane", style: laneStyle("dashed", 1, theme) },
    { id: "not-listed", kind: "glyph", text: "–", color: theme.muted },
    { id: "no-table-thread", kind: "glyph", text: "?", color: theme.muted },
    { id: "rx-thread", kind: "rx", sample: "−75 dBm" },
  ];
}

/** Pairs and lanes of a Thread network with what each lane carries (spec 3.2, 4.6): there are no routes and no
 *  coordinator, so the only traffic the data names is a parent link, while both ends are available: the end device
 *  sends to its parent (toParent) and the parent delivers to it (fromParent). Returns { pairs: [{ a, b, ab, ba }],
 *  lanes: [{ pair, sender, hearer, dir, toParent, fromParent }] }, two lanes per pair (first b -> a, whose evidence is
 *  ab: a hears b; then a -> b). */
export function classifyLanes(network) {
  const devices = (network.devices || []).filter((d) => d && typeof d.id === "string");
  const known = new Set(devices.map((d) => d.id));
  const available = new Set(devices.filter((d) => d.available !== false).map((d) => d.id));
  const toParent = new Set();
  for (const d of devices) {
    if (d.role !== "end device" || !d.parent || !available.has(d.id) || !available.has(d.parent)) continue;
    toParent.add(`${d.id}>${d.parent}`);
  }
  const pairs = (Array.isArray(network.pairs) ? network.pairs : []).filter((p) => known.has(p.a) && known.has(p.b));
  const lanes = [];
  pairs.forEach((p, pair) => {
    for (const [sender, hearer, dir] of [[p.b, p.a, p.ab], [p.a, p.b, p.ba]]) {
      lanes.push({ pair, sender, hearer, dir, toParent: toParent.has(`${sender}>${hearer}`),
        fromParent: toParent.has(`${hearer}>${sender}`) });
    }
  });
  return { pairs, lanes };
}
