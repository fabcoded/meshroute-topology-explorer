// SPDX-License-Identifier: MIT
// Device symbols of the map (spec 8): one closed rounded square per device on
// a 24-unit grid that holds everything about it. Inside, scaled 0.92 about the centre: the device picture, radio arcs
// above it, a cable below it for wired devices; on the right a bed (sleepy end device) or a crown with C (coordinator)
// or L (Thread leader), which moves picture, arcs and cable 3 units left together. Routers have a frame interrupted
// at 8 places with a short stroke in each gap. States: offline no fill, selected a frame of 2.2 grown inwards, pinned
// a small pin inside.
// Geometry: design input ChatGPT (OpenAI), via Fabian Schwamborn; completed by Claude (round 6.2, docs/provenance.md).
// Pure functions plus one drawing function that takes a Canvas 2D context; paths are traced with plain context calls
// (no Path2D), so tests in Node see what is drawn and the legend draws the same symbols.
// npm test

/** Grid of the drawings. */
export const GRID = 24;
/** Symbol size in CSS pixels at zoom 1, one size for every role (design: 32 for the overview, 48 zoomed in). */
export const SYMBOL_SIZE = 32;
/** Symbols grow with the zoom up to this factor (48 px), so they never hide the lanes. */
export const SYMBOL_GROWTH = 1.5;
/** Smallest symbol on screen in CSS pixels when zoomed out. Provisional: not decided yet (spec 8). */
export const SYMBOL_MIN = 20;

/** Outer edge of the frame and its corner radius; a thicker frame grows inwards, the outer edge stays. */
export const OUTER = 0.7;
export const OUTER_RADIUS = 5.05;
export const FRAME_WIDTH = 1.1;
export const SELECTED_WIDTH = 2.2;
/** Router strokes: two per side at 8 and 16, in gaps of 2.6, from the outer edge (round cap) inwards to 2.75. */
const PIN_AT = [8, 16];
const GAP = 2.6;
const PIN_END = 2.75;
const PIN_WIDTH = 1.2;
/** Inner content scale about the centre; keeps 0.3 clear of the router strokes. */
const INNER = 0.92;
/** Horizontal shift of picture, arcs and cable when a mark sits on the right. */
const SHIFT = -3;

/** Device pictures on their own 24 grid, stroked at 2.1 of that grid: rect [x, y, w, h, r], circle [cx, cy, r],
 *  path [d]. Design input ChatGPT (OpenAI), via Fabian Schwamborn. Contact, smoke, water, access point, switch and
 *  Home Assistant wait for sources that can tell them (Thread, wired devices). */
export const PICTURES = Object.freeze({
  light: [["path", "M8 16 C8 13 5 12 5 8 A7 7 0 0 1 19 8 C19 12 16 13 16 16 Z"], ["path", "M9 19 H15 M10 22 H14"]],
  outlet: [["rect", 3, 3, 18, 18, 4], ["circle", 12, 12, 6], ["path", "M9 10 V12 M15 10 V12 M11 16 H13"]],
  relay: [["rect", 3, 4, 18, 16, 2], ["path", "M1 8 H3 M1 16 H3 M21 8 H23 M21 16 H23 M7 14 L15 9 M16 14 H18"]],
  button: [["rect", 4, 3, 16, 18, 4], ["circle", 12, 12, 4]],
  sensor: [["rect", 5, 3, 14, 18, 4], ["circle", 12, 10, 3], ["path", "M10 17 H14"]],
  temperature: [["path", "M9 14 V5 A3 3 0 0 1 15 5 V14 A5 5 0 1 1 9 14 Z"], ["path", "M12 7 V17 M17 6 H20 M17 10 H20"]],
  motion: [["circle", 7, 12, 3], ["path", "M12 6 Q18 12 12 18 M16 3 Q25 12 16 21"]],
  contact: [["rect", 3, 3, 10, 18, 2], ["rect", 17, 7, 4, 10, 1]],
  smoke: [["rect", 3, 3, 18, 8, 3], ["path", "M7 7 H17 M7 15 C3 18 11 18 7 22 M15 15 C11 18 19 18 15 22"]],
  water: [["path", "M12 2 C10 7 5 10 5 15 A7 7 0 0 0 19 15 C19 10 14 7 12 2 Z"], ["path", "M8 16 Q8 19 11 19"]],
  thermostat: [["circle", 12, 12, 9], ["path", "M12 12 L16 8 M7 17 H17"]],
  blind: [["rect", 3, 3, 18, 18, 1], ["path", "M3 7 H21 M3 11 H21 M3 15 H21 M17 15 V20"]],
  lock: [["rect", 4, 10, 16, 11, 2], ["path", "M7 10 V7 A5 5 0 0 1 17 7 V10 M12 14 V17"]],
  hub: [["rect", 3, 7, 18, 14, 3], ["path", "M8 7 V2 M16 7 V2 M7 16 H10 M14 16 H17"]],
  "access-point": [["rect", 5, 14, 14, 7, 2], ["path", "M12 14 V9 M5 7 Q12 1 19 7 M8 10 Q12 6 16 10"]],
  switch: [["rect", 2, 6, 20, 13, 2], ["path", "M5 14 V17 H8 V14 Z M10 14 V17 H13 V14 Z M15 14 V17 H18 V14 Z"]],
  "home-assistant": [["path", "M3 11 L12 3 L21 11 V21 H3 Z"], ["path", "M10 21 V14 H14 V21"]],
  unknown: [["rect", 4, 3, 16, 18, 4], ["path", "M9 8 C9 4 17 5 15 10 L12 13 V14"], ["circle", 12, 18, 0.6]],
});

/** Parts on the inner grid (before the 0.92 scale), each [element, stroke width]. */
const ARCS = [[["path", "M8 5.5 Q12 2.1 16 5.5"], 0.95], [["path", "M10 6.7 Q12 4.8 14 6.7"], 0.9]];
const CABLE = [[["rect", 6, 18, 3, 2.2, 0.3], 0.85], [["path", "M9 19.1 H13 V17.4"], 0.9]];
const CROWN = [[["path", "M14.5 9.2 L16.1 10.5 L17.4 7.8 L18.7 10.5 L20.3 9.2 L19.8 12.7 H15 Z"], 0.85]];
const LETTERS = {
  C: [[["path", "M19 14.5 H17 Q16 14.5 16 15.5 V17 Q16 18 17 18 H19"], 0.95]],
  L: [[["path", "M16.2 14.5 V18 H19.2"], 0.95]],
};
const BED = [[["path", "M14.8 10 V15.6 M14.8 14 H20.3 V15.6 M14.8 12 H20.3 V14"], 0.85],
  [["rect", 15.1, 10.7, 1.6, 1.2, 0.3], 0.7]];
const PINNED = [[["rect", 4.3, 4.6, 1.5, 1.7, 0.15], 0.6], [["path", "M5.05 6.3 V7"], 0.6]];
/** Picture placement on the inner grid: scale and offset, stroke 2.1 of the picture grid. */
const PICTURE_SCALE = 0.46;
const PICTURE_X = 3.18 + 3.3;
const PICTURE_Y = 7;
const PICTURE_WIDTH = 2.1;
/** The slash of "no value under this fill" (spec 8), on the outer grid, drawn under the content. */
export const SLASH = Object.freeze([5.5, 18.5, 18.5, 5.5]);
const SLASH_WIDTH = 1.1;

// ---- path data -------------------------------------------------------------------------------------------------

const f = (v) => +v.toFixed(4);

/** Path data of a rect, circle or path element (absolute commands only). */
export function elementPath(el) {
  const [tag, ...a] = el;
  if (tag === "path") return a[0];
  if (tag === "circle") {
    const [cx, cy, r] = a;
    return `M${f(cx - r)} ${f(cy)} A${r} ${r} 0 1 0 ${f(cx + r)} ${f(cy)} A${r} ${r} 0 1 0 ${f(cx - r)} ${f(cy)} Z`;
  }
  const [x, y, w, h, r] = a;
  return `M${f(x + r)} ${f(y)} H${f(x + w - r)} A${r} ${r} 0 0 1 ${f(x + w)} ${f(y + r)} V${f(y + h - r)} ` +
    `A${r} ${r} 0 0 1 ${f(x + w - r)} ${f(y + h)} H${f(x + r)} A${r} ${r} 0 0 1 ${f(x)} ${f(y + h - r)} V${f(y + r)} ` +
    `A${r} ${r} 0 0 1 ${f(x + r)} ${f(y)} Z`;
}

/** SVG path data (absolute M L H V Q C A Z, circular arcs only, as in the drawings) to context operations:
 *  ["M", x, y], ["L", x, y], ["Q", x1, y1, x, y], ["C", x1, y1, x2, y2, x, y], ["A", cx, cy, r, a0, a1, ccw], ["Z"].
 *  Arcs are converted from endpoint to centre form (SVG 1.1, implementation notes F.6.5, for rx = ry, no rotation). */
export function parsePath(d) {
  const tokens = String(d).match(/[A-Za-z]|-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?/g) || [];
  const ops = [];
  let i = 0;
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  let cmd = null;
  const n = () => {
    const v = Number(tokens[i++]);
    if (!Number.isFinite(v)) throw new Error(`path: number expected in "${d}"`);
    return v;
  };
  while (i < tokens.length) {
    if (/[A-Za-z]/.test(tokens[i])) cmd = tokens[i++];
    if (cmd === "M") { x = n(); y = n(); sx = x; sy = y; ops.push(["M", x, y]); cmd = "L"; }
    else if (cmd === "L") { x = n(); y = n(); ops.push(["L", x, y]); }
    else if (cmd === "H") { x = n(); ops.push(["L", x, y]); }
    else if (cmd === "V") { y = n(); ops.push(["L", x, y]); }
    else if (cmd === "Q") { const q = [n(), n(), n(), n()]; ops.push(["Q", ...q]); [x, y] = q.slice(2); }
    else if (cmd === "C") { const c = [n(), n(), n(), n(), n(), n()]; ops.push(["C", ...c]); [x, y] = c.slice(4); }
    else if (cmd === "A") {
      let r = Math.abs(n());
      n(); // ry: the drawings use circles only
      n(); // rotation: none
      const large = n() !== 0;
      const sweep = n() !== 0;
      const x1 = n();
      const y1 = n();
      const hx = (x - x1) / 2;
      const hy = (y - y1) / 2;
      const d2 = hx * hx + hy * hy;
      if (d2 === 0) continue;
      if (d2 > r * r) r = Math.sqrt(d2); // radius too small for the chord: scaled up, as SVG does
      const k = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, (r * r - d2) / d2));
      const cx = k * hy + (x + x1) / 2;
      const cy = -k * hx + (y + y1) / 2;
      ops.push(["A", cx, cy, r, Math.atan2(y - cy, x - cx), Math.atan2(y1 - cy, x1 - cx), !sweep]);
      x = x1;
      y = y1;
    } else if (cmd === "Z") { ops.push(["Z"]); x = sx; y = sy; cmd = null; }
    else throw new Error(`path: unsupported command "${cmd}" in "${d}"`);
  }
  return ops;
}

/** Operations scaled by s and moved by (tx, ty); circular arcs stay circular under a uniform scale. */
function transformOps(ops, s, tx, ty) {
  return ops.map((op) => {
    switch (op[0]) {
      case "M": case "L": return [op[0], op[1] * s + tx, op[2] * s + ty];
      case "Q": return ["Q", op[1] * s + tx, op[2] * s + ty, op[3] * s + tx, op[4] * s + ty];
      case "C": return ["C", op[1] * s + tx, op[2] * s + ty, op[3] * s + tx, op[4] * s + ty, op[5] * s + tx, op[6] * s + ty];
      case "A": return ["A", op[1] * s + tx, op[2] * s + ty, op[3] * s, op[4], op[5], op[6]];
      default: return op;
    }
  });
}

/** Trace operations on a 2D context (after beginPath). */
export function tracePath(ctx, ops) {
  for (const op of ops) {
    switch (op[0]) {
      case "M": ctx.moveTo(op[1], op[2]); break;
      case "L": ctx.lineTo(op[1], op[2]); break;
      case "Q": ctx.quadraticCurveTo(op[1], op[2], op[3], op[4]); break;
      case "C": ctx.bezierCurveTo(op[1], op[2], op[3], op[4], op[5], op[6]); break;
      case "A": ctx.arc(op[1], op[2], op[3], op[4], op[5], op[6]); break;
      default: ctx.closePath();
    }
  }
}

// ---- composition -----------------------------------------------------------------------------------------------

/** Kinds a device can have (spec 4.2, the shared vocabulary of every network type); each has a picture. "unknown" when
 *  the source does not tell: unknown beats wrong (spec 1). */
export const KINDS = Object.freeze(["light", "outlet", "relay", "button", "sensor", "motion", "temperature",
  "thermostat", "blind", "lock", "hub", "unknown"]);

/** Roles the map knows (spec 4.2, the shared vocabulary of both network types); anything else is drawn as unknown. */
export const ROLES = Object.freeze(["coordinator", "router", "end device", "border router", "unknown"]);

/** Whether a device sleeps: an end device whose receiver is off when idle (spec 4.2; the bed of its symbol). */
export const sleeps = (device) => device.role === "end device" && device.sleepy === true;

/** The signs the legend explains (board M7), one device of the network per sign so each row shows a symbol as the map
 *  draws it, picture included: a router (a light where there is one), an end device (a sleeping one where there is
 *  one), the coordinator, and a device on a cable only. A sign no device carries has no row. Returns [{ parts (of
 *  that device's symbol), role (whose fill colour the row takes), key (its text) }]. */
export function legendSigns(devices) {
  const parts = devices.map((d) => ({ role: d.role, parts: symbolParts(d) }));
  const pick = (...tests) => {
    for (const test of tests) {
      const found = parts.find(test);
      if (found) return found.parts;
    }
    return null;
  };
  const router = pick((x) => x.role === "router" && x.parts.picture === "light", (x) => x.role === "router");
  const end = pick((x) => x.role === "end device" && x.parts.bed, (x) => x.role === "end device");
  const coordinator = pick((x) => x.role === "coordinator");
  const wired = pick((x) => x.parts.cable && !x.parts.radio);
  const signs = [];
  if (router) signs.push({ parts: router, role: "router", key: "legend.symbol_router" });
  if (end) signs.push({ parts: end, role: "end device", key: end.bed ? "legend.symbol_end_sleepy" : "legend.symbol_end" });
  if (coordinator) signs.push({ parts: coordinator, role: "coordinator", key: "legend.symbol_coordinator" });
  if (wired) signs.push({ parts: wired, role: "router", key: "legend.symbol_wired" });
  return signs;
}

/** Which parts a device's symbol has, from the data model's device (role, kind, sleepy) and, for later sources, the
 *  flags radio (default true), wired and leader:
 *  { picture, router, radio, cable, mark: "C" | "L" | null, bed }. Routers, coordinators and border routers get the
 *  router strokes; the coordinator and border routers are also wired (cable); only an end device whose receiver is
 *  off when idle gets the bed. An unknown role gets no strokes, an unknown kind the "unknown" picture. */
export function symbolParts(device = {}) {
  const role = device.role;
  const router = role === "router" || role === "coordinator" || role === "border router";
  const radio = device.radio !== false;
  const kind = role === "coordinator" ? "hub" : device.kind;
  const mark = role === "coordinator" ? "C" : device.leader === true ? "L" : null;
  return {
    picture: Object.prototype.hasOwnProperty.call(PICTURES, kind) ? kind : "unknown",
    router,
    radio,
    cable: !radio || device.wired === true || role === "coordinator" || role === "border router",
    mark,
    bed: !mark && sleeps(device),
  };
}

const cache = new Map();

/** Everything to draw for a symbol, on the outer grid: { fill: ops of the silhouette, strokes: [{ width, cap, join,
 *  ops }] } grouped by stroke style (one colour for all, so the order within the strokes does not matter). Cached per
 *  variant. picture null draws the frame only (legend swatches of a fill). */
export function symbolLayers(parts, { selected = false, pinned = false } = {}) {
  const key = JSON.stringify([parts.picture, parts.router, parts.radio, parts.cable, parts.mark, parts.bed, selected,
    pinned]);
  if (cache.has(key)) return cache.get(key);
  const groups = new Map();
  const add = (ops, width, cap, join) => {
    const k = `${f(width)}|${cap}|${join}`;
    if (!groups.has(k)) groups.set(k, { width: f(width), cap, join, ops: [] });
    groups.get(k).ops.push(...ops);
  };
  const inner = (s, tx, ty) => [INNER * s, INNER * tx + (1 - INNER) * GRID / 2, INNER * ty + (1 - INNER) * GRID / 2];
  const part = (list, dx = 0) => {
    const [s, tx, ty] = inner(1, dx, 0);
    for (const [el, w] of list) add(transformOps(parsePath(elementPath(el)), s, tx, ty), w * INNER, "round", "round");
  };

  // Frame: the stroke's centre line lies half its width inside the outer edge.
  const w = selected ? SELECTED_WIDTH : FRAME_WIDTH;
  const c = OUTER + w / 2;
  const r = OUTER_RADIUS - w / 2;
  if (parts.router) {
    add(parsePath(gappedFrame(c, r)), w, "butt", "miter");
    const a = OUTER + PIN_WIDTH / 2; // the round cap reaches the outer edge
    const b = GRID - a;
    const e = GRID - PIN_END;
    const d = PIN_AT.map((p) => `M${p} ${a} V${PIN_END} M${p} ${b} V${e} M${a} ${p} H${PIN_END} M${b} ${p} H${e}`).join(" ");
    add(parsePath(d), PIN_WIDTH, "round", "round");
  } else {
    add(parsePath(elementPath(["rect", c, c, GRID - 2 * c, GRID - 2 * c, r])), w, "butt", "miter");
  }

  const dx = parts.mark || parts.bed ? SHIFT : 0;
  if (parts.radio) part(ARCS, dx);
  if (parts.cable) part(CABLE, dx + 2.49);
  if (parts.picture) {
    const [s, tx, ty] = inner(PICTURE_SCALE, dx + PICTURE_X, PICTURE_Y);
    for (const el of PICTURES[parts.picture] || PICTURES.unknown) {
      add(transformOps(parsePath(elementPath(el)), s, tx, ty), PICTURE_WIDTH * s, "round", "round");
    }
  }
  if (parts.mark) part([...CROWN, ...LETTERS[parts.mark]]);
  if (parts.bed) part(BED);
  if (pinned) part(PINNED);

  const layers = {
    fill: parsePath(elementPath(["rect", OUTER, OUTER, GRID - 2 * OUTER, GRID - 2 * OUTER, OUTER_RADIUS])),
    strokes: [...groups.values()],
  };
  cache.set(key, layers);
  return layers;
}

/** The router frame: the rounded square at centre line c with corner radius r, open where the strokes sit. */
function gappedFrame(c, r) {
  const e = GRID - c;
  const q = OUTER + OUTER_RADIUS; // where the corner arcs meet the straight sides, the same for every frame width
  const [g1, g2] = PIN_AT.map((p) => [p - GAP / 2, p + GAP / 2]);
  const top = `M${q} ${c} H${g1[0]} M${g1[1]} ${c} H${g2[0]} M${g2[1]} ${c} H${GRID - q}`;
  const right = `A${r} ${r} 0 0 1 ${e} ${q} V${g1[0]} M${e} ${g1[1]} V${g2[0]} M${e} ${g2[1]} V${GRID - q}`;
  const bottom = `A${r} ${r} 0 0 1 ${GRID - q} ${e} H${g2[1]} M${g2[0]} ${e} H${g1[1]} M${g1[0]} ${e} H${q}`;
  const left = `A${r} ${r} 0 0 1 ${c} ${GRID - q} V${g2[1]} M${c} ${g2[0]} V${g1[1]} M${c} ${g1[0]} V${q}`;
  return `${top} ${right} ${bottom} ${left} A${r} ${r} 0 0 1 ${q} ${c}`;
}

// ---- size and contour ------------------------------------------------------------------------------------------

/** Symbol size on screen at zoom k (CSS pixels): 32 at zoom 1, growing to 48, never below SYMBOL_MIN. */
export function symbolSize(k) {
  return Math.max(SYMBOL_MIN, Math.min(SYMBOL_SIZE * k, SYMBOL_SIZE * SYMBOL_GROWTH));
}

/** Distance from a point p (relative to the symbol's centre) along the unit direction u to where it leaves the
 *  symbol's silhouette, a rounded square of the given size; 0 if p is outside. Lanes end there (spec 7.1). */
export function contourExit(px, py, ux, uy, size) {
  const h = (size * (GRID / 2 - OUTER)) / GRID;
  const r = (size * OUTER_RADIUS) / GRID;
  if (Math.abs(px) > h || Math.abs(py) > h) return 0;
  let t = Infinity;
  if (ux !== 0) t = Math.min(t, (Math.sign(ux) * h - px) / ux);
  if (uy !== 0) t = Math.min(t, (Math.sign(uy) * h - py) / uy);
  if (!Number.isFinite(t)) return 0;
  const qx = px + ux * t;
  const qy = py + uy * t;
  const inner = h - r;
  if (Math.abs(qx) <= inner || Math.abs(qy) <= inner) return t;
  // The square's exit lies in a rounded corner: the silhouette ends earlier, on that corner's circle.
  const cx = Math.sign(qx) * inner;
  const cy = Math.sign(qy) * inner;
  const ox = px - cx;
  const oy = py - cy;
  const b = ux * ox + uy * oy;
  const disc = b * b - (ox * ox + oy * oy - r * r);
  return disc < 0 ? t : Math.max(0, -b + Math.sqrt(disc));
}

// ---- drawing ---------------------------------------------------------------------------------------------------

/** Draw a symbol centred at (x, y) with the given size (CSS pixels) on a context whose base transform is dpr.
 *  colors: { fill (background of the symbol), stroke (lines), slash (true: "no value" slash under the content) }.
 *  Sets a transform per symbol and resets it to the dpr transform afterwards. */
export function drawSymbol(ctx, layers, x, y, size, dpr, colors) {
  const s = size / GRID;
  ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * (x - size / 2), dpr * (y - size / 2));
  ctx.beginPath();
  tracePath(ctx, layers.fill);
  ctx.fillStyle = colors.fill;
  ctx.fill();
  ctx.strokeStyle = colors.stroke;
  if (colors.slash) {
    ctx.beginPath();
    ctx.moveTo(SLASH[0], SLASH[1]);
    ctx.lineTo(SLASH[2], SLASH[3]);
    ctx.lineWidth = SLASH_WIDTH;
    ctx.lineCap = "round";
    ctx.stroke();
  }
  for (const g of layers.strokes) {
    ctx.lineWidth = g.width;
    ctx.lineCap = g.cap;
    ctx.lineJoin = g.join;
    ctx.beginPath();
    tracePath(ctx, g.ops);
    ctx.stroke();
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.lineCap = "butt";
  ctx.lineJoin = "miter";
}
