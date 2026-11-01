// SPDX-License-Identifier: MIT
// The Legend tab of the right panel (spec 8: it explains the current view and fill; design by Fabian Schwamborn,
// 2026-11-01): communication paths with "RX:" and, while paths are coloured, the colour scale; the fill (when one is
// chosen); the symbols, the pictures present and the states. It is the only legend: nothing appears twice. Colours come
// from the resolved map theme, the links part from the graph's own legend entries (link-legend.js) and the symbols are
// drawn by the map's own drawSymbol (graph/symbols.js), so legend and map always agree. Runs in the browser.
import { h, svg } from "./dom.js";
import { lineColorOn, CATEGORY_FILLS } from "../graph/palette.js";
import { drawSymbol, symbolLayers, symbolParts } from "../graph/symbols.js";
import { linkLegendList } from "./link-legend.js";

/** Symbols in the Legend tab are drawn at 48 px (design: 32 px for the overview, 48 px zoomed, in details and legend). */
const SWATCH = 48;

/** [{ label, color, slash }] of the category fill; the grey "none" entry last. */
function categoryEntries(fill, theme, t, roles) {
  const out = [];
  if (fill === "role") {
    for (const role of Object.keys(CATEGORY_FILLS.role)) {
      if (roles.has(role)) out.push({ label: t(`role.${role}`), color: theme.categories.role[role] });
    }
    if (roles.has("unknown")) out.push({ label: t("role.unknown"), color: theme.node, slash: true });
  } else {
    for (const key of Object.keys(CATEGORY_FILLS.power)) out.push({ label: t(`power.${key}`), color: theme.categories.power[key] });
    out.push({ label: t("power.none"), color: theme.node, slash: true });
  }
  return out;
}

/** Colour key of a fill: the symbols' silhouette (rounded square) in that colour. slash: the map's mark for a device
 *  without a value under the current fill. */
function chip({ fill, outline, slash = false, size = 24 }) {
  const el = svg("svg", { viewBox: "0 0 24 24", width: size, height: size, "aria-hidden": "true" });
  el.append(svg("rect", { x: 1.25, y: 1.25, width: 21.5, height: 21.5, rx: 4.5, fill, stroke: outline, "stroke-width": 1.5 }));
  if (slash) el.append(svg("path", { d: "M5.5 18.5L18.5 5.5", stroke: outline, "stroke-width": 1.5, "stroke-linecap": "round" }));
  return el;
}

/** A symbol as the map draws it, on its own canvas. device: what symbolParts reads, or parts directly (with
 *  `picture`); state: { selected, pinned, offline }. */
function symbolSwatch(device, theme, fill, state = {}, px = SWATCH) {
  const dpr = globalThis.devicePixelRatio || 1;
  const el = h("canvas", { width: Math.round(px * dpr), height: Math.round(px * dpr), "aria-hidden": "true",
    style: { width: `${px}px`, height: `${px}px`, flex: "none" } });
  const parts = "picture" in device ? device : symbolParts(device);
  const background = state.offline ? theme.background : fill;
  drawSymbol(el.getContext("2d"), symbolLayers(parts, state), px / 2, px / 2, px, dpr,
    { fill: background, stroke: fill === theme.neutral ? theme.foreground : lineColorOn(background, theme), slash: false });
  return el;
}

/** Parts without picture, arcs or cable: one sign at a time. */
const bare = (extra = {}) => ({ picture: null, router: false, radio: false, cable: false, mark: null, bed: false, ...extra });

/** "RX:" over a value, as the map writes it beside a lane. */
function rxSample(t) {
  return h("span", { class: "rx-sample", "aria-hidden": "true" }, h("span", { class: "muted", text: t("lane.rx") }),
    h("strong", { text: "103" }));
}

/** The Legend tab. ctx: { t, theme (resolved), fill, roles (Set of roles in the network), devices (the network's
 *  devices: which pictures and marks to explain), links (GraphView.legend()), debug }. */
export function renderLegend(container, { t, theme, fill, roles, devices = [], links, debug }) {
  container.replaceChildren();
  // Communication paths: what the graph says it draws (three classes without colour, implied lanes, widths, glyphs,
  // band, path hops, the scale while paths are coloured), then the value at an arrow.
  const list = linkLegendList(links || [], t);
  list.append(h("li", {}, rxSample(t), h("span", { text: t("legend.rx") })));
  container.append(h("h3", { text: t("legend.paths_title") }), list,
    h("p", { class: "small muted", text: t("legend.links_default") }),
    h("p", { class: "small muted", text: t("legend.rank") }));
  if (debug) container.append(h("p", { class: "small muted", text: t("legend.debug") }));

  if (fill !== "none") {
    container.append(h("h3", { text: t(`legend.fill_${fill}`) }), h("ul", { class: "swatches" },
      categoryEntries(fill, theme, t, roles).map((e) =>
        h("li", {}, chip({ fill: e.color, outline: theme.outline, slash: e.slash }), h("span", { text: e.label })))));
  }

  // Symbols carry a value of the current fill, never the grey that means "no value"; the "none" fill is the neutral grey.
  const typical = (role) => (fill === "role" ? theme.categories.role[role] || theme.categories.role.router
    : fill === "power" ? theme.categories.power.mains : theme.neutral);
  const parts = devices.map((d) => symbolParts(d));
  const has = (key) => parts.some((p) => p[key]);
  const item = (swatch, key) => h("li", {}, swatch, h("span", { text: t(key) }));
  const signs = [];
  if (has("router")) signs.push(item(symbolSwatch(bare({ router: true }), theme, typical("router")), "legend.symbol_router"));
  if (roles.has("end device")) signs.push(item(symbolSwatch(bare(), theme, typical("end device")), "legend.symbol_end"));
  if (has("radio")) signs.push(item(symbolSwatch(bare({ radio: true }), theme, typical("end device")), "legend.symbol_radio"));
  if (has("cable")) signs.push(item(symbolSwatch(bare({ cable: true }), theme, typical("coordinator")), "legend.symbol_cable"));
  if (roles.has("coordinator")) {
    signs.push(item(symbolSwatch(bare({ router: true, mark: "C" }), theme, typical("coordinator")), "legend.symbol_coordinator"));
  }
  if (has("bed")) signs.push(item(symbolSwatch(bare({ bed: true }), theme, typical("end device")), "legend.symbol_sleepy"));
  container.append(h("h3", { text: t("legend.symbols_title") }), h("ul", { class: "swatches symbols" }, signs));

  // Pictures present in this network, in the order of their first device; the type line above a symbol names them.
  const pictures = [...new Set(parts.map((p) => p.picture))];
  container.append(h("h3", { text: t("legend.pictures_title") }),
    h("ul", { class: "swatches pictures" }, pictures.map((picture) =>
      item(symbolSwatch(bare({ picture }), theme, typical("router")), `device_kind.${picture}`))),
    h("p", { class: "small muted", text: t("legend.pictures_note") }));

  const example = bare({ picture: pictures.includes("light") ? "light" : pictures[0] || "unknown", router: true });
  const router = typical("router");
  container.append(h("h3", { text: t("legend.states_title") }), h("ul", { class: "swatches symbols" },
    item(symbolSwatch(example, theme, router, { offline: true }), "legend.state_offline"),
    item(symbolSwatch(example, theme, router, { selected: true }), "legend.state_selected"),
    item(symbolSwatch(example, theme, router, { pinned: true }), "legend.state_pinned")),
  h("p", { class: "small muted", text: t("legend.state_ring") }));
}
