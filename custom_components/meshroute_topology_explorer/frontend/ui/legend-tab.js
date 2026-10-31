// SPDX-License-Identifier: MIT
// The legend (spec 8: it explains the current view and fill): the full Legend tab and the small one that sits on the
// map by default (spec 9.1). Colours come from the resolved map theme, so legend and map always agree. Swatches are
// small SVG drawings of the map's own shapes. Runs in the browser.
import { h, svg } from "./dom.js";
import { ratingColor, CATEGORY_FILLS } from "../graph/palette.js";

/** CSS gradient of the rating scale as the map draws it (the theme's contrast-safe part of cividis). */
export function ratingGradient(theme) {
  const stops = [];
  for (let i = 0; i <= 8; i++) stops.push(ratingColor(i / 8, theme));
  return `linear-gradient(to right, ${stops.join(", ")})`;
}

/** [{ key, label, color }] of the category fill; the grey "none" entry last. */
function categoryEntries(fill, theme, t, roles) {
  const out = [];
  if (fill === "role") {
    for (const role of Object.keys(CATEGORY_FILLS.role)) {
      if (roles.has(role)) out.push({ label: t(`role.${role}`), color: theme.categories.role[role] });
    }
    if (roles.has("unknown")) out.push({ label: t("role.none"), color: theme.node });
  } else {
    for (const key of Object.keys(CATEGORY_FILLS.power)) out.push({ label: t(`power.${key}`), color: theme.categories.power[key] });
    out.push({ label: t("power.none"), color: theme.node });
  }
  return out;
}

/** Marker drawing: shape by role, outline by state (spec 8), as in renderer.js. */
function marker({ shape = "circle", fill, outline, dashed = false, hollow = false, pin = false, ring = null, size = 12 }) {
  const box = 24;
  const c = box / 2;
  const r = size / 2;
  const el = svg("svg", { viewBox: `0 0 ${box} ${box}`, width: box, height: box, "aria-hidden": "true" });
  const attrs = { fill: hollow ? "none" : fill, stroke: outline, "stroke-width": 1.5 };
  if (dashed) attrs["stroke-dasharray"] = "3 2";
  if (shape === "square") el.append(svg("rect", { x: c - r, y: c - r, width: 2 * r, height: 2 * r, ...attrs }));
  else if (shape === "diamond") el.append(svg("path", { d: `M${c} ${c - r * 1.25}L${c + r * 1.25} ${c}L${c} ${c + r * 1.25}L${c - r * 1.25} ${c}Z`, ...attrs }));
  else el.append(svg("circle", { cx: c, cy: c, r, ...attrs }));
  if (pin) {
    el.append(svg("path", { d: `M${c + r * 0.7} ${c - r * 0.7}l4 -4`, stroke: outline, "stroke-width": 1.5 }));
    el.append(svg("circle", { cx: c + r * 0.7 + 5, cy: c - r * 0.7 - 5, r: 2.5, fill: outline }));
  }
  if (ring) el.append(svg("circle", { cx: c, cy: c, r: r + 3.5, fill: "none", stroke: ring, "stroke-width": 2 }));
  return el;
}

function lineSample(color, dashed, width = 2) {
  const el = svg("svg", { viewBox: "0 0 32 12", width: 32, height: 12, "aria-hidden": "true" });
  el.append(svg("path", { d: "M2 6H30", stroke: color, "stroke-width": width, ...(dashed ? { "stroke-dasharray": "4 4" } : {}) }));
  return el;
}

/** The Legend tab. ctx: { t, theme (resolved), fill, roles (Set of roles in the network), debug }. */
export function renderLegend(container, { t, theme, fill, roles, debug }) {
  container.replaceChildren();
  container.append(h("h3", { text: t(`legend.fill_${fill}`) }));
  if (fill === "reception") {
    container.append(scale(theme, t),
      h("p", { class: "small", text: t("legend.reception") }),
      h("p", { class: "small", text: t("legend.rank") }));
  } else {
    container.append(h("ul", { class: "swatches" }, categoryEntries(fill, theme, t, roles).map((e) =>
      h("li", {}, marker({ fill: e.color, outline: theme.outline }), h("span", { text: e.label })))));
  }

  container.append(h("h3", { text: t("legend.lines_title") }),
    h("p", { class: "small" }, lineSample(ratingColor(0.8, theme), false, 2.2), " ", lineSample(theme.muted, true, 1), " ", t("legend.lines")),
    h("p", { class: "small", text: t("legend.lanes") }));
  if (fill !== "reception") container.append(h("p", { class: "small", text: t("legend.rank") }));
  if (debug) container.append(h("p", { class: "small", text: t("legend.debug") }));

  const node = theme.node;
  const shapes = [["coordinator", "square", 14, "legend.shape_coordinator"], ["router", "circle", 12, "legend.shape_router"],
    ["end device", "circle", 8, "legend.shape_end"], ["border router", "diamond", 12, "legend.shape_border"]];
  container.append(h("h3", { text: t("legend.shapes_title") }), h("ul", { class: "swatches" },
    shapes.filter(([role]) => roles.has(role)).map(([, shape, size, key]) =>
      h("li", {}, marker({ shape, size, fill: node, outline: theme.outline }), h("span", { text: t(key) })))));
  container.append(h("h3", { text: t("legend.outlines_title") }), h("ul", { class: "swatches" },
    h("li", {}, marker({ fill: node, outline: theme.outline, dashed: true }), h("span", { text: t("legend.outline_unknown") })),
    h("li", {}, marker({ fill: node, outline: theme.outline, hollow: true }), h("span", { text: t("legend.outline_offline") })),
    h("li", {}, marker({ fill: node, outline: theme.outline, pin: true, size: 10 }), h("span", { text: t("legend.outline_pinned") })),
    h("li", {}, marker({ fill: node, outline: theme.outline, ring: theme.accent, size: 10 }), h("span", { text: t("legend.outline_selected") }))));
}

function scale(theme, t) {
  return h("div", { class: "scale" },
    h("div", { class: "scale-bar", style: { background: ratingGradient(theme) } }),
    h("div", { class: "scale-ends" }, h("span", { text: t("legend.weaker") }), h("span", { text: t("legend.stronger") })),
    h("p", { class: "small muted" }, marker({ fill: theme.node, outline: theme.outline, size: 10 }), t("legend.unrated")));
}

/** The small legend on the map: the current fill in one glance; pressing it opens the Legend tab. */
export function renderMiniLegend(button, { t, theme, fill, roles }) {
  button.replaceChildren();
  button.setAttribute("aria-label", `${t(`legend.fill_${fill}`)}. ${t("legend.open")}`);
  button.title = t("legend.open");
  if (fill === "reception") {
    button.append(h("span", { class: "mini-title", text: t(`legend.fill_${fill}`) }),
      h("span", { class: "scale-bar mini", style: { background: ratingGradient(theme) } }),
      h("span", { class: "scale-ends" }, h("span", { text: t("legend.weaker") }), h("span", { text: t("legend.stronger") })));
  } else {
    button.append(h("span", { class: "mini-title", text: t(`legend.fill_${fill}`) }),
      h("span", { class: "mini-swatches" }, categoryEntries(fill, theme, t, roles).map((e) =>
        h("span", { class: "mini-swatch" }, marker({ fill: e.color, outline: theme.outline, size: 10 }),
          h("span", { text: e.label.replace(/ \(.*\)$/, "") })))));
  }
}
