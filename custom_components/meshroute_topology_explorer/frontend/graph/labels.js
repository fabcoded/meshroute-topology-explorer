// SPDX-License-Identifier: MIT
// Label text and visibility rules of the map (spec 8). The text itself comes from the data model (device.label,
// already unique); this module only shortens it to fit and decides when everyone is labelled. Pure functions, no
// DOM: text width comes from an injected measure(text) function. Labels are drawn as canvas text, never as HTML.
// node --test tests/

export const ELLIPSIS = "…";
/** Widest label at zoom 1, in CSS pixels; about 20 characters of the 12 px label font. Own choice. */
export const MAX_LABEL_WIDTH = 128;

/** Indices where a word starts (after a space), in ascending order. */
function wordStarts(name) {
  const out = [];
  for (let i = 1; i < name.length; i++) if (name[i - 1] === " " && name[i] !== " ") out.push(i);
  return out;
}

/** Shorten one name to maxWidth by cutting its beginning at a word start, never the part that tells it apart (spec 8):
 *  - with similar names (sharing at least one whole leading word) only the shared beginning may go, up to the first
 *    character that differs from the most similar one;
 *  - the kept end must not be the end of another name ("…ceiling lamp" could be either of two lamps).
 *  Cuts fall on word starts only; if no word start in the allowed range gives a tail that fits, the cut moves to the
 *  previous word start and the label is wider than maxWidth. No word start at all: the name stays whole. */
export function shortenName(name, others, measure, maxWidth = MAX_LABEL_WIDTH) {
  if (measure(name) <= maxWidth) return name;
  let common = 0;
  for (const other of others) {
    if (other === name) continue;
    let c = 0;
    while (c < name.length && c < other.length && name[c] === other[c]) c++;
    if (c > common) common = c;
  }
  const similar = name.lastIndexOf(" ", common - 1) >= 0;
  let limit = similar ? common : name.length - 1;
  // A tail that is the end of another name is not unique; the limit moves back until it is.
  while (limit > 0 && others.some((o) => o !== name && o.endsWith(name.slice(limit)))) limit--;
  const starts = wordStarts(name).filter((i) => i <= limit);
  if (!starts.length) return name;
  const fits = (i) => measure(ELLIPSIS + name.slice(i)) <= maxWidth;
  const cut = starts.find(fits) ?? starts[starts.length - 1];
  return ELLIPSIS + name.slice(cut);
}

/** Display labels for a device list, in the same order: the model's label (the id if it has none), shortened against
 *  the others. */
export function displayLabels(devices, measure, maxWidth = MAX_LABEL_WIDTH) {
  const names = devices.map((d) => (typeof d.label === "string" && d.label.trim()) || String(d.id || "?"));
  return names.map((name) => shortenName(name, names, measure, maxWidth));
}

/** Scale of the map in label widths: the median distance from each device to its nearest neighbour on screen,
 *  divided by the mean label width. The working scale of spec 7.1 is where this equals the density D. */
/** Everyone may carry a label (where there is room) from this scale on: devices are half a label apart, so most
 *  labels find a free place around their device. Below it only the coordinator, the focus and its neighbours are
 *  labelled (spec 8). Own choice, below the densest working scale (0.7) so every working scale shows labels. */
export const LABEL_SCALE = 0.5;

/** Whether everyone may be labelled at this zoom; labelZoom is the zoom at which the scale reaches LABEL_SCALE. */
export function labelsForAll(zoom, labelZoom) {
  return zoom >= labelZoom * (1 - 1e-9);
}
