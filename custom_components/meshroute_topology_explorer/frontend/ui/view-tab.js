// SPDX-License-Identifier: MIT
// The View tab of the right panel (spec 9.1, 11; design by Fabian Schwamborn, 2026-11-01, board M2): everything that
// changes how the map looks. The network engine's option groups come first (engines/*/options.js: for Zigbee the
// communication paths and the path display), then what a click on a device does (open details), the engine's groups
// placed after it (Zigbee: return paths without a table entry), node distance (density) with an info button, symbol
// fill, labels on the map; then debug mode (not stored), "Read data again" with an info button (the source's own
// note, from its adapter), "Release all pins", the scan in debug mode where the source has one, and a note only when the settings
// are not kept in Home Assistant. A group the network type does not have is not shown (owner decision 2026-11-01:
// hidden, not greyed); an engine may say why in one line. Real checkboxes, radios and colour inputs inside labels,
// so state is announced; rows of 32 px with a fine pointer and 44 px with a coarse one.
// Runs in the browser.
import { h } from "./dom.js";
import { DENSITY_NAMES, PATH_STOPS } from "./settings.js";
import { FILLS, receptionStops } from "../graph/palette.js";

/** Fill `container`. ctx: { t, settings (sanitized), groups (the engine's OptionGroups: engine.options(network,
 *  settings)), canScan (the source has a user-started scan: capabilities.scan), openOnSelect (effective "Details on
 *  click"), dark (the map's theme is dark: which default colours the pickers show), debug, pinCount, scan ({ running }
 *  or null), client (SettingsClient: mode, reason, error), observations (ObservationsClient, debug mode only),
 *  idPrefix (stable, so focus is found again after a re-render), info ({ [key]: open }: which info notes are shown),
 *  reloadInfo (text key of the source's note on reading again, adapters/*.js; without one no info button),
 *  onChange(patch), onOpenDetails(on), onDebug(on), onReload(), onReleaseAll(), onScan(button), onScanStop(),
 *  onInfo(key, open) }.
 *  OptionGroup = { id, legend (text key; without one the group is a single line, its note), className, info ({ key,
 *  label, text }: an info button in the legend), note (a line at the end), after ("click": placed after "On click"),
 *  controls }. Control = { kind: "radio", key, layout ("rows": one per line with a hint; "plain"), options: [{ value,
 *  label, hint, tag, children (controls under that option) }] } | { kind: "checkbox", key, id, label, hint, sub (an
 *  option under a radio: indented, greyed while disabled), disabled, info } | { kind: "pathColors" } (grey or
 *  coloured by reception with the user's colours: the shared key pathColors). Text values are i18n keys. */
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
  const infoOf = (spec) => (spec ? infoNote(spec.key, t(spec.label), t(spec.text)) : null);

  /** A checkbox of a group, with its hint below. A sub-option sits under its radio, indented and greyed while
   *  disabled; any other checkbox sits in a row that can carry an info button, its note below the hint. */
  const checkbox = (c) => {
    const hint = `${id}-${c.id}-hint`;
    const input = h("input", { type: "checkbox", id: `${id}-${c.id}`, checked: settings[c.key] === true,
      disabled: c.disabled, "aria-describedby": hint,
      on: { change: (e) => ctx.onChange({ [c.key]: e.target.checked }) } });
    if (c.sub) {
      const off = c.disabled ? " off" : "";
      return [h("label", { class: `check-row sub-option${off}` }, input, h("span", { text: t(c.label) })),
        h("span", { class: `radio-hint sub-option${off}`, id: hint, text: t(c.hint) })];
    }
    const note = infoOf(c.info);
    return [h("span", { class: "with-info" },
      h("label", { class: "check-row" }, input, h("span", { text: t(c.label) })), note && note.button),
    h("span", { class: "radio-hint", id: hint, text: t(c.hint) }),
    note && note.note];
  };

  /** A radio group of a group: one row per option with its hint and the controls under it ("rows"), or the bare
   *  rows ("plain"), an option's tag inside its row. */
  const radios = (c) => c.options.map((o) => {
    if (c.layout !== "rows") {
      const row = radio(c.key, o.value, t(o.label), settings[c.key] === o.value,
        () => ctx.onChange({ [c.key]: o.value }));
      if (o.tag) row.append(h("span", { class: "tag", text: t(o.tag) }));
      return row;
    }
    const hint = `${id}-${c.key}-${o.value}-hint`;
    return [h("label", { class: "check-row" },
      h("input", { type: "radio", name: `${id}-${c.key}`, value: o.value, checked: settings[c.key] === o.value,
        "aria-describedby": hint, on: { change: () => ctx.onChange({ [c.key]: o.value }) } }),
      h("span", { text: t(o.label) })),
    h("span", { class: "radio-hint", id: hint, text: t(o.hint) }),
    ...(o.children || []).map(control)];
  });

  // Path display: grey or coloured by reception; with coloured, the user's own colours (null: the theme's own).
  const pathColors = () => {
    const pc = settings.pathColors;
    const coloured = pc.mode === "coloured";
    const out = [h("div", { class: "radio-line" },
      radio("pathMode", "grey", t("view.grey"), !coloured, () => ctx.onChange({ pathColors: { ...pc, mode: "grey" } })),
      radio("pathMode", "coloured", t("view.coloured"), coloured, () => ctx.onChange({ pathColors: { ...pc, mode: "coloured" } })))];
    // The pickers stay in view under "coloured by reception" (board M2), dimmed and inert while paths are grey.
    const defaults = receptionStops(Boolean(ctx.dark));
    const pickers = PATH_STOPS.map((key, i) => h("label", { class: "color-pick" },
      // "change" only: the native picker would close if the tab were rebuilt while it is open.
      h("input", { type: "color", id: `${id}-color-${key}`, value: pc[key] || defaults[i], "aria-label": t(`view.color_${key}_label`),
        disabled: !coloured, on: { change: (e) => ctx.onChange({ pathColors: { ...pc, [key]: e.target.value } }) } }),
      h("span", { text: t(`view.${key}`) })));
    const custom = PATH_STOPS.some((key) => pc[key]);
    out.push(h("div", { class: `color-row${coloured ? "" : " off"}` }, pickers,
      h("span", { class: "muted small color-note", text: t("view.colors_note") })));
    if (coloured && custom) {
      out.push(h("button", { type: "button", class: "link small", id: `${id}-colors-reset`, text: t("view.colors_reset"),
        on: { click: () => ctx.onChange({ pathColors: { mode: "coloured", bad: null, medium: null, good: null } }) } }));
    }
    return out;
  };

  function control(c) {
    if (c.kind === "radio") return radios(c);
    if (c.kind === "checkbox") return checkbox(c);
    if (c.kind === "pathColors") return pathColors();
    throw new Error(`unknown control kind ${c.kind}`);
  }

  /** One of the engine's groups as a fieldset; a group without a legend is a single line, its note. */
  const engineGroup = (g) => {
    if (!g.legend) return h("p", { class: "muted small view-note", text: t(g.note) });
    const note = infoOf(g.info);
    const legend = note ? h("legend", { class: "with-info" }, h("span", { text: t(g.legend) }), note.button)
      : h("legend", { text: t(g.legend) });
    return h("fieldset", { class: g.className ? `view-group ${g.className}` : "view-group" }, legend, note && note.note,
      g.controls.map(control), g.note ? h("span", { class: "muted small group-note", text: t(g.note) }) : null);
  };
  const groups = ctx.groups || [];
  for (const g of groups.filter((x) => !x.after)) container.append(engineGroup(g));

  // On click on a device: "Details on click" (the map's slide switch is the same setting); what the map shows on click
  // follows the communication paths above.
  container.append(group(t("view.on_click"),
    check("open", t("view.open_details"), Boolean(ctx.openOnSelect), (on) => ctx.onOpenDetails(on))));
  for (const g of groups.filter((x) => x.after === "click")) container.append(engineGroup(g));

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

  // Below a line: debug mode (never stored, spec 9.1), reading again (with the source's note, board M1 review: what
  // ZHA reads differs from what the Matter server returns, so the shared tab has no text of its own), releasing pins,
  // the scan (debug mode only: it causes radio traffic).
  const reloadInfo = ctx.reloadInfo ? infoNote("reload", t("view.reload_info_label"), t(ctx.reloadInfo)) : null;
  const tools = h("div", { class: "view-tools" },
    check("debug", t("view.debug"), Boolean(ctx.debug), (on) => ctx.onDebug(on)),
    h("div", { class: "actions" },
      h("span", { class: "with-info" },
        h("button", { type: "button", class: "button", id: `${id}-reload`, text: t("view.reload"),
          on: { click: () => ctx.onReload() } }),
        reloadInfo && reloadInfo.button),
      h("button", { type: "button", class: "button", id: `${id}-release`, disabled: !ctx.pinCount,
        text: ctx.pinCount ? t("view.release_count", { count: ctx.pinCount }) : t("view.release"),
        on: { click: () => ctx.onReleaseAll() } })),
    reloadInfo && reloadInfo.note);
  if (ctx.debug && ctx.canScan) {
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
