// SPDX-License-Identifier: MIT
// The Settings tab (spec 11): density, fill, node view, "open details on select", releasing pins, and where the
// settings are kept. Debug mode is not here: it lives in the menu and is never stored (spec 9.1). Runs in the browser.
import { h } from "./dom.js";
import { DENSITY_NAMES } from "./settings.js";
import { FILLS } from "../graph/palette.js";
import { NODE_VIEWS } from "../model/node-paths.js";

/** Fill `container`. ctx: { t, settings (sanitized object), wide, pinCount, client (SettingsClient: mode, reason,
 *  error), observations (ObservationsClient, only in debug mode), idPrefix (stable, so focus can be found again after
 *  a re-render), onChange(patch), onReleaseAll() }. */
export function renderSettings(container, ctx) {
  const { t, settings } = ctx;
  const id = ctx.idPrefix || "mte-settings";
  container.replaceChildren();
  const radios = (name, legendText, values, current, label, note) => h("fieldset", { class: "radios" },
    h("legend", { text: legendText }),
    values.map((v) => h("label", { class: "radio" },
      h("input", { type: "radio", name: `${id}-${name}`, value: v, checked: v === current,
        on: { change: () => ctx.onChange({ [name]: v }) } }), h("span", { text: label(v) }))),
    note ? h("p", { class: "muted small", text: note }) : null);

  container.append(radios("density", t("settings.density"), DENSITY_NAMES, settings.density, (v) => t(`density.${v}`),
    t("settings.density_note")));
  container.append(radios("fill", t("settings.fill"), FILLS, settings.fill, (v) => t(`fill.${v}`)));
  // On narrow panels the options group has no Node view row: this is its home there.
  container.append(radios("nodeView", t("settings.nodeview"), NODE_VIEWS, settings.nodeView, (v) => t(`nodeview.${v}`),
    t("settings.nodeview_note")));

  const open = settings.openDetailsOnSelect;
  const select = h("select", { id: `${id}-open`, on: { change: (e) => {
    const v = e.target.value;
    ctx.onChange({ openDetailsOnSelect: v === "auto" ? null : v === "on" });
  } } },
  h("option", { value: "auto", selected: open === null, text: t(ctx.wide ? "open.auto_on" : "open.auto_off") }),
  h("option", { value: "on", selected: open === true, text: t("open.on") }),
  h("option", { value: "off", selected: open === false, text: t("open.off") }));
  select.value = open === null ? "auto" : open ? "on" : "off";
  container.append(h("div", { class: "field" }, h("label", { for: `${id}-open`, text: t("settings.open_details") }), select));

  container.append(h("div", { class: "field" },
    h("span", { text: t("settings.pins", { count: ctx.pinCount }) }),
    h("button", { type: "button", class: "button", disabled: !ctx.pinCount, text: t("settings.release"),
      on: { click: () => ctx.onReleaseAll() } })));

  container.append(h("p", { class: "muted small", text: t("settings.debug_note") }));
  container.append(h("p", { class: `storage ${ctx.client.mode === "memory" || ctx.client.error ? "warn" : ""}`.trim(),
    role: "status", text: storageText(ctx.client, t) }));
  // Debug mode: where the observations of spec 6 live, and whether old entries had to go to stay under the limit.
  const obs = ctx.observations;
  if (obs) {
    const count = Object.keys(obs.routers).length;
    const text = obs.mode === "memory" ? t("observations.memory", { reason: obs.reason || "?" }) : t("observations.stored", { count });
    container.append(h("p", { class: "muted small", text: obs.dropped ? `${text} ${t("observations.dropped", { count: obs.dropped })}` : text }));
  }
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
