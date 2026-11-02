// SPDX-License-Identifier: MIT
// The Legend tab of the right panel (spec 8, 9.1): compact, in three
// sections. Communication paths: the classes the current stage draws (all in debug mode), the value pill and, while paths are
// coloured, the colour bar; the fill when one is chosen; Symbols: four rows, each a device of this network drawn by the
// map's own drawSymbol with its picture (router, end device, coordinator, wired only); States: offline, selected,
// pinned. It is the only legend: nothing appears twice, and the longer explanations stay in the specification. Colours
// come from the resolved map theme, the links part from the graph's own legend entries (link-legend.js), so legend
// and map always agree. Runs in the browser.
import { h, svg } from "./dom.js";
import { lineColorOn, CATEGORY_FILLS } from "../graph/palette.js";
import { drawSymbol, legendSigns, symbolLayers, symbolParts } from "../graph/symbols.js";
import { linkLegendList } from "./link-legend.js";

/** Symbols in the Legend tab are drawn at 40 px (spec 9.1). */
const SWATCH = 40;

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

/** The Legend tab. ctx: { t, theme (resolved), fill, roles (Set of roles in the network), devices (the network's
 *  devices: which symbols to show, with their own pictures), links (GraphView.legend()), debug }. */
export function renderLegend(container, { t, theme, fill, roles, devices = [], links }) {
  container.replaceChildren();
  const title = (key) => h("h3", { class: "legend-title", text: t(key) });
  // Communication paths: what the graph says it draws for the stage, the value pill and the colour bar (link-legend.js).
  container.append(title("legend.paths_title"), linkLegendList(links || [], t));

  if (fill !== "none") {
    container.append(title(`legend.fill_${fill}`), h("ul", { class: "legend-rows" },
      categoryEntries(fill, theme, t, roles).map((e) =>
        h("li", {}, chip({ fill: e.color, outline: theme.outline, slash: e.slash }), h("span", { text: e.label })))));
  }

  // Symbols carry a value of the current fill, never the grey that means "no value"; the "none" fill is the neutral grey.
  const typical = (role) => (fill === "role" ? theme.categories.role[role] || theme.categories.role.router
    : fill === "power" ? theme.categories.power.mains : theme.neutral);
  // One device of this network per sign (graph/symbols.js legendSigns, spec 9.1).
  const item = (swatch, key) => h("li", {}, swatch, h("span", { text: t(key) }));
  const signs = legendSigns(devices);
  const rows = signs.map((sign) => item(symbolSwatch(sign.parts, theme, typical(sign.role)), sign.key));
  if (rows.length) container.append(title("legend.symbols_title"), h("ul", { class: "legend-rows symbols" }, rows));

  // States, on the router's symbol (spec 9.1), else on any device's.
  const router = signs.find((sign) => sign.key === "legend.symbol_router");
  const example = (router && router.parts) || (devices[0] && symbolParts(devices[0]))
    || symbolParts({ role: "router", kind: "light" });
  const tint = typical("router");
  container.append(title("legend.states_title"), h("ul", { class: "legend-rows symbols" },
    item(symbolSwatch(example, theme, tint, { offline: true }), "legend.state_offline"),
    item(symbolSwatch(example, theme, tint, { selected: true }), "legend.state_selected"),
    item(symbolSwatch(example, theme, tint, { pinned: true }), "legend.state_pinned")));
}
