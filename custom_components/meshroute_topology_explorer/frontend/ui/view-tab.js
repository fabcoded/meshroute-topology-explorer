// SPDX-License-Identifier: MIT
// The View tab of the right panel (spec 9.1, 11; design by Fabian Schwamborn, 2026-11-01, board M2): everything that
// changes how the map looks, in this order: communication paths (one radio group of two cumulative stages plus a checkbox "heard only", each with
// a one-line hint, board M11), path display (grey, or coloured by reception with the user's own colours for bad,
// medium and good), what a click on a device does (open details), return paths without a table entry (source route:
// off, assume, and "read from zigpy" shown disabled until it exists), node distance (density) with an info button,
// symbol fill, labels on the map; then debug mode (not stored), "Read data again" with an info button (ZHA reads the
// tables by itself), "Release all pins", the scan in debug mode, and a note only when the settings are not kept in
// Home Assistant. Real checkboxes, radios and colour inputs inside labels, so state is announced; rows of 32 px with
// a fine pointer and 44 px with a coarse one.
// Runs in the browser.
import { h } from "./dom.js";
import { DENSITY_NAMES, PATH_STOPS } from "./settings.js";
import { PATH_STAGES } from "../graph/links.js";
import { FILLS, receptionStops } from "../graph/palette.js";
import { SOURCE_ROUTE_MODES } from "../model/source-routes.js";

/** Fill `container`. ctx: { t, settings (sanitized), openOnSelect (effective "Details on click"), dark (the map's
 *  theme is dark: which default colours the pickers show), debug, pinCount, scan ({ running } or null), client
 *  (SettingsClient: mode, reason, error), observations (ObservationsClient, debug mode only), idPrefix (stable, so focus
 *  is found again after a re-render), info ({ density, reload, heard, colors, assumed }: which info notes are shown),
 *  routes (false for a network without routes, Thread: stages and source route greyed with the reason), onChange(patch),
 *  onOpenDetails(on), onDebug(on), onReload(), onReleaseAll(), onScan(button), onScanStop(), onInfo(key, open) }. */
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

  const info = ctx.info || {};
  // An info button (a toggletip: works with touch and keyboard alike) and the note it shows.
  const infoNote = (key, label, text) => {
    const noteId = `${id}-${key}-note`;
    const open = Boolean(info[key]);
    return {
      button: h("button", { type: "button", class: "info-button", "aria-expanded": String(open),
        "aria-controls": noteId, "aria-label": label, title: text, id: `${id}-${key}-info`,
        on: { click: () => ctx.onInfo(key, !open) } },
      h("span", { "aria-hidden": "true", text: "i" })),
      note: h("p", { class: "muted small info-note", id: noteId, hidden: !open, text }),
    };
  };

  // Communication paths (spec 7.1; board M11): one stage of two, the second containing the first, and the heard-only checkbox, each with a hint.
  const heardHint = `${id}-paths-heard-hint`;
  // In the second stage every measured neighbour is a possible direct way and so a drawn lane: the option rarely adds a
  // partner there (decision by Fabian Schwamborn, 2026-11-01). The note shows in that stage only, where it applies.
  const heardInfo = settings.paths === "all" ? infoNote("heard", t("view.heard_info_label"), t("view.heard_info")) : null;
  const paths = group(t("view.paths"), PATH_STAGES.map((v) => {
    const hint = `${id}-paths-${v}-hint`;
    return [h("label", { class: "check-row" },
      h("input", { type: "radio", name: `${id}-paths`, value: v, checked: settings.paths === v,
        "aria-describedby": hint, on: { change: () => ctx.onChange({ paths: v }) } }),
      h("span", { text: t(`view.paths_${v}`) })),
    h("span", { class: "radio-hint", id: hint, text: t(`view.paths_${v}_hint`) })];
  }),
  // The option on top of either stage (decision by Fabian Schwamborn, 2026-11-01): a checkbox, same row size.
  h("span", { class: "with-info" }, h("label", { class: "check-row" },
    h("input", { type: "checkbox", id: `${id}-paths-heard`, checked: settings.heard === true, "aria-describedby": heardHint,
      on: { change: (e) => ctx.onChange({ heard: e.target.checked }) } }),
    h("span", { text: t("view.paths_heard") })), heardInfo && heardInfo.button),
  h("span", { class: "radio-hint", id: heardHint, text: t("view.paths_heard_hint") }),
  heardInfo && heardInfo.note,
  h("span", { class: "muted small group-note", text: t("view.paths_note") }));
  paths.classList.add("paths-group");
  // A network without routes (Thread, spec 4.6) has no stages: the controls stay in view, greyed, with the reason.
  const routes = ctx.routes !== false;
  const unavailable = (fieldset) => {
    if (routes) return fieldset;
    fieldset.disabled = true;
    fieldset.classList.add("off");
    fieldset.append(h("span", { class: "muted small group-note", text: t("view.not_for_network") }));
    return fieldset;
  };
  container.append(unavailable(paths));

  // Path display: grey or coloured by reception; with coloured, the user's own colours (null: the theme's own).
  const pc = settings.pathColors;
  const coloured = pc.mode === "coloured";
  const colorsInfo = infoNote("colors", t("view.colors_info_label"), t("view.colors_info"));
  const display = h("fieldset", { class: "view-group" },
    h("legend", { class: "with-info" }, h("span", { text: t("view.path_display") }), colorsInfo.button), colorsInfo.note,
    h("div", { class: "radio-line" },
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

  // On click on a device: "Details on click" (the map's slide switch is the same setting); what the map shows on click
  // follows the communication paths above.
  container.append(group(t("view.on_click"),
    check("open", t("view.open_details"), Boolean(ctx.openOnSelect), (on) => ctx.onOpenDetails(on))));

  // Return paths without a table entry (source route; decisions by Fabian Schwamborn, 2026-11-01): off, assume, or read
  // zigpy's route records (brief a4w), which keeps its "experimental" tag.
  const assumedInfo = infoNote("assumed", t("view.assumed_info_label"), t("view.assumed_info"));
  const choices = SOURCE_ROUTE_MODES.map((v) => radio("sourceRoute", v, t(`view.sr_${v}`), settings.sourceRoute === v,
    () => ctx.onChange({ sourceRoute: v })));
  const zigpy = choices[SOURCE_ROUTE_MODES.indexOf("zigpy")];
  if (zigpy) zigpy.append(h("span", { class: "tag", text: t("view.sr_experimental") }));
  // Thread has no routes: the group stays in view, greyed with the reason (unavailable above).
  container.append(unavailable(h("fieldset", { class: "view-group" },
    h("legend", { class: "with-info" }, h("span", { text: t("view.source_route") }), assumedInfo.button), assumedInfo.note,
    choices)));

  // Node distance (density), with a note behind an info button.
  const densityInfo = infoNote("density", t("view.density_info_label"), t("view.density_info"));
  container.append(h("fieldset", { class: "view-group" },
    h("legend", { class: "with-info" }, h("span", { text: t("view.density") }), densityInfo.button),
    densityInfo.note,
    h("div", { class: "radio-line" }, DENSITY_NAMES.map((v) => radio("density", v, t(`density.${v}`), settings.density === v,
      () => ctx.onChange({ density: v }))))));

  container.append(group(t("view.fill"), h("div", { class: "radio-line" },
    FILLS.map((v) => radio("fill", v, t(`fill.${v}`), settings.fill === v, () => ctx.onChange({ fill: v }))))));

  const lab = settings.labels;
  container.append(group(t("view.labels"),
    check("label-type", t("view.label_type"), lab.type, (on) => ctx.onChange({ labels: { ...lab, type: on } })),
    check("label-name", t("view.label_name"), lab.name, (on) => ctx.onChange({ labels: { ...lab, name: on } })),
    check("label-ha", t("view.label_ha"), lab.haName, (on) => ctx.onChange({ labels: { ...lab, haName: on } }))));

  // Below a line: debug mode (never stored, spec 9.1), reading again (with the note that ZHA reads the tables by
  // itself, board M1 review), releasing pins, the scan (debug mode only: it causes radio traffic).
  const reloadInfo = infoNote("reload", t("view.reload_info_label"), t("view.reload_info"));
  const tools = h("div", { class: "view-tools" },
    check("debug", t("view.debug"), Boolean(ctx.debug), (on) => ctx.onDebug(on)),
    h("div", { class: "actions" },
      h("span", { class: "with-info" },
        h("button", { type: "button", class: "button", id: `${id}-reload`, text: t("view.reload"),
          on: { click: () => ctx.onReload() } }),
        reloadInfo.button),
      h("button", { type: "button", class: "button", id: `${id}-release`, disabled: !ctx.pinCount,
        text: ctx.pinCount ? t("view.release_count", { count: ctx.pinCount }) : t("view.release"),
        on: { click: () => ctx.onReleaseAll() } })),
    reloadInfo.note);
  if (ctx.debug && routes) {
    const running = Boolean(ctx.scan && ctx.scan.running);
    const scan = h("button", { type: "button", class: "button", id: `${id}-scan`, disabled: running,
      text: t(running ? "view.scan_running" : "view.scan"), on: { click: (e) => ctx.onScan(e.currentTarget) } });
    tools.append(h("div", { class: "actions" }, scan, running ? h("button", { type: "button", class: "button",
      id: `${id}-scan-stop`, text: t("view.scan_stop"), on: { click: () => ctx.onScanStop() } }) : null));
  }
  // Where the settings live: said only when they are not kept in Home Assistant as usual (board M2 has no note).
  const kept = ctx.client.mode === "stored" && !ctx.client.error;
  tools.append(h("p", { class: `storage small ${ctx.client.mode === "memory" || ctx.client.error ? "warn" : ""}`.trim(),
    role: "status", hidden: kept, text: kept ? "" : storageText(ctx.client, t) }));
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

