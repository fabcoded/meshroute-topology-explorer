// SPDX-License-Identifier: MIT
// The Zigbee groups of the View tab (spec 9.1, 11; board M2, M11), as data the shared View tab renders
// (ui/view-tab.js renderView). Communication paths: three views, each its own basis, with "Include return routes"
// under the routing table (greyed in the other views, which already hold both directions) and, after it, the
// checkbox "additional heard neighbours", which also works in that view only (decision by Fabian Schwamborn,
// 2026-11-02); path display, grey or coloured by reception (the shared key pathColors); return paths without a table
// entry (source route: off, assume, read from zigpy with its "experimental" tag), after "On click".
// Pure. npm test
import { PATH_STAGES } from "./lanes.js";
import { SOURCE_ROUTE_MODES } from "./source-routes.js";

/** OptionGroup[] for the View tab from the network's settings (sanitized). Text values are i18n keys. */
export function zigbeeOptions(network, settings) {
  const tableOn = settings.paths === "table";
  const returns = { kind: "checkbox", key: "returnRoutes", id: "paths-returns", label: "view.paths_returns",
    hint: "view.paths_returns_hint", sub: true, disabled: !tableOn };
  const heard = { kind: "checkbox", key: "heard", id: "paths-heard", label: "view.paths_heard",
    hint: "view.paths_heard_hint", sub: true, disabled: !tableOn };
  return [
    { id: "paths", legend: "view.paths", className: "paths-group", note: "view.paths_note", controls: [
      { kind: "radio", key: "paths", layout: "rows", options: PATH_STAGES.map((v) => ({ value: v,
        label: `view.paths_${v}`, hint: `view.paths_${v}_hint`, children: v === "table" ? [returns, heard] : [] })) },
    ] },
    { id: "display", legend: "view.path_display", controls: [{ kind: "pathColors" }],
      info: { key: "colors", label: "view.colors_info_label", text: "view.colors_info" } },
    { id: "sourceRoute", legend: "view.source_route", after: "click", controls: [
      { kind: "radio", key: "sourceRoute", layout: "plain", options: SOURCE_ROUTE_MODES.map((v) => ({ value: v,
        label: `view.sr_${v}`, tag: v === "zigpy" ? "view.sr_experimental" : null })) },
    ], info: { key: "assumed", label: "view.assumed_info_label", text: "view.assumed_info" } },
  ];
}
