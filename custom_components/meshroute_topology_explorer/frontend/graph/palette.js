// SPDX-License-Identifier: MIT
// Colours of the map (spec 8): theme resolution, WCAG contrast, the Okabe–Ito colours of the category fills (role,
// power source) and the grey for "no value". Pure functions, no DOM.
// The panel passes theme colours in; nothing here depends on Home Assistant.
// Tested in Node: npm test

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

/** Okabe–Ito colours for categories (Okabe and Ito 2008, "Color Universal Design"), spec 8. */
export const OKABE_ITO = Object.freeze({
  black: "#000000", orange: "#e69f00", skyBlue: "#56b4e9", bluishGreen: "#009e73", yellow: "#f0e442",
  blue: "#0072b2", vermillion: "#d55e00", reddishPurple: "#cc79a7",
});

/** Fills a user can choose (spec 8); "none" (neutral grey) is the default. Reception is shown at the arrows, not in
 *  the symbols. Relay load arrives with the route view (v1.1). */
export const FILLS = Object.freeze(["none", "role", "power"]);

/** Grey of a device without a value under the current fill, per theme brightness: a fixed pair (spec 8). */
export const NO_VALUE = Object.freeze({ light: "#bfbfbf", dark: "#393939" });

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

/** Opt-in colours of lanes by reception (red over yellow to green), per
 *  theme brightness: weakest, middle and strongest rating. Own choice of shades: each keeps 3:1 against the default
 *  light (#ffffff, #fafafa) or dark (#111111, #1c1c1c) background, and the three differ by at least 8 in CIELAB
 *  lightness (light: 49, 58, 41; dark: 60, 81, 68), so they stay apart without hue too. Dash, width and the value
 *  beside the lane still say everything: colour never carries meaning alone (spec 8).
 *  The user may replace any of the three with an own colour ("frei wählbar,
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
 *  default, picked by the background's luminance. input.receptionStops: the user's [bad, medium, good] (each
 *  a colour or null) for colour by reception. */
export function resolveTheme(input = {}) {
  const bgIn = parseColor(input.background);
  const base = bgIn && luminance(bgIn) < 0.18 ? DARK : LIGHT;
  const pick = (key) => parseColor(input[key]) || parseColor(base[key]);
  const bg = pick("background");
  const fg = ensureContrast(pick("foreground"), bg, 4.5);
  const muted = ensureContrast(pick("muted"), bg);
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
    node: luminance(bg) < 0.18 ? NO_VALUE.dark : NO_VALUE.light,
    neutral: luminance(bg) < 0.18 ? NEUTRAL.dark : NEUTRAL.light,
    accent: toHex(ensureContrast(pick("accent"), bg)),
    font: typeof input.font === "string" && input.font ? input.font : base.font,
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
