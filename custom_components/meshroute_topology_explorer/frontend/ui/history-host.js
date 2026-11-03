// SPDX-License-Identifier: MIT
// What the panel needs of the path history (spec 9.5): the loader for the shown network, the window, the entry badges'
// tooltips (hop counts of the live network) and the 48 h series of Details' "Heard by · hears" rows. The panel creates
// one host and hands it getters, so a new network or a new translation needs no re-wiring. Runs in the browser.
import { createLoader } from "./history-loader.js";
import { openHistoryWindow } from "./history-window.js";
import { pairHops } from "../engines/index.js";
import { h } from "./dom.js";
import { settingsLink } from "./status-pill.js";
import { INTEGRATION_PATH } from "./ha-links.js";
import { sparkModel, sparkline } from "./history-sparkline.js";

export class HistoryHost {
  /** deps: { root(), callWS(msg), network() (localized, with `live`), theme(), t(), view() (GraphView or null), now?, zone?, timers? } */
  constructor(deps) {
    this.deps = deps;
    this.loader = createLoader({ callWS: (m) => deps.callWS(m), network: () => deps.network(), now: deps.now });
    this.window = null;
  }

  /** The network or the recording changed: read again. */
  clear() { this.loader.clear(); }

  /** Tooltip of the badge at `other` while `selected` is selected: the title and, for Zigbee, the hop counts now. */
  badgeText(selected, other) {
    const t = this.deps.t();
    const net = this.deps.network();
    const name = (net.devices.find((d) => d.id === selected) || {}).label || selected;
    const lines = [t("history.badge_title", { name })];
    const hops = pairHops(net, selected, other);
    if (hops) {
      const word = (n) => t(n === 1 ? "history.hops_one" : "history.hops_many", { n });
      lines.push(t("history.badge_hops", { there: word(hops.there), back: word(hops.back) }));
    }
    return lines.join("\n");
  }

  /** Open the window for a pair, on `tab` (default: the last used) or on the lane x-y's last 48 h. One window at a time. */
  open(a, b, { tab, lane, opener } = {}) {
    if (this.window) this.window.close();
    const d = this.deps;
    const view = d.view();
    this.window = openHistoryWindow({ root: d.root(), t: d.t(), theme: d.theme, loader: this.loader, network: d.network, a, b, tab, lane,
      positionOf: (id) => (view ? view.positionOf(id) : null), opener, now: d.now, zone: d.zone, timers: d.timers,
      onClose: () => { this.window = null; } });
    return this.window;
  }

  /** The last 48 h of the lanes between `selected` and each of `others` (ids), as { state, series: Map id -> { heardBy:
   *  [[t, lqi|null]], hears: [...] } }: heardBy = the other device's reading of the selected one. */
  async last48(selected, others) {
    const result = await this.loader.get("48h");
    if (!result.history) return { state: result.state, info: result.info, series: new Map() };
    const series = new Map();
    for (const other of others) {
      const lane = result.history.lane(selected, other, { last: true }, null);
      series.set(other, { heardBy: lane.bHearsA.map(([t, v]) => [t, v]), hears: lane.aHearsB.map(([t, v]) => [t, v]) });
    }
    return { state: result.state, info: result.info, series };
  }

  /** Fill the sparkline cells of Details rows. slots: [{ cell (element), other (device id), kind: "heardBy" | "hears" }];
   *  note: where the one line goes that replaces the sparklines when nothing is recorded. A click on a cell opens the
   *  window on the lane's last 48 h. Failures leave the rows as they are (the sparkline is an addition). */
  async fillRows(selected, slots, note) {
    const t = this.deps.t();
    let got;
    try { got = await this.last48(selected, [...new Set(slots.map((s) => s.other))]); } catch { return; }
    if (got.state === "off" || got.state === "unsupported") {
      note.replaceChildren(got.state === "off" ? h("span", {}, `${t("history.off")} `, settingsLink(INTEGRATION_PATH, t("history.settings"), { class: "inline-link" }))
        : t("history.unsupported", { error: got.info.lastError }));
      return;
    }
    for (const { cell, other, kind } of slots) {
      const model = sparkModel((got.series.get(other) || {})[kind] || []);
      if (!model) continue;
      const name = (this.deps.network().devices.find((d) => d.id === other) || {}).label || other;
      const button = h("button", { type: "button", class: "spark-button", title: t("history.row_open", { name }), "aria-label": t("history.row_open", { name }),
        on: { click: (e) => this.open(selected, other, { lane: { x: selected, y: other }, opener: e.currentTarget }) } },
      sparkline(model), h("small", { class: "muted", text: t("history.row_range", { min: model.min, max: model.max }) }));
      cell.replaceChildren(button);
    }
  }
}
