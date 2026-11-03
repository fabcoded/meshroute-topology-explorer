// SPDX-License-Identifier: MIT
// What the path history window writes for a Thread lane value (spec 5.8, board M36): RSSI over link quality, both
// written out. Pure. npm test
const MINUS = "−";

/** Pill text of a lane value [lqi, rssi] as the records hold it: "−75 dBm" over "LQI 3"; no RSSI leaves the first line out. */
export function entryText(entry) {
  if (!entry) return "?";
  const [lqi, rssi] = entry;
  const lines = [];
  if (typeof rssi === "number") lines.push(`${rssi < 0 ? MINUS : ""}${Math.abs(rssi)} dBm`);
  lines.push(typeof lqi === "number" ? `LQI ${lqi}` : "LQI ?");
  return lines.join("\n");
}
