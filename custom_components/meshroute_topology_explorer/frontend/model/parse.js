// SPDX-License-Identifier: MIT
// Parsers for the text and number forms Home Assistant uses for addresses and link quality (spec 3.1, "known traps").
// Pure functions, no DOM. Tested in Node: node --test tests/

/** Parse an address or number that arrives as hex text ("0x0D", "0X0d"), decimal text or a number.
 *  Returns a number, or null for anything else. Never compare such text as strings ("0x0D" vs "0x000d"). */
export function parseAddress(value) {
  if (typeof value === "number") return Number.isInteger(value) && value >= 0 ? value : null;
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (/^0[xX][0-9a-fA-F]+$/.test(text)) return parseInt(text.slice(2), 16);
  if (/^[0-9]+$/.test(text)) return parseInt(text, 10);
  return null;
}

/** LQI arrives as text ("157"); numbers are accepted too. Null if it is not a plain non-negative number. */
export function parseLqi(value) {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value !== "string" || !/^\s*[0-9]+\s*$/.test(value)) return null;
  return parseInt(value, 10);
}

const EUI64 = /^[0-9a-f]{2}(?::[0-9a-f]{2}){7}$/;

/** Device key: the IEEE address in lower-case colon form, or null when the value is not a usable EUI-64.
 *  The all-zero and all-ff addresses are placeholders in neighbour tables, not devices. */
export function normalizeIeee(value) {
  if (typeof value !== "string") return null;
  const text = value.trim().toLowerCase();
  if (!EUI64.test(text) || /^(00(:00){7}|ff(:ff){7})$/.test(text)) return null;
  return text;
}

/** "0x" plus four upper-case hex digits, for labels that must tell identical names apart. */
export function formatNwk(nwk) {
  return typeof nwk === "number" ? "0x" + nwk.toString(16).toUpperCase().padStart(4, "0") : "?";
}
