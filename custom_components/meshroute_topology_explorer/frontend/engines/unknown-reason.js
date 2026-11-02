// SPDX-License-Identifier: MIT
// Why a direction "A hears B" has no reading (spec 4.3), as data: { code, size?, vendorEstimate? }. The engines make
// it (zigbee/pairs.js, thread/model.js), the lanes and the Details read the code. Codes: "lqi0", "no_table_end_device",
// "table_missing", "capacity_unknown", "table_full", "table_nearly_full", "table_space" (size as n of capacity), "no_evidence"
// (Zigbee); "no_link", "not_matter", "table_missing", "not_listed", "lqi0" (Thread). Pure. npm test

/** Codes of a hearer whose table was read and does not list the sender. */
const LISTED_NOT = new Set(["capacity_unknown", "table_full", "table_nearly_full", "table_space", "not_listed"]);

/** Glyph for a direction without a reading: "–" where the hearer's table was read and does not list the sender, "?"
 *  where there is no table to ask or the table says LQI 0. */
export function unknownGlyph(reason) {
  return reason && LISTED_NOT.has(reason.code) ? "–" : "?";
}
