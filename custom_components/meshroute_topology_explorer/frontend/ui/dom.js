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
  plus: [["path", { d: "M12 5v14M5 12h14" }]],
  minus: [["path", { d: "M5 12h14" }]],
  // Two diagonal arrows pointing outwards (spec 6, own drawing).
  fit: [["path", { d: "M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7" }]],
  // Two dots with arrows pointing apart / together (spec 9.1, own drawings): node distance, not zoom.
  "spread-more": [["path", { d: "M8 12H3M5.5 9.5L3 12l2.5 2.5M16 12h5M18.5 9.5L21 12l-2.5 2.5" }], ["circle", { cx: 12, cy: 12, r: 1.6 }]],
  "spread-less": [["path", { d: "M3 12h5M5.5 9.5L8 12l-2.5 2.5M21 12h-5M18.5 9.5L16 12l2.5 2.5" }], ["circle", { cx: 12, cy: 12, r: 1.6 }]],
  close: [["path", { d: "M6 6l12 12M18 6L6 18" }]],
  up: [["path", { d: "M6 15l6-6 6 6" }]],
  down: [["path", { d: "M6 9l6 6 6-6" }]],
  // A gear: the settings (spec 9.1, own drawing).
  settings: [["circle", { cx: 12, cy: 12, r: 3.5 }], ["path", { d: "M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" }]],
  link: [["path", { d: "M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" }]],
  // A list with round markers: the devices.
  list: [["path", { d: "M9 6h11M9 12h11M9 18h11" }], ["circle", { cx: 4.5, cy: 6, r: 1.2 }], ["circle", { cx: 4.5, cy: 12, r: 1.2 }],
    ["circle", { cx: 4.5, cy: 18, r: 1.2 }]],
  // Two sliders: the view's options (same design).
  sliders: [["path", { d: "M4 7h10M18 7h2M4 17h4M12 17h8" }], ["circle", { cx: 16, cy: 7, r: 2 }], ["circle", { cx: 10, cy: 17, r: 2 }]],
  // A list with short keys in front: the legend (same design).
  legend: [["path", { d: "M10 6h10M10 12h10M10 18h10M3 6h3M3 12h3M3 18h3" }]],
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
