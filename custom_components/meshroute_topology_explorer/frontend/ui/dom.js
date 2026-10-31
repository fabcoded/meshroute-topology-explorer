// SPDX-License-Identifier: MIT
// Small DOM helpers for the panel. Text only ever goes in as text nodes or textContent (names come from users and
// devices, AGENTS.md); there is no way to pass HTML. Icons are the project's own simple line drawings, built as SVG
// elements. Runs in the browser only.

const SVG_NS = "http://www.w3.org/2000/svg";

/** Element with properties and children. props: class, text, style (object), attrs (object), on (object of event
 *  handlers), plus aria-*, data-*, role, for and id as attributes and anything else as a property (type, hidden,
 *  disabled, value, checked, tabIndex, title). Children: nodes, strings (as text), arrays, null/false (skipped). */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === undefined || value === null) continue;
    if (key === "class") el.className = value;
    else if (key === "text") el.textContent = String(value);
    else if (key === "style") Object.assign(el.style, value);
    else if (key === "attrs") for (const [a, v] of Object.entries(value)) { if (v !== null && v !== undefined) el.setAttribute(a, String(v)); }
    else if (key === "on") for (const [type, fn] of Object.entries(value)) el.addEventListener(type, fn);
    else if (key.startsWith("aria-") || key.startsWith("data-") || key === "role" || key === "for" || key === "id") {
      el.setAttribute(key, String(value));
    } else el[key] = value;
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

/** Line icons, 24 × 24, stroked in currentColor. Own drawings. */
const ICONS = {
  menu: [["path", { d: "M4 6h16M4 12h16M4 18h16" }]],
  more: [["circle", { cx: 12, cy: 5, r: 1.7, fill: "currentColor", stroke: "none" }],
    ["circle", { cx: 12, cy: 12, r: 1.7, fill: "currentColor", stroke: "none" }],
    ["circle", { cx: 12, cy: 19, r: 1.7, fill: "currentColor", stroke: "none" }]],
  plus: [["path", { d: "M12 5v14M5 12h14" }]],
  minus: [["path", { d: "M5 12h14" }]],
  fit: [["path", { d: "M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" }]],
  close: [["path", { d: "M6 6l12 12M18 6L6 18" }]],
  up: [["path", { d: "M6 15l6-6 6 6" }]],
  down: [["path", { d: "M6 9l6 6 6-6" }]],
  info: [["circle", { cx: 12, cy: 12, r: 9 }], ["path", { d: "M12 11v6" }],
    ["circle", { cx: 12, cy: 7.5, r: 1.2, fill: "currentColor", stroke: "none" }]],
  link: [["path", { d: "M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" }]],
  right: [["path", { d: "M9 6l6 6-6 6" }]],
  // A list with markers: the legend.
  legend: [["path", { d: "M10 6h10M10 12h10M10 18h10" }], ["circle", { cx: 5, cy: 6, r: 1.6, fill: "currentColor", stroke: "none" }],
    ["circle", { cx: 5, cy: 12, r: 1.6, fill: "currentColor", stroke: "none" }], ["circle", { cx: 5, cy: 18, r: 1.6, fill: "currentColor", stroke: "none" }]],
  // A flag: findings.
  findings: [["path", { d: "M5 21V4M5 4h11l-2 4 2 4H5" }]],
  // Two devices pushed apart: density.
  density: [["circle", { cx: 5, cy: 12, r: 2.5 }], ["circle", { cx: 19, cy: 12, r: 2.5 }], ["path", { d: "M8 12h8M13 9l3 3-3 3M11 9l-3 3 3 3" }]],
  // A half-filled circle: fill.
  fill: [["circle", { cx: 12, cy: 12, r: 8 }], ["path", { d: "M12 4a8 8 0 0 1 0 16Z", fill: "currentColor", stroke: "none" }]],
};

export function icon(name, size = 20) {
  const el = svg("svg", { viewBox: "0 0 24 24", width: size, height: size, fill: "none", stroke: "currentColor",
    "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", focusable: "false" });
  for (const [tag, attrs] of ICONS[name] || []) el.append(svg(tag, attrs));
  return el;
}

/** SVG element with attributes (all set as attributes). */
export function svg(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

/** Button with an icon and an accessible name; the name is also the tooltip. */
export function iconButton(name, label, onClick, cls = "icon-button") {
  return h("button", { type: "button", class: cls, "aria-label": label, title: label, on: { click: onClick } }, icon(name));
}
