// SPDX-License-Identifier: MIT
// Colours of the map (spec 8): theme resolution, WCAG contrast, the cividis sequence and its contrast-safe part, the
// Okabe–Ito colours of the category fills (role, power source) and the grey for "no value". Pure functions, no DOM.
// The panel passes theme colours in; nothing here depends on Home Assistant.
// Tested in Node: npm test

/** cividis at t = 0, 1/16, ..., 1: 17 values of the published table (Nuñez, Anderton and Renslow 2018, PLOS ONE,
 *  doi:10.1371/journal.pone.0199239, supplement S2, CC BY 4.0; see NOTICE). Linear interpolation between them stays
 *  within about 4 ΔE of the full 256-entry table. */
const CIVIDIS = [
  "#00204d", "#002c69", "#05366e", "#2d426c", "#414d6b", "#52596c", "#61646f", "#6f7073", "#7c7c78",
  "#8b8779", "#9b9477", "#aca174", "#bcaf6f", "#cebc68", "#e0cb5e", "#f2da50", "#ffea46",
].map((hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)));

/** Light and dark defaults, used for anything the caller leaves out. */
export const LIGHT = Object.freeze({
  background: "#ffffff", foreground: "#212121", muted: "#6b6b6b", accent: "#0b62a4", font: "12px sans-serif",
});
export const DARK = Object.freeze({
  background: "#111111", foreground: "#e1e1e1", muted: "#9a9a9a", accent: "#4fb3f0", font: "12px sans-serif",
});

/** Minimum contrast of graphic elements against the background (WCAG 2.2, 1.4.11). */
export const MIN_CONTRAST = 3;

/** Parse "#rgb", "#rrggbb", "rgb(r, g, b)" or "rgba(...)" into [r, g, b] (0..255); null for anything else. */
export function parseColor(text) {
  if (typeof text !== "string") return null;
  const s = text.trim().toLowerCase();
  let m = /^#([0-9a-f]{3})$/.exec(s);
  if (m) return [...m[1]].map((c) => parseInt(c + c, 16));
  m = /^#([0-9a-f]{6})$/.exec(s);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(s);
  if (m) return [m[1], m[2], m[3]].map((v) => Math.max(0, Math.min(255, Math.round(Number(v)))));
  return null;
}

export function toHex([r, g, b]) {
  return "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
}

/** Relative luminance per WCAG 2.2 (sRGB). */
export function luminance([r, g, b]) {
  const lin = (v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrastRatio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

/** Shift a colour towards black or white (whichever the background is further from) until it reaches the minimum
 *  contrast. Theme colours come from users' themes; this keeps symbols visible whatever they chose. */
export function ensureContrast(color, background, min = MIN_CONTRAST) {
  if (contrastRatio(color, background) >= min) return color;
  const target = luminance(background) > 0.18 ? [0, 0, 0] : [255, 255, 255];
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (contrastRatio(mix(color, target, mid), background) >= min) hi = mid; else lo = mid;
  }
  // Rounding to whole channel values can lose a hair of contrast: step on until the rounded colour qualifies.
  let out = mix(color, target, hi).map(Math.round);
  while (contrastRatio(out, background) < min && hi < 1) {
    hi = Math.min(1, hi + 0.005);
    out = mix(color, target, hi).map(Math.round);
  }
  return out;
}

/** cividis at t in [0, 1] as [r, g, b]. Linear interpolation between the anchors. */
export function cividis(t) {
  const x = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0)) * (CIVIDIS.length - 1);
  const i = Math.min(CIVIDIS.length - 2, Math.floor(x));
  return mix(CIVIDIS[i], CIVIDIS[i + 1], x - i).map(Math.round);
}

/** The widest stretch [lo, hi] of cividis that keeps 3:1 against the background. Lines have no outline of their own,
 *  so on a light theme they use the dark part and on a dark theme the light part; the legend shows the same stretch.
 *  If less than a third of the map qualifies (a mid-grey background), the whole map is used and lines get a casing. */
export function contrastRange(background, min = MIN_CONTRAST) {
  const steps = 100;
  let best = [0, -1];
  let start = -1;
  for (let i = 0; i <= steps + 1; i++) {
    const ok = i <= steps && contrastRatio(cividis(i / steps), background) >= min;
    if (ok && start < 0) start = i;
    if (!ok && start >= 0) {
      if (i - 1 - start > best[1] - best[0]) best = [start, i - 1];
      start = -1;
    }
  }
  const lo = best[0] / steps;
  const hi = best[1] / steps;
  return hi - lo >= 1 / 3 ? { lo, hi, casing: false } : { lo: 0, hi: 1, casing: true };
}

/** CIELAB of an sRGB colour (D65 white; IEC 61966-2-1 matrix, CIE 15 formulas), for colour distances. */
export function toLab([r, g, b]) {
  const lin = (v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : t / (3 * (6 / 29) ** 2) + 4 / 29);
  const fx = f((0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047);
  const fy = f(0.2126729 * R + 0.7151522 * G + 0.072175 * B);
  const fz = f((0.0193339 * R + 0.119192 * G + 0.9503041 * B) / 1.08883);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** Colour distance ΔE (CIE 1976) between two sRGB colours. */
export function deltaE(a, b) {
  const p = toLab(a);
  const q = toLab(b);
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

/** The grey for "no value under this fill" (not rated, no category). It lies in the lightness gap between the
 *  theme's stretch of the rating scale and the background (lighter than every rating colour on a light theme, darker
 *  on a dark one), as far (ΔE) from both as possible. A fixed grey sat inside the scale: #707070 matched the weakest
 *  tenth on dark themes, #a3a3a3 the strongest on light ones, so weak reception looked unrated. Black or white would
 *  be further in ΔE but read like the scale's navy or yellow end at symbol size. Returns the grey and its smallest
 *  distance to scale and background. */
export function noValueGrey(background, range) {
  const scale = [];
  for (let t = range.lo; t <= range.hi + 1e-9; t += (range.hi - range.lo) / 64) scale.push(toLab(cividis(t)));
  const bg = toLab(background);
  const lightest = Math.max(...scale.map((c) => c[0]));
  const darkest = Math.min(...scale.map((c) => c[0]));
  const inGap = (l) => {
    if (bg[0] > lightest) return l > lightest && l < bg[0];
    if (bg[0] < darkest) return l < darkest && l > bg[0];
    return true; // a background inside the scale's lightness: no gap, take the best grey anywhere
  };
  let best = { grey: [128, 128, 128], gap: -1 };
  for (let v = 0; v <= 255; v++) {
    const lab = toLab([v, v, v]);
    if (!inGap(lab[0])) continue;
    let gap = Math.hypot(lab[0] - bg[0], lab[1] - bg[1], lab[2] - bg[2]);
    for (const s of scale) gap = Math.min(gap, Math.hypot(lab[0] - s[0], lab[1] - s[1], lab[2] - s[2]));
    if (gap > best.gap) best = { grey: [v, v, v], gap };
  }
  return best;
}

/** Okabe–Ito colours for categories (Okabe and Ito 2008, "Color Universal Design"), spec 8. */
export const OKABE_ITO = Object.freeze({
  black: "#000000", orange: "#e69f00", skyBlue: "#56b4e9", bluishGreen: "#009e73", yellow: "#f0e442",
  blue: "#0072b2", vermillion: "#d55e00", reddishPurple: "#cc79a7",
});

/** Fills a user can choose (spec 8); "none" (neutral grey) is the default. Reception is shown at the arrows, not in
 *  the symbols (decision by Fabian Schwamborn, 2026-11-01). Relay load arrives with the route view (v1.1). */
export const FILLS = Object.freeze(["none", "role", "power"]);

/** Neutral symbol grey of the "none" fill per theme brightness, as designed (spec 8). */
export const NEUTRAL = Object.freeze({ light: "#c5c8cb", dark: "#5c6166" });

/** Category -> Okabe–Ito colour per fill. Only the four colours that come close to 3:1 on white and on near-black
 *  are used (blue, bluish green, vermillion, reddish purple), so one mapping serves light and dark themes and the
 *  legend means the same in both; resolveTheme nudges the rest of the way. Devices without a category stay grey.
 *  Shape and outline still carry role and state, and the text views list both, so colour never carries meaning
 *  alone. */
export const CATEGORY_FILLS = Object.freeze({
  role: Object.freeze({ coordinator: "vermillion", router: "bluishGreen", "end device": "blue",
    "border router": "reddishPurple" }),
  power: Object.freeze({ mains: "blue", battery: "reddishPurple", dc: "bluishGreen" }),
});

/** Power category from ZHA's power source text: "Mains (single phase)" and "Emergency Mains ..." are mains;
 *  "Battery" and "Battery or Unknown" (ZHA's word for anything not mains powered) are battery; "DC Source" is dc;
 *  anything else, or nothing, has no category. */
export function powerCategory(text) {
  if (typeof text !== "string") return null;
  if (/battery/i.test(text)) return "battery";
  if (/mains/i.test(text)) return "mains";
  if (/\bdc\b/i.test(text)) return "dc";
  return null;
}

/** Fill colour of a node { role, power } under a fill; null means no value (the grey node colour with a slash). The
 *  "none" fill is the neutral grey for every device, so it always has a value. */
export function fillColor(node, fill, theme) {
  if (fill === "role" || fill === "power") {
    const key = fill === "role" ? node.role : node.power;
    return (key && theme.categories[fill][key]) || null;
  }
  return theme.neutral;
}

/** Opt-in colours of lanes by reception (request by Fabian Schwamborn, 2026-11-01: red over yellow to green), per
 *  theme brightness: weakest, middle and strongest rating. Own choice of shades: each keeps 3:1 against the default
 *  light (#ffffff, #fafafa) or dark (#111111, #1c1c1c) background, and the three differ by at least 8 in CIELAB
 *  lightness (light: 49, 58, 41; dark: 60, 81, 68), so they stay apart without hue too. Dash, width and the value
 *  beside the lane still say everything: colour never carries meaning alone (spec 8).
 *  The user may replace any of the three with an own colour (design by Fabian Schwamborn, 2026-11-01: "frei wählbar,
 *  z. B. für Farbenblinde"); it is nudged to 3:1 like these. */
export const RECEPTION_STOPS = Object.freeze({
  light: Object.freeze(["#d93a26", "#b58300", "#1d6f31"]),
  dark: Object.freeze(["#f2604d", "#f2c230", "#3fbd5c"]),
});
/** Steps of the precomputed reception scale: far finer than the eye tells apart on a 3 px line. */
const RECEPTION_STEPS = 64;

/** The theme's own stops for a background (dark or light). */
export function receptionStops(dark) {
  return dark ? RECEPTION_STOPS.dark : RECEPTION_STOPS.light;
}

/** The reception scale for a background: RECEPTION_STEPS + 1 colours from weakest to strongest, interpolated in sRGB
 *  between the stops and each nudged to 3:1 against the background (a user's theme may differ from the defaults).
 *  custom: [bad, medium, good], each a colour that replaces the theme's stop, or null to keep it. */
function receptionScale(bg, custom = []) {
  const own = receptionStops(luminance(bg) < 0.18);
  const stops = own.map((c, i) => parseColor(Array.isArray(custom) && custom[i]) || parseColor(c));
  const out = [];
  for (let i = 0; i <= RECEPTION_STEPS; i++) {
    const x = (i / RECEPTION_STEPS) * (stops.length - 1);
    const j = Math.min(stops.length - 2, Math.floor(x));
    out.push(toHex(ensureContrast(mix(stops[j], stops[j + 1], x - j).map(Math.round), bg)));
  }
  return Object.freeze(out);
}

/** Colour of a lane under "colour by reception": its reading's rating (0..1, relative to the hearer, spec 5.4) on the
 *  theme's red-yellow-green scale; null for no rating (the lane keeps its class colour). */
export function receptionColor(rating, theme) {
  if (typeof rating !== "number" || !Number.isFinite(rating) || !theme || !theme.reception) return null;
  return theme.reception[Math.round(Math.max(0, Math.min(1, rating)) * RECEPTION_STEPS)];
}

/** Complete theme with derived colours as hex strings. Unknown or unparsable entries fall back to the light or dark
 *  default, picked by the background's luminance. The grey of devices without a value (node) is always derived
 *  (noValueGrey), so it cannot be mistaken for a rating. input.receptionStops: the user's [bad, medium, good] (each
 *  a colour or null) for colour by reception. */
export function resolveTheme(input = {}) {
  const bgIn = parseColor(input.background);
  const base = bgIn && luminance(bgIn) < 0.18 ? DARK : LIGHT;
  const pick = (key) => parseColor(input[key]) || parseColor(base[key]);
  const bg = pick("background");
  const fg = ensureContrast(pick("foreground"), bg, 4.5);
  const muted = ensureContrast(pick("muted"), bg);
  const range = contrastRange(bg);
  const categories = {};
  for (const [fill, map] of Object.entries(CATEGORY_FILLS)) {
    categories[fill] = Object.fromEntries(Object.entries(map).map(([key, name]) =>
      [key, toHex(ensureContrast(parseColor(OKABE_ITO[name]), bg))]));
  }
  return {
    background: toHex(bg),
    foreground: toHex(fg),
    outline: toHex(fg),
    muted: toHex(muted),
    node: toHex(noValueGrey(bg, range).grey),
    neutral: luminance(bg) < 0.18 ? NEUTRAL.dark : NEUTRAL.light,
    accent: toHex(ensureContrast(pick("accent"), bg)),
    font: typeof input.font === "string" && input.font ? input.font : base.font,
    lineRange: range,
    categories,
    reception: receptionScale(bg, input.receptionStops),
    dark: luminance(bg) < 0.18,
  };
}

/** Line colour of a symbol on a background fill (spec 8): the theme's foreground or background, whichever contrasts
 *  more with the fill. Device pictures are drawn on the fill, so dark lines vanish on the navy end of the rating scale
 *  and light lines on its yellow end; the frame flips with them, while the fill keeps the outline against the map. */
export function lineColorOn(fill, theme) {
  const f = parseColor(fill);
  if (!f) return theme.foreground;
  const fg = parseColor(theme.foreground);
  const bg = parseColor(theme.background);
  return contrastRatio(fg, f) >= contrastRatio(bg, f) ? theme.foreground : theme.background;
}

/** Colour of a rating (0..1, spec 5.4) inside the theme's contrast-safe stretch of cividis; null for unknown. Lines,
 *  lanes and device fills share this one scale, so the legend needs a single bar per theme. */
export function ratingColor(rating, theme) {
  if (typeof rating !== "number" || !Number.isFinite(rating)) return null;
  const { lo, hi } = theme.lineRange;
  return toHex(cividis(lo + (hi - lo) * Math.max(0, Math.min(1, rating))));
}
