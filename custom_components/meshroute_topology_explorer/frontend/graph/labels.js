// SPDX-License-Identifier: MIT
// Label text and visibility rules of the map (spec 8). Pure functions, no DOM: text width comes from an injected
// measure(text) function (the canvas in the browser, a fixed character width in tests). Labels are drawn as canvas
// text, never as HTML.  node --test tests/

export const ELLIPSIS = "…";
/** Widest label at zoom 1, in CSS pixels; about 20 characters of the 12 px label font. Own choice. */
export const MAX_LABEL_WIDTH = 128;
/** Below this value of zoom × density only the selection, the device under the pointer and their neighbours carry
 *  labels. At 0.4 the shortest spring (L0 × D, where L0 holds one label) is drawn at 40 % of a label width, so
 *  labels would overlap their neighbours almost everywhere. Own choice, checked on screenshots of the sample. */
export const LABEL_ZOOM = 0.4;
/** How far a cut may move forward to land on a word start, in characters: a little tidier, little lost. */
const WORD_SNAP = 5;

/** Suffix shown for identical names: the network address when the source has one, else the end of the IEEE
 *  address (the Network interface of the graph core carries no network address). */
function addressSuffix(device) {
  if (Number.isInteger(device.nwk) && device.nwk >= 0) return "0x" + device.nwk.toString(16).toUpperCase().padStart(4, "0");
  const id = String(device.id || "");
  return id.length > 5 ? id.slice(-5) : id;
}

/** Full names with duplicates told apart: identical names (after trimming) get the address appended. */
export function uniqueNames(devices) {
  const base = devices.map((d) => (typeof d.label === "string" && d.label.trim()) || String(d.id || "?"));
  const count = new Map();
  for (const name of base) count.set(name, (count.get(name) || 0) + 1);
  return base.map((name, i) => (count.get(name) > 1 ? `${name} (${addressSuffix(devices[i])})` : name));
}

/** Shorten one name to maxWidth by cutting its beginning, never the part that tells it apart (spec 8):
 *  - with similar names (sharing at least one whole leading word) only the shared beginning may go, up to the first
 *    character that differs from the most similar one;
 *  - the kept tail must not be the end of another name ("…ceiling lamp" could be either of two lamps); where that
 *    limits the cut, it moves back to a word start so the deciding word stays whole.
 *  If the protected part does not fit, the label stays wider than maxWidth. Other cuts prefer a nearby word start. */
export function shortenName(name, others, measure, maxWidth = MAX_LABEL_WIDTH) {
  if (measure(name) <= maxWidth) return name;
  const last = name.length - 1;
  let common = 0;
  for (const other of others) {
    if (other === name) continue;
    let c = 0;
    while (c < name.length && c < other.length && name[c] === other[c]) c++;
    if (c > common) common = c;
  }
  const similar = name.lastIndexOf(" ", common - 1) >= 0;
  const sharedLimit = similar ? Math.min(common, last) : last;
  // Largest cut that keeps the tail unique. Monotone: a longer tail of a unique tail is unique too.
  let uniqueCut = last;
  while (uniqueCut > 0 && others.some((o) => o !== name && o.endsWith(name.slice(uniqueCut)))) uniqueCut--;
  // Smallest cut whose tail fits, i.e. the longest tail that fits.
  let cut = 1;
  while (cut < last && measure(ELLIPSIS + name.slice(cut)) > maxWidth) cut++;
  cut = Math.min(cut, sharedLimit);
  const midWord = (i) => i > 0 && name[i - 1] !== " ";
  if (cut > uniqueCut) {
    cut = uniqueCut;
    if (midWord(cut)) cut = name.lastIndexOf(" ", cut - 1) + 1;
  } else if (midWord(cut)) {
    const next = name.indexOf(" ", cut) + 1;
    if (next > 0 && next <= Math.min(sharedLimit, uniqueCut) && next - cut <= WORD_SNAP) cut = next;
  }
  return cut > 0 ? ELLIPSIS + name.slice(cut).replace(/^\s+/, "") : name;
}

/** Display labels for a device list, in the same order: unique, then shortened against each other. */
export function displayLabels(devices, measure, maxWidth = MAX_LABEL_WIDTH) {
  const names = uniqueNames(devices);
  return names.map((name) => shortenName(name, names, measure, maxWidth));
}

/** Whether every device may carry a label (subject to overlap) or only the focus and its neighbours. */
export function labelsForAll(zoom, density) {
  return zoom * density >= LABEL_ZOOM;
}
