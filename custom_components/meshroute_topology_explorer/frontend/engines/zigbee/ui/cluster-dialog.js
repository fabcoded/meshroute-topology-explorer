// SPDX-License-Identifier: MIT
// The details of one cluster of one device (spec 9.2; design by Fabian Schwamborn, 2026-11-01, board M10): a modal
// dialog (WAI-ARIA dialog pattern: native <dialog> with showModal, Tab kept inside, Esc and a close button, focus back
// to the row that opened it) with the cluster's name and id, device, endpoint, direction and profile; one sentence on
// what the cluster does and what In or Out means; the attributes the public ZCL specification lists for it with a
// current value where Home Assistant already knows it as an entity state (entity-values.js); and a button that reads
// the listed attributes once from the device (attribute-read.js), the only radio traffic besides the scan. The map
// stays read-only: writing, reporting and binding are left to ZHA's own device page, which the dialog links.
// Runs in the browser.
import { h, iconButton } from "../../../ui/dom.js";
import { formatNwk } from "../../../model/parse.js";
import { clusterAbout, clusterAttributes, clusterName, isManufacturerSpecific, profileName, readableAttributes }
  from "../zcl.js";
import { knownValue, valueText } from "./entity-values.js";
import { readAttributes } from "./attribute-read.js";
import { inApp } from "../../../ui/ha-links.js";

let uid = 0;

const FOCUSABLE = "button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex='-1'])";

/** Open the dialog. ctx: { root (element to attach to, inside the shadow root), t, device (model Device), endpoint,
 *  profile, cluster, direction ("in" | "out"), states() (hass.states now), callWS, opener (focused afterwards),
 *  onClose(), timers, timeoutMs, devicePage(device, tab) (the source's own page of the device, its adapter's; none:
 *  no "Manage" link) }. Returns { el, refresh() (entity states changed), close(), read() (as the button) }. */
export function openClusterDialog(ctx) {
  const { t, device, cluster, direction } = ctx;
  const id = `mte-cluster-${++uid}`;
  const lang = t.lang;
  const known = clusterAttributes(cluster);
  const readable = readableAttributes(cluster, direction);
  const results = new Map(); // attribute id -> read result
  let reading = false;
  let closed = false;
  let status = "";

  const vendorSpecific = isManufacturerSpecific(cluster);
  const title = vendorSpecific ? (device.vendor || t("cluster.vendor_unknown")) : clusterName(cluster, lang) || t("cluster.unknown");
  const side = t(direction === "out" ? "cluster.out_client" : "cluster.in_server");
  const profile = profileName(ctx.profile);
  const subtitle = [device.label, t("cluster.endpoint", { n: ctx.endpoint }), side, profile].filter(Boolean).join(" · ");
  const about = vendorSpecific ? t("cluster.about_vendor") : clusterAbout(cluster, lang) || t("cluster.about_unknown");
  const sentence = `${about} ${t(direction === "out" ? "cluster.out_means" : "cluster.in_means")}`;

  const close = () => finish();
  const closeButton = iconButton("close", t("drawer.close"), close, "icon-button dialog-close");
  const rows = h("tbody");
  const readButton = h("button", { type: "button", class: "button read-button", text: t("read.button"),
    on: { click: () => read() } });
  // "Manage" opens the source's own page of the device on its clusters tab (ZHA's, ctx.devicePage from its adapter).
  const page = ctx.devicePage ? ctx.devicePage(device, "clusters") : null;
  const manage = page ? h("a", { class: "button dark", href: page.path,
    on: { click: (e) => { inApp(page.path)(e); if (e.defaultPrevented) finish(); } } }, t("read.manage")) : null;
  const live = h("p", { class: "small read-status", role: "status", "aria-live": "polite" });

  let table;
  if (known === null || vendorSpecific) {
    table = h("p", { class: "muted", text: t(vendorSpecific ? "cluster.attributes_vendor" : "cluster.attributes_unknown") });
  } else if (!known.length) {
    table = h("p", { class: "muted", text: t("cluster.attributes_none") });
  } else {
    table = h("div", { class: "scroll" }, h("table", { class: "attr-table" },
      h("thead", {}, h("tr", {}, ["col_id", "col_name", "col_type", "col_side", "col_value"].map((k) =>
        h("th", { scope: "col", class: k, text: t(`attr.${k}`) })))), rows));
  }

  // The box's padding sits on an inner element, so a click on the dialog element itself is a click on the backdrop.
  const dialog = h("dialog", { class: "cluster-dialog", "aria-labelledby": `${id}-title`, "aria-describedby": `${id}-about` },
    h("div", { class: "dialog-body" }, h("div", { class: "dialog-head" },
      h("div", { class: "dialog-titles" },
        h("h2", { id: `${id}-title` }, title, " ", h("span", { class: "mono id", text: formatNwk(cluster) })),
        h("p", { class: "muted", text: subtitle })),
      closeButton),
    h("p", { id: `${id}-about`, class: "about", text: sentence }),
    h("div", { class: "attr-block" }, h("h3", { class: "card-title", text: t("attr.title") }),
      // The read row sits directly above the table so that nobody has to scroll to see that values can be read.
      h("div", { class: "read-row" },
        h("div", { class: "read-line" }, readButton, live),
        h("span", { class: "small muted", text: t("read.note") }),
        device.sleepy === true ? h("span", { class: "small warn-text", text: t("read.sleepy") }) : null),
      table),
    h("div", { class: "read-foot" }, manage, h("span", { class: "small muted", text: t("read.read_only") }))));

  function renderRows() {
    if (!known || !known.length || vendorSpecific) return;
    const states = typeof ctx.states === "function" ? ctx.states() : null;
    rows.replaceChildren(...known.map((a) => {
      const gloss = a.gloss && a.gloss[lang] ? ` · ${a.gloss[lang]}` : "";
      const own = a.side === (direction === "out" ? "client" : "server");
      const value = [];
      const r = results.get(a.id);
      if (r) value.push(h("div", {}, ...resultNodes(r, t)));
      const k = own ? knownValue(cluster, a.id, direction, device.entities, states) : null;
      if (k) value.push(h("div", {}, h("b", { text: valueText(k, t) }), " ", h("span", { class: "small muted", text: t("attr.per", { entity: k.entityId }) })));
      if (!value.length) value.push(h("span", { class: "muted", text: "—", title: own ? t("attr.dash") : t("attr.other_side") }));
      const sideText = t(a.side === "client" ? "attr.client" : "attr.server");
      // On a narrow screen type and side move under the name (styles.js), so the value keeps its column.
      return h("tr", {},
        h("td", { class: "mono id", text: formatNwk(a.id) }),
        h("td", {}, a.name + gloss, h("span", { class: "attr-meta small muted", text: `${a.type} \u00B7 ${sideText}` })),
        h("td", { class: "muted col_type", text: a.type }),
        h("td", { class: "muted col_side", text: sideText }),
        h("td", {}, value));
    }));
  }

  function update() {
    readButton.disabled = reading || !readable.length || vendorSpecific;
    readButton.textContent = reading ? t("read.reading") : t("read.button");
    live.textContent = status;
    live.hidden = !status;
  }

  /** Read the attributes of the device's side once (the user pressed the button). */
  async function read() {
    if (reading || closed || !readable.length || vendorSpecific) return;
    reading = true;
    results.clear();
    let done = 0;
    status = t("read.progress", { n: 0, total: readable.length });
    update();
    renderRows();
    const list = await readAttributes({ callWS: ctx.callWS, ieee: device.id, endpoint: ctx.endpoint, cluster, direction,
      attributes: readable.map((a) => a.id), timers: ctx.timers, timeoutMs: ctx.timeoutMs, cancelled: () => closed,
      onResult: (r) => {
        results.set(r.id, r);
        done += 1;
        if (r.state !== "skipped") status = t("read.progress", { n: done, total: readable.length });
        renderRows();
        update();
      } });
    if (closed) return;
    reading = false;
    const count = (s) => list.filter((r) => r.state === s).length;
    const failed = list.find((r) => r.state === "timeout" || r.state === "error");
    status = failed ? t(failed.state === "timeout" ? "read.stopped_timeout" : "read.stopped_error", { message: failed.message || "?" })
      : t("read.done", { ok: count("ok"), none: count("none") });
    update();
  }

  function finish() {
    if (closed) return;
    closed = true;
    if (dialog.open) dialog.close();
    dialog.remove();
    if (ctx.opener && ctx.opener.isConnected && ctx.opener.focus) ctx.opener.focus();
    if (ctx.onClose) ctx.onClose();
  }

  dialog.addEventListener("cancel", (e) => { e.preventDefault(); finish(); });
  dialog.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.preventDefault(); finish(); return; }
    if (e.key !== "Tab") return;
    const order = [...dialog.querySelectorAll(FOCUSABLE)].filter((el) => !el.hidden && el.offsetParent !== null);
    if (!order.length) return;
    const at = order.indexOf(dialog.getRootNode().activeElement);
    e.preventDefault();
    order[(at + (e.shiftKey ? -1 : 1) + order.length) % order.length].focus();
  });
  // A click on the backdrop (outside the dialog box) closes it, like Esc.
  dialog.addEventListener("click", (e) => { if (e.target === dialog) finish(); });

  renderRows();
  update();
  ctx.root.append(dialog);
  if (dialog.showModal) dialog.showModal(); else dialog.setAttribute("open", "");
  closeButton.focus();
  return { el: dialog, refresh: () => { if (!closed) renderRows(); }, close: finish, read };
}

/** The value of a read result as nodes: the device's own text, or why there is none. */
function resultNodes(r, t) {
  if (r.state === "ok") return [h("b", { class: "mono", text: r.value }), " ", h("span", { class: "small muted", text: t("attr.from_device") })];
  return [h("span", { class: r.state === "none" || r.state === "skipped" ? "muted" : "warn-text", text: t(`attr.read_${r.state}`),
    title: r.message && r.state === "error" ? r.message : null })];
}
