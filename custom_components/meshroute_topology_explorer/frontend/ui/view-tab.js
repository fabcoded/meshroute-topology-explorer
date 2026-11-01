// SPDX-License-Identifier: MIT
// The View tab of the right panel (spec 9.1, 11; design by Fabian Schwamborn, 2026-11-01): everything that changes
// how the map looks, in this order: communication paths (the three link classes), path display (grey, or coloured by
// reception with the user's own colours for bad, medium and good), what a click on a device does (open details, which
// paths it shows), return paths without a table entry (source route: off, assume, and "read from zigpy" shown disabled
// until it exists), node distance (density) with an info button, symbol fill, labels on the map; then debug mode (not
// stored), "Read data again", "Release all pins", the scan in debug mode, and where the settings are kept. Real
// checkboxes, radios and colour inputs inside labels, so state is announced and every row is a 44 px target.
// Runs in the browser.
import { h } from "./dom.js";
import { DENSITY_NAMES, PATH_STOPS } from "./settings.js";
import { LINK_CLASSES } from "./links-rows.js";
import { FILLS, receptionStops } from "../graph/palette.js";
import { NODE_VIEWS } from "../model/node-paths.js";
import { SOURCE_ROUTE_MODES } from "../model/source-routes.js";

/** Fill `container`. ctx: { t, settings (sanitized), openOnSelect (effective "Details on click"), dark (the map's
 *  theme is dark: which default colours the pickers show), debug, pinCount, scan ({ running } or null), client
 *  (SettingsClient: mode, reason, error), observations (ObservationsClient, debug mode only), idPrefix (stable, so focus
 *  is found again after a re-render), infoOpen (the density note is shown), onChange(patch), onOpenDetails(on),
 *  onDebug(on), onReload(), onReleaseAll(), onScan(button), onScanStop(), onInfo(open) }. */
export function renderView(container, ctx) {
  const { t, settings } = ctx;
  const id = ctx.idPrefix || "mte-view";
  container.replaceChildren();
  const check = (key, label, checked, onChange) => h("label", { class: "check-row" },
    h("input", { type: "checkbox", id: `${id}-${key}`, checked, on: { change: (e) => onChange(e.target.checked) } }),
    h("span", { text: label }));
  const radio = (name, value, label, checked, onChange) => h("label", { class: "check-row" },
    h("input", { type: "radio", name: `${id}-${name}`, value, checked, on: { change: () => onChange(value) } }),
    h("span", { text: label }));
  const group = (title, ...children) => h("fieldset", { class: "view-group" }, h("legend", { text: title }), ...children);

  // Communication paths: the link classes of the overview (spec 7.1).
  const links = settings.links;
  container.append(group(t("view.paths"), LINK_CLASSES.map((c) => check(`link-${c}`, t(`view.link_${c}`), Boolean(links[c]),
    (on) => ctx.onChange({ links: { ...settings.links, [c]: on } })))));

  // Path display: grey or coloured by reception; with coloured, the user's own colours (null: the theme's own).
  const pc = settings.pathColors;
  const coloured = pc.mode === "coloured";
  const display = group(t("view.path_display"), h("div", { class: "radio-line" },
    radio("pathMode", "grey", t("view.grey"), !coloured, () => ctx.onChange({ pathColors: { ...pc, mode: "grey" } })),
    radio("pathMode", "coloured", t("view.coloured"), coloured, () => ctx.onChange({ pathColors: { ...pc, mode: "coloured" } }))));
  // The pickers stay in view under "coloured by reception" (board M2), dimmed and inert while paths are grey.
  const defaults = receptionStops(Boolean(ctx.dark));
  const pickers = PATH_STOPS.map((key, i) => h("label", { class: "color-pick" },
    // "change" only: the native picker would close if the tab were rebuilt while it is open.
    h("input", { type: "color", id: `${id}-color-${key}`, value: pc[key] || defaults[i], "aria-label": t(`view.color_${key}_label`),
      disabled: !coloured, on: { change: (e) => ctx.onChange({ pathColors: { ...pc, [key]: e.target.value } }) } }),
    h("span", { text: t(`view.${key}`) })));
  const custom = PATH_STOPS.some((key) => pc[key]);
  display.append(h("div", { class: `color-row${coloured ? "" : " off"}` }, pickers,
    h("span", { class: "muted small color-note", text: t("view.colors_note") })));
  if (coloured && custom) {
    display.append(h("button", { type: "button", class: "link small", id: `${id}-colors-reset`, text: t("view.colors_reset"),
      on: { click: () => ctx.onChange({ pathColors: { mode: "coloured", bad: null, medium: null, good: null } }) } }));
  }
  container.append(display);

  // On click on a device: "Details on click" (the map's slide switch is the same setting) and the node view.
  container.append(group(t("view.on_click"),
    check("open", t("view.open_details"), Boolean(ctx.openOnSelect), (on) => ctx.onOpenDetails(on)),
    NODE_VIEWS.map((v) => radio("nodeView", v, t(`view.nodeview_${v}`), settings.nodeView === v,
      () => ctx.onChange({ nodeView: v })))));

  // Return paths without a table entry (source route; decision by Fabian Schwamborn, 2026-11-01): off or assume; reading
  // the route records from zigpy is announced but not built, so its radio is disabled and says "coming later".
  const zigpy = h("label", { class: "check-row disabled" },
    h("input", { type: "radio", name: `${id}-sourceRoute`, value: "zigpy", disabled: true, "aria-describedby": `${id}-sr-later` }),
    h("span", { text: t("view.sr_zigpy") }), h("span", { class: "tag", text: t("view.sr_experimental") }),
    h("span", { class: "muted small", id: `${id}-sr-later`, text: t("view.sr_later") }));
  container.append(group(t("view.source_route"),
    SOURCE_ROUTE_MODES.map((v) => radio("sourceRoute", v, t(`view.sr_${v}`), settings.sourceRoute === v,
      () => ctx.onChange({ sourceRoute: v }))), zigpy));

  // Node distance (density), with a note behind an info button (a toggletip: works with touch and keyboard alike).
  const noteId = `${id}-density-note`;
  const info = h("button", { type: "button", class: "info-button", "aria-expanded": String(Boolean(ctx.infoOpen)),
    "aria-controls": noteId, "aria-label": t("view.density_info_label"), title: t("view.density_info"), id: `${id}-density-info`,
    on: { click: () => ctx.onInfo(!ctx.infoOpen) } }, h("span", { "aria-hidden": "true", text: "i" }));
  const density = h("fieldset", { class: "view-group" },
    h("legend", { class: "with-info" }, h("span", { text: t("view.density") }), info),
    h("p", { class: "muted small", id: noteId, hidden: !ctx.infoOpen, text: t("view.density_info") }),
    h("div", { class: "radio-line" }, DENSITY_NAMES.map((v) => radio("density", v, t(`density.${v}`), settings.density === v,
      () => ctx.onChange({ density: v })))));
  container.append(density);

  container.append(group(t("view.fill"), h("div", { class: "radio-line" },
    FILLS.map((v) => radio("fill", v, t(`fill.${v}`), settings.fill === v, () => ctx.onChange({ fill: v }))))));

  const lab = settings.labels;
  container.append(group(t("view.labels"),
    check("label-type", t("view.label_type"), lab.type, (on) => ctx.onChange({ labels: { ...lab, type: on } })),
    check("label-name", t("view.label_name"), lab.name, (on) => ctx.onChange({ labels: { ...lab, name: on } })),
    check("label-ha", t("view.label_ha"), lab.haName, (on) => ctx.onChange({ labels: { ...lab, haName: on } }))));

  // Below a line: debug mode (never stored, spec 9.1), reading again, releasing pins, the scan (debug mode only: it
  // causes radio traffic), where the settings live.
  const tools = h("div", { class: "view-tools" },
    check("debug", t("view.debug"), Boolean(ctx.debug), (on) => ctx.onDebug(on)),
    h("div", { class: "actions" },
      h("button", { type: "button", class: "button", id: `${id}-reload`, text: t("view.reload"), on: { click: () => ctx.onReload() } }),
      h("button", { type: "button", class: "button", id: `${id}-release`, disabled: !ctx.pinCount,
        text: ctx.pinCount ? t("view.release_count", { count: ctx.pinCount }) : t("view.release"),
        on: { click: () => ctx.onReleaseAll() } })));
  if (ctx.debug) {
    const running = Boolean(ctx.scan && ctx.scan.running);
    const scan = h("button", { type: "button", class: "button", id: `${id}-scan`, disabled: running,
      text: t(running ? "view.scan_running" : "view.scan"), on: { click: (e) => ctx.onScan(e.currentTarget) } });
    tools.append(h("div", { class: "actions" }, scan, running ? h("button", { type: "button", class: "button",
      id: `${id}-scan-stop`, text: t("view.scan_stop"), on: { click: () => ctx.onScanStop() } }) : null));
  }
  tools.append(h("p", { class: `storage small ${ctx.client.mode === "memory" || ctx.client.error ? "warn" : ""}`.trim(),
    role: "status", text: storageText(ctx.client, t) }));
  const obs = ctx.observations;
  if (obs) {
    const count = Object.keys(obs.routers).length;
    const text = obs.mode === "memory" ? t("observations.memory", { reason: obs.reason || "?" }) : t("observations.stored", { count });
    tools.append(h("p", { class: "muted small", text: obs.dropped ? `${text} ${t("observations.dropped", { count: obs.dropped })}` : text }));
  }
  container.append(tools);
}

/** Where the settings live, in words (the fallback must be said, brief A4a). */
export function storageText(client, t) {
  if (client.error && client.error.kind === "too-large") return t("storage.too_large", { kib: Math.ceil(client.error.bytes / 1024) });
  if (client.mode === "loading") return t("storage.loading");
  if (client.mode === "memory") {
    return client.reason === "unreadable" ? t("storage.unreadable", { message: client.error ? client.error.message : "?" })
      : t(`storage.${client.reason || "unsupported"}`);
  }
  if (client.error) return t("storage.error", { message: client.error.message });
  return t("storage.stored");
}

