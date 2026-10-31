// SPDX-License-Identifier: MIT
// Colours of the map (spec 8): theme resolution, WCAG contrast, the cividis sequence and its contrast-safe part, and
// the Okabe–Ito colours of the category fills (role, power source). Pure functions, no DOM. The panel passes theme colours in; nothing here depends on Home Assistant.
// Tested in Node: node --test tests/

/** cividis at t = 0, 1/16, ..., 1: 17 values of the published table (Nuñez, Anderton and Renslow 2018, PLOS ONE,
 *  doi:10.1371/journal.pone.0199239, supplement S2, CC BY 4.0; see NOTICE). Linear interpolation between them stays
 *  within about 4 ΔE of the full 256-entry table. */
const CIVIDIS = [
  "#00204d", "#002c69", "#05366e", "#2d426c", "#414d6b", "#52596c", "#61646f", "#6f7073", "#7c7c78",
  "#8b8779", "#9b9477", "#aca174", "#bcaf6f", "#cebc68", "#e0cb5e", "#f2da50", "#ffea46",
].map((hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)));

/** Light and dark defaults, used for anything the caller leaves out. */
export const LIGHT = Object.freeze({
  background: "#ffffff", foreground: "#212121", muted: "#6b6b6b", node: "#a3a3a3", accent: "#0b62a4",
  font: "12px sans-serif",
});
export const DARK = Object.freeze({
  background: "#111111", foreground: "#e1e1e1", muted: "#9a9a9a", node: "#707070", accent: "#4fb3f0",
  font: "12px sans-serif",
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
 *  contrast. Theme colours come from users' themes; this keeps markers visible whatever they chose. */
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

/** Okabe–Ito colours for categories (Okabe and Ito 2008, "Color Universal Design"), spec 8. */
export const OKABE_ITO = Object.freeze({
  black: "#000000", orange: "#e69f00", skyBlue: "#56b4e9", bluishGreen: "#009e73", yellow: "#f0e442",
  blue: "#0072b2", vermillion: "#d55e00", reddishPurple: "#cc79a7",
});

/** Fills a user can choose (spec 8); reception is the default. Relay load arrives with the route view (v1.1). */
export const FILLS = Object.freeze(["reception", "role", "power"]);

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

/** Fill colour of a node { role, rating, power } under a fill; null means the theme's grey node colour. */
export function fillColor(node, fill, theme) {
  if (fill === "role" || fill === "power") {
    const key = fill === "role" ? node.role : node.power;
    return (key && theme.categories[fill][key]) || null;
  }
  return ratingColor(node.rating, theme);
}

/** Complete theme with derived colours as hex strings. Unknown or unparsable entries fall back to the light or dark
 *  default, picked by the background's luminance. */
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
    node: toHex(pick("node")),
    accent: toHex(ensureContrast(pick("accent"), bg)),
    font: typeof input.font === "string" && input.font ? input.font : base.font,
    lineRange: range,
    categories,
    dark: luminance(bg) < 0.18,
  };
}

/** Colour of a rating (0..1, spec 5.4) inside the theme's contrast-safe stretch of cividis; null for unknown. Lines,
 *  lanes and device fills share this one scale, so the legend needs a single bar per theme. */
export function ratingColor(rating, theme) {
  if (typeof rating !== "number" || !Number.isFinite(rating)) return null;
  const { lo, hi } = theme.lineRange;
  return toHex(cividis(lo + (hi - lo) * Math.max(0, Math.min(1, rating))));
}
