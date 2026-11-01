// SPDX-License-Identifier: MIT
// What a Thread lane says (spec 3.2, 4.6, 7.1): the value under "RX:" (the RSSI in dBm, else the link quality 0-3,
// "Parent" where only the parent link implies the direction), the glyph of a direction without a reading, and the
// legend rows of what a Thread map draws: parent links, measured neighbours, the glyphs, RX in dBm; no views, no
// stages. Drawn by the shared renderer through the engine (engines/index.js). Pure. node --test tests/
import { laneStyle } from "../../graph/links.js";

/** Glyph for a direction without a reading: "–" where the hearer's neighbour table was read and does not list the
 *  sender (model/thread.js reason "not in the neighbour table"), "?" where there is no table to ask. */
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
