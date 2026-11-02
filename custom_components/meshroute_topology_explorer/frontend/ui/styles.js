// SPDX-License-Identifier: MIT
// Styles of the panel's shadow root. Colours and fonts are Home Assistant's theme variables with fallbacks, so the
// panel follows light, dark and custom themes and stays readable outside Home Assistant (dev page). Interactive
// targets are at least 24 px (spec 9.3, WCAG 2.2 2.5.8); most are 40 px. Focus rings use the text colour, which
// keeps 3:1 where the theme's primary colour may not.
export const STYLES = `
:host {
  /* The viewport's height, not the container's: Home Assistant's custom-panel container has no height of its own,
     so 100% gave the map zero height there (dev page unaffected). dvh follows mobile browser bars. */
  display: block; height: 100vh; height: 100dvh; position: relative; box-sizing: border-box;
  --mte-bg: var(--primary-background-color, #fafafa);
  --mte-card: var(--card-background-color, var(--ha-card-background, #ffffff));
  --mte-fg: var(--primary-text-color, #212121);
  --mte-muted: var(--secondary-text-color, #5f5f5f);
  --mte-divider: var(--divider-color, rgba(0, 0, 0, 0.12));
  --mte-accent: var(--primary-color, #03a9f4);
  --mte-on-accent: var(--text-primary-color, #ffffff);
  --mte-ok: var(--success-color, #43a047);
  --mte-warn: var(--warning-color, #ffa600);
  --mte-error: var(--error-color, #db4437);
  --mte-shadow: 0 2px 8px rgba(0, 0, 0, 0.18);
  /* The segmented control's track and the soft boxes (spec 9.2), an outline for chips and links, and a
     warm text colour for hints ("manufacturer-specific", "experimental"), all mixed from the theme. */
  --mte-track: color-mix(in srgb, var(--mte-fg) 7%, var(--mte-card));
  --mte-outline: color-mix(in srgb, var(--mte-fg) 25%, transparent);
  --mte-warn-text: color-mix(in srgb, var(--mte-warn) 50%, var(--mte-fg));
  --mte-float-shadow: 0 1px 4px rgba(0, 0, 0, 0.14);
  --inset-left: 0px; --inset-right: 0px; --inset-bottom: 0px;
  color: var(--mte-fg); background: var(--mte-bg);
  font-family: var(--ha-font-family-body, var(--paper-font-body1_-_font-family, Roboto, "Noto Sans", sans-serif));
  font-size: 14px; line-height: 1.4;
  -webkit-font-smoothing: antialiased;
}
*, *::before, *::after { box-sizing: border-box; }
[hidden] { display: none !important; }
.sr-only { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden;
  clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
.app { display: flex; flex-direction: column; height: 100%; }

/* Controls shared by the panels */
.icon-button { display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 40px;
  flex: none; border: none; border-radius: 50%; background: transparent; color: inherit; cursor: pointer; padding: 0; }
.icon-button:hover, .map-button:hover, .tab:hover, .sheet-line:hover, .check-row:hover {
  background: color-mix(in srgb, currentColor 10%, transparent); }
.map-button:hover { background: color-mix(in srgb, var(--mte-fg) 6%, var(--mte-card)); }
button:focus-visible, a:focus-visible, select:focus-visible, input:focus-visible, [tabindex]:focus-visible {
  outline: 2px solid var(--mte-fg); outline-offset: 2px; }
.map-switch:focus-visible { outline: none; }
.map-switch:focus-visible .switch-pill { outline: 2px solid var(--mte-fg); outline-offset: 2px; }

/* Map and what floats on it */
.map { position: relative; flex: 1; min-height: 0; overflow: hidden; background: var(--mte-bg); }
.map > canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; outline: none; }
.map > canvas:focus-visible { box-shadow: inset 0 0 0 2px var(--mte-fg); }
.float { background: var(--mte-card); color: var(--mte-fg); border: 1px solid var(--mte-divider); border-radius: 10px;
  box-shadow: var(--mte-float-shadow); }
/* Controls on the map: "Devices" and the switch top left, "View" and
   "Legend" top right; places from geometry.js floatingLayout. */
.map-group { position: absolute; z-index: 5; top: 12px; display: flex; flex-direction: column; gap: 8px;
  pointer-events: none; }
.map-group > *, .map-row > * { pointer-events: auto; }
.map-left { left: calc(var(--inset-left) + 12px); align-items: flex-start; }
.map-right { right: calc(var(--inset-right) + 12px); align-items: flex-end; }
.map-row { display: flex; gap: 8px; pointer-events: none; }
.map-button { display: flex; align-items: center; gap: 10px; height: 48px; min-width: 48px; padding: 0 16px 0 12px;
  border: none; border-radius: 14px; background: var(--mte-card); color: var(--mte-fg); box-shadow: var(--mte-float-shadow);
  font: inherit; font-size: 16px; cursor: pointer; white-space: nowrap; }
.map-button svg { flex: none; }
.map-sidebar { justify-content: center; padding: 0; }
.map-devices { padding-right: 12px; }
.map-legend { height: 44px; border-radius: 12px; font-size: 15px; gap: 8px; }
.badge { min-width: 24px; height: 24px; padding: 0 7px; border-radius: 12px; display: inline-flex; align-items: center;
  justify-content: center; background: var(--mte-fg); color: var(--mte-card); font-size: 13px; font-weight: 700; }
[data-count="0"] .badge { background: transparent; color: var(--mte-muted); box-shadow: inset 0 0 0 1.5px var(--mte-muted); }
/* The slide switch: a 44 px target around a 34 px pill (the design's size). */
.map-switch { display: flex; align-items: center; min-height: 44px; padding: 0; border: none; background: transparent;
  color: var(--mte-fg); font: inherit; cursor: pointer; }
.switch-pill { display: flex; align-items: center; gap: 8px; height: 34px; padding: 0 12px 0 8px; border-radius: 17px;
  background: var(--mte-card); box-shadow: var(--mte-float-shadow); font-size: 13px; white-space: nowrap; }
.switch-track { position: relative; display: inline-block; width: 34px; height: 20px; border-radius: 10px; flex: none;
  box-shadow: inset 0 0 0 1.5px var(--mte-muted); }
.switch-knob { position: absolute; left: 3px; top: 3px; width: 14px; height: 14px; border-radius: 7px;
  background: var(--mte-muted); }
.map-switch[aria-checked="true"] .switch-track { background: var(--mte-fg); box-shadow: none; }
.map-switch[aria-checked="true"] .switch-knob { left: auto; right: 2px; top: 2px; width: 16px; height: 16px;
  border-radius: 8px; background: var(--mte-card); }
.top { position: absolute; top: var(--band-top, 64px); left: var(--band-left, 12px); right: var(--band-right, 12px); display: flex;
  flex-direction: column; align-items: flex-start; gap: 6px; pointer-events: none; }
.top > * { pointer-events: auto; max-width: 100%; }
.banner { padding: 6px 12px; font-size: 13px; display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
.banner strong { font-weight: 600; }
.banner.incomplete { border-left: 4px solid var(--mte-warn); }
.banner.lost { border-left: 4px solid var(--mte-error); }
.banner.loading { border-left: 4px solid var(--mte-accent); }
.zoom { position: absolute; z-index: 5; right: calc(var(--inset-right) + 12px); bottom: calc(var(--inset-bottom) + 12px);
  display: flex; flex-direction: column; overflow: hidden; border: none; border-radius: 14px; }
.zoom.spread { bottom: var(--spread-bottom, 170px); }
.zoom .icon-button { border-radius: 0; width: 48px; height: 48px; }
.zoom .icon-button + .icon-button { border-top: 1px solid var(--mte-divider); }
.message { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center;
  justify-content: center; gap: 12px; padding: 24px; text-align: center; }
.message p { max-width: 36em; margin: 0; font-size: 16px; }
.message.warn p::before, .message.error p::before { content: ""; display: block; width: 40px; height: 4px;
  margin: 0 auto 12px; border-radius: 2px; background: var(--mte-warn); }
.message.error p::before { background: var(--mte-error); }

/* Panels: left (Devices, Findings, Details) and right (View, Legend); bottom sheets on narrow screens */
.drawer { position: absolute; z-index: 10; display: flex; flex-direction: column; background: var(--mte-card);
  color: var(--mte-fg); box-shadow: var(--mte-shadow); }
.drawer[data-mode="side"] { top: 0; bottom: 0; width: var(--drawer-size, 360px); }
.drawer[data-mode="side"][data-side="right"] { right: 0; border-left: 1px solid var(--mte-divider); }
.drawer[data-mode="side"][data-side="left"] { left: 0; border-right: 1px solid var(--mte-divider); }
.drawer[data-mode="sheet"] { left: 0; right: 0; bottom: 0; height: var(--drawer-size, 56px);
  border-top: 1px solid var(--mte-divider); border-radius: 12px 12px 0 0; }
.drawer-head { display: flex; align-items: center; flex: none; min-height: 48px; padding: 0 4px;
  border-bottom: 1px solid var(--mte-divider); }
.drawer[data-collapsed="true"] .drawer-head { border-bottom: none; height: 100%; }
.tabs { display: flex; flex: 1; min-width: 0; overflow-x: auto; scrollbar-width: none; }
.tabs::-webkit-scrollbar { display: none; }
/* Where the tabs do not fit (a narrow side panel, long names) the row scrolls and fades out at the edge that
   hides more (data-more-* set by drawer.js). */
.tabs[data-more-end] { -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 36px), transparent);
  mask-image: linear-gradient(to right, #000 calc(100% - 36px), transparent); }
.tabs[data-more-start] { -webkit-mask-image: linear-gradient(to left, #000 calc(100% - 36px), transparent);
  mask-image: linear-gradient(to left, #000 calc(100% - 36px), transparent); }
.tabs[data-more-start][data-more-end] {
  -webkit-mask-image: linear-gradient(to right, transparent, #000 36px, #000 calc(100% - 36px), transparent);
  mask-image: linear-gradient(to right, transparent, #000 36px, #000 calc(100% - 36px), transparent); }
.tab { flex: 0 0 auto; height: 48px; padding: 0 12px; border: none; border-bottom: 3px solid transparent;
  background: transparent; color: var(--mte-muted); font: inherit; font-size: 15px; white-space: nowrap; cursor: pointer; }
.tab-count { font-weight: 700; }
.drawer-head .icon-button { width: 44px; height: 44px; }
.tab[aria-selected="true"] { color: var(--mte-fg); font-weight: 700; border-bottom-color: var(--mte-fg); }
.sheet-line { flex: 1; min-width: 0; display: flex; align-items: center; justify-content: space-between; gap: 8px;
  height: 48px; padding: 0 8px 0 16px; border: none; background: transparent; color: inherit; font: inherit;
  text-align: left; cursor: pointer; }
.summary-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.drawer-body { flex: 1; min-height: 0; overflow: auto; }
.tabpanel { padding: 16px 20px 24px; }
.tabpanel:focus-visible { outline-offset: -2px; }
.tabpanel > :first-child, .tabpanel > :first-child > :first-child { margin-top: 0; }

/* Content */
h2 { font-size: 18px; font-weight: 500; margin: 0; overflow-wrap: anywhere; }
h3 { font-size: 14px; font-weight: 600; margin: 18px 0 6px; }
h4 { font-size: 13px; font-weight: 600; margin: 12px 0 4px; }
p { margin: 4px 0; }
.muted { color: var(--mte-muted); }
.small { font-size: 12px; }
.mono { font-family: var(--ha-font-family-code, ui-monospace, monospace); font-size: 13px; }
.empty { color: var(--mte-muted); margin: 16px 0; }
/* Details (spec 9.2): name, one line, a segmented control and a
   stack of cards. Surfaces mix the theme's text colour into the card colour, so light and dark themes both work. */
.details-head { margin-bottom: 12px; }
.details-head p { margin-top: 2px; }
.device-name { font-size: 20px; font-weight: 700; line-height: 1.25; }
.warn-text { color: var(--mte-warn-text); }
.segmented { display: flex; gap: 4px; padding: 4px; margin: 0 0 12px; border-radius: 12px; background: var(--mte-track);
  container-type: inline-size; }
/* Segments share the leftover width equally but never cut their word (flex-basis auto). */
.segment { flex: 1 0 auto; height: 36px; padding: 0 8px; border: none; border-radius: 9px; background: none;
  color: var(--mte-muted); font: inherit; font-size: 14px; cursor: pointer; white-space: nowrap; }
/* The narrowest side panel (320 px) leaves the three segments about 260 px: a little less padding and type keeps
   "Kommunikation" whole, never an ellipsis. */
@container (max-width: 300px) { .segment { padding: 0 4px; font-size: 13px; } }
.segment:hover { color: var(--mte-fg); }
.segment[aria-selected="true"] { background: var(--mte-card); color: var(--mte-fg); font-weight: 700;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15), 0 0 0 1px var(--mte-divider); }
.sub-panel { display: flex; flex-direction: column; gap: 12px; }
.card { display: flex; flex-direction: column; gap: 6px; padding: 12px 14px; border: 1px solid var(--mte-divider);
  border-radius: 12px; background: var(--mte-card); }
.card .card-title, .card-title { margin: 0; font-size: 13px; font-weight: 700; color: var(--mte-muted); }
.card p { margin: 0; }
.card details > summary { margin-top: 0; }
.card-details > summary.card-title { min-height: 24px; }
.card-details { display: flex; flex-direction: column; gap: 6px; }
.card-details[open] > :not(summary) { margin-top: 6px; }
.path-line { line-height: 1.5; overflow-wrap: anywhere; }
.path-line.assumed { color: var(--mte-muted); }
/* Theoretical paths (spec 9.2): a row per device, name left, the ways there and back right; opened, its hops. */
.theory-row > summary { display: grid; grid-template-columns: 1em minmax(0, 1fr) auto auto; gap: 8px; margin-top: 0;
  min-height: 28px; font-weight: 400; }
.theory-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.theory-way { white-space: nowrap; font-size: 13px; min-width: 64px; text-align: right; }
.theory-way small { font-size: 12px; color: var(--mte-muted); }
.theory-line { font-size: 13px; padding-left: 1em; }
.theory-cost { display: block; text-align: right; margin-top: 2px; }
.how { color: var(--mte-muted); font-size: 12px; }
.rx small, .reading-rx small { font-size: 12px; color: var(--mte-muted); }
.rx b, .reading-rx b { font-weight: 700; color: var(--mte-fg); }
.unknown { color: var(--mte-muted); font-style: italic; }
.reading-rows { display: flex; flex-direction: column; }
.reading-row { display: flex; align-items: center; gap: 8px; min-height: 22px; }
.reading-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.reading-rx { width: 72px; flex: none; text-align: right; white-space: nowrap; }
.reading-rank { width: 118px; flex: none; text-align: right; white-space: nowrap; font-size: 13px; color: var(--mte-muted); }
.reading-row.weak .reading-rank { color: var(--mte-warn-text); font-weight: 600; }
.reading-name .link { text-decoration: none; }
.reading-name .link:hover { text-decoration: underline; }
.more > summary { font-weight: 400; font-size: 13px; color: var(--mte-muted); min-height: 28px; }
/* "… all" under the readings reads as a line of text (spec 9.2); its own ellipsis says there is more. */
.more.all-readings > summary::before { content: none; }
.more.all-readings[open] > summary { display: none; }
.more h4 { margin: 8px 0 2px; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chip { padding: 3px 9px; border-radius: 12px; border: 1px solid var(--mte-outline); font-size: 13px; }
.kv-list { display: flex; flex-direction: column; }
.kv { display: flex; gap: 10px; padding: 3px 0; }
.kv-key { width: 118px; flex: none; color: var(--mte-muted); }
.kv-value { min-width: 0; overflow-wrap: anywhere; }
.pills { display: flex; flex-wrap: wrap; gap: 8px; }
.pill { display: inline-flex; align-items: center; min-height: 36px; padding: 0 12px; border: 1px solid var(--mte-outline);
  border-radius: 10px; background: var(--mte-card); color: var(--mte-fg); font-size: 14px; text-decoration: none; }
.pill:hover { background: color-mix(in srgb, var(--mte-fg) 6%, var(--mte-card)); }
.entity-list li { min-height: 24px; }
.entity-list .link { text-decoration-color: var(--mte-outline); }
.cluster-table { font-size: 14px; }
.cluster-table th, .attr-table th { padding: 6px; font-size: 12px; font-weight: 700; color: var(--mte-muted);
  border-bottom: 2px solid var(--mte-divider); }
.cluster-table td { padding: 0 6px; border-bottom: 1px solid var(--mte-divider); vertical-align: middle; }
.cluster-table .ep-row th { padding: 10px 6px 6px; background: var(--mte-track); border-bottom: none; }
.cluster-row { cursor: pointer; }
.cluster-row:hover { background: color-mix(in srgb, var(--mte-fg) 5%, transparent); }
.row-button { display: block; width: 100%; min-height: 34px; padding: 7px 0; border: none; background: none;
  color: inherit; font: inherit; text-align: left; cursor: pointer; }
.row-button .tag { margin-left: 6px; }
.cluster-section { display: flex; flex-direction: column; gap: 6px; }
td.id, .id { font-size: 12px; color: var(--mte-muted); }
.tag { font-size: 11px; color: var(--mte-warn-text); }
.raw-json { max-height: 240px; overflow: auto; margin: 0; font-size: 11px; }
.actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 10px 0 4px; }
.button { display: inline-flex; align-items: center; gap: 6px; min-height: 36px; padding: 0 12px; border-radius: 18px;
  border: 1px solid var(--mte-divider); background: transparent; color: var(--mte-fg); font: inherit; font-size: 13px;
  text-decoration: none; cursor: pointer; }
.button:disabled { color: var(--mte-muted); cursor: default; }
.link { display: inline; min-height: 24px; padding: 2px 0; border: none; background: none; color: inherit; font: inherit;
  text-align: left; text-decoration: underline; text-decoration-color: var(--mte-muted); text-underline-offset: 2px;
  cursor: pointer; }
/* Entity ids in a code font; .link resets font, so the class .mono needs this rule after it. */
.link.mono { font-family: var(--ha-font-family-code, ui-monospace, Menlo, monospace); font-size: 13px; }
.facts { display: grid; grid-template-columns: max-content 1fr; gap: 4px 12px; margin: 12px 0 0; }
.facts dt { color: var(--mte-muted); }
.facts dd { margin: 0; overflow-wrap: anywhere; }
table { border-collapse: collapse; width: 100%; font-size: 13px; }
th, td { text-align: left; padding: 4px 8px 4px 0; border-bottom: 1px solid var(--mte-divider); vertical-align: top; }
th { color: var(--mte-muted); font-weight: 500; }
.num { text-align: right; padding-right: 12px; white-space: nowrap; }
.scroll { overflow-x: auto; }
.raw-table { font-family: var(--ha-font-family-code, ui-monospace, monospace); font-size: 11px; white-space: nowrap; }
details > summary { cursor: pointer; min-height: 32px; display: flex; align-items: center; gap: 4px; font-weight: 600;
  margin-top: 12px; list-style-position: inside; }
details > summary::-webkit-details-marker { margin-right: 4px; }
details > summary::before { content: "\\25B8"; display: inline-block; width: 1em; }
details[open] > summary::before { content: "\\25BE"; }
details > summary { list-style: none; }
.sub > summary { font-weight: 400; margin-top: 4px; }
ul.plain, .finding-list { list-style: none; margin: 0; padding: 0; }
.finding-list li { padding: 6px 0; border-bottom: 1px solid var(--mte-divider); }
.evidence { display: block; color: var(--mte-muted); font-size: 13px; }
.group h3 { margin-top: 14px; }
.finding { display: flex; flex-direction: column; align-items: flex-start; width: 100%; min-height: 44px;
  padding: 6px 8px; border: none; border-radius: 6px; background: transparent; color: inherit; font: inherit;
  text-align: left; cursor: pointer; }
.finding:hover, .device-row:hover { background: color-mix(in srgb, var(--mte-fg) 6%, transparent); }
.finding[aria-current="true"] { background: color-mix(in srgb, var(--mte-accent) 16%, transparent);
  box-shadow: inset 3px 0 0 var(--mte-accent); }
.finding-device { font-weight: 500; }
.filter-label { display: flex; flex-direction: column; gap: 6px; font-size: 13px; font-weight: 700;
  color: var(--mte-muted); }
.devices-hint { margin: 10px 0 6px; }
.filter { width: 100%; height: 40px; padding: 0 12px; font: inherit; font-size: 15px; font-weight: 400;
  color: var(--mte-fg); background: transparent; border: 1px solid var(--mte-divider); border-radius: 10px; }
.devices { list-style: none; margin: 4px 0 0; padding: 0; outline: none; }
.devices:focus-visible { outline: 2px solid var(--mte-fg); outline-offset: 2px; }
.device-row { display: flex; flex-direction: column; justify-content: center; min-height: 44px; padding: 10px 0;
  border-bottom: 1px solid var(--mte-divider); cursor: pointer; }
.device-row[aria-selected="true"] { background: color-mix(in srgb, var(--mte-accent) 16%, transparent);
  box-shadow: inset 3px 0 0 var(--mte-accent); }
.devices:focus-visible .device-row[data-active="true"], .devices:focus .device-row[data-active="true"] {
  outline: 2px solid var(--mte-fg); outline-offset: -2px; }
.row-label { font-weight: 700; overflow-wrap: anywhere; }
.row-meta { color: var(--mte-muted); font-size: 13px; }
/* Legend (spec 9.1): compact rows, 28 px for links, 40 px for symbols; section titles 13 px bold. */
.legend-title { margin: 10px 0 4px; font-size: 13px; font-weight: 700; color: var(--mte-muted); }
.legend-title:first-child { margin-top: 0; }
.legend-rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.legend-rows li { display: flex; align-items: center; gap: 12px; min-height: 28px; font-size: 14px; }
.legend-rows.symbols li { min-height: 40px; }
.legend-rows .lane-sample, .scale-sample, .glyph-sample { flex: none; width: 40px; }
.scale-sample { display: inline-block; height: 6px; border-radius: 3px; }
.glyph-sample { text-align: center; font-weight: 700; }
.small svg { vertical-align: middle; }
fieldset { border: none; margin: 0 0 14px; padding: 0; }
legend { font-weight: 600; padding: 0; margin-bottom: 4px; }
/* View tab (spec 9.1): groups of real checkboxes and radios, titles 13 px
   bold, rows of 32 px with a fine pointer and 44 px targets with a coarse one (WCAG 2.2 2.5.8 needs 24 px). */
.view-group { display: flex; flex-direction: column; margin: 0 0 18px; }
.view-group > legend { font-size: 13px; font-weight: 700; color: var(--mte-muted); margin-bottom: 4px; }
.with-info { display: flex; align-items: center; gap: 2px; }
.check-row { display: flex; align-items: center; gap: 10px; min-height: 32px; padding: 0 8px; margin: 0 -8px;
  border-radius: 8px; cursor: pointer; font-size: 15px; }
.check-row input { width: 16px; height: 16px; margin: 0; flex: none; accent-color: var(--mte-fg); }
@media (pointer: coarse) {
  .check-row { min-height: 44px; }
  .check-row input { width: 20px; height: 20px; }
}
/* A stage's hint under its radio, aligned with the label's text (input plus gap). */
.radio-hint { padding-left: 26px; margin: -4px 0 4px; font-size: 12px; color: var(--mte-muted); }
@media (pointer: coarse) { .radio-hint { padding-left: 30px; } }
/* "Include return routes": a checkbox of one view, indented under that view's radio and hint. */
.check-row.sub-option { margin-left: 18px; }
.radio-hint.sub-option { padding-left: 44px; }
@media (pointer: coarse) { .check-row.sub-option { margin-left: 22px; } .radio-hint.sub-option { padding-left: 52px; } }
.sub-option.off { opacity: 0.45; }
.check-row.sub-option.off { cursor: default; }
.group-note { margin-top: 2px; }
/* A network type's one-line note in place of a group it does not have (one without path views). */
.view-note { margin: 0 0 18px; }
.info-note { margin: 2px 0 6px; }
.findings-jump { align-self: flex-start; min-height: 32px; }
.spread-stepper { display: flex; align-items: center; gap: 8px; margin-top: 4px; }
.spread-value { min-width: 3.5ch; text-align: center; font-variant-numeric: tabular-nums; }
.step-button { min-width: 32px; min-height: 32px; border: 1px solid var(--mte-divider); border-radius: 8px;
  background: var(--mte-card); color: var(--mte-fg); font: inherit; cursor: pointer; }
.step-button:disabled { color: var(--mte-muted); cursor: default; }
@media (pointer: coarse) { .step-button { min-width: 44px; min-height: 44px; } }
.radio-line { display: flex; flex-wrap: wrap; column-gap: 20px; }
.radio-line .check-row { margin: 0; }
.color-row { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 14px; padding-left: 24px; margin-top: 2px; }
.color-pick { display: flex; flex-direction: column; align-items: center; gap: 4px; min-height: 44px; font-size: 13px;
  color: var(--mte-muted); cursor: pointer; }
.color-pick input { width: 44px; height: 32px; padding: 2px; border: 1px solid var(--mte-divider); border-radius: 8px;
  background: var(--mte-card); cursor: pointer; }
.color-note { flex: 1 1 8em; }
.color-row.off { opacity: 0.45; }
.color-row.off .color-pick, .color-row.off .color-pick input { cursor: default; }
.check-row.disabled { cursor: default; color: var(--mte-muted); flex-wrap: wrap; column-gap: 8px; row-gap: 0; }
.check-row.disabled:hover { background: none; }
.check-row .tag { font-size: 12px; }
.view-group > .link { align-self: flex-start; margin: 6px 0 0 24px; min-height: 32px; }
/* The info button: a 44 px target around the design's 22 px circle. */
.info-button { display: inline-flex; align-items: center; justify-content: center; width: 44px; height: 32px;
  margin: -6px 0; padding: 0; border: none; background: transparent; color: var(--mte-muted); cursor: pointer; }
.info-button span { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px;
  border-radius: 11px; border: 1.5px solid currentColor; font: italic 700 13px Georgia, serif; line-height: 1; }
.info-button[aria-expanded="true"] span { background: var(--mte-fg); border-color: var(--mte-fg); color: var(--mte-card); }
.view-tools { border-top: 1px solid var(--mte-divider); padding-top: 10px; }
.view-tools .actions { margin: 6px 0; }
.view-tools .button { min-height: 44px; border-radius: 10px; padding: 0 14px; font-size: 14px;
  border-color: color-mix(in srgb, var(--mte-fg) 25%, transparent); }
/* The pill the map draws in a lane around a value: thin outline, rounded ends, upright number. */
.rx-sample { display: inline-flex; align-items: center; justify-content: center; box-sizing: border-box; min-width: 36px;
  height: 16px; padding: 0 6px; flex: none; border: 1px solid var(--mte-fg); border-radius: 8px; font-size: 11.5px;
  line-height: 14px; white-space: nowrap; }
/* Confirmation dialog (scan): native <dialog> in the top layer, themed like the panels. */
dialog.confirm { max-width: min(30em, calc(100vw - 32px)); padding: 20px 24px 16px; border: none; border-radius: 12px;
  background: var(--mte-card); color: var(--mte-fg); box-shadow: 0 8px 32px rgba(0, 0, 0, 0.35); }
dialog.confirm::backdrop { background: rgba(0, 0, 0, 0.45); }
dialog.confirm h2 { margin: 0 0 10px; }
dialog.confirm p { margin: 0 0 10px; }
.dialog-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
/* Cluster details (spec 9.2): a modal box, 680 px wide where there is room. */
dialog.cluster-dialog { width: min(680px, calc(100vw - 24px)); max-width: none; max-height: calc(100vh - 24px); padding: 0;
  border: none; border-radius: 16px; background: var(--mte-card); color: var(--mte-fg);
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.25); overflow: auto; font-size: 14px; }
dialog.cluster-dialog::backdrop { background: rgba(0, 0, 0, 0.35); }
.dialog-body { display: flex; flex-direction: column; gap: 14px; padding: 22px 24px; }
.dialog-head { display: flex; align-items: flex-start; gap: 12px; }
.dialog-titles { flex: 1; min-width: 0; }
.dialog-titles h2 { font-size: 20px; font-weight: 700; }
.dialog-titles h2 .id { font-size: 15px; font-weight: 400; }
.dialog-titles p { margin: 2px 0 0; }
.dialog-close { margin: -6px -8px 0 0; }
.about { margin: 0; line-height: 21px; }
.attr-block { display: flex; flex-direction: column; gap: 6px; }
.attr-table { font-size: 14px; }
.attr-table th { padding: 6px 8px; }
.attr-table td { padding: 7px 8px; border-bottom: 1px solid var(--mte-divider); vertical-align: top; }
.read-row { display: flex; flex-direction: column; gap: 4px; }
.read-line { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; }
.read-row .button { min-height: 32px; border-radius: 8px; padding: 0 12px; font-size: 13px; }
.read-status { margin: 0; }
.read-foot { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; }
.read-foot .button.dark { min-height: 36px; border-radius: 10px; padding: 0 14px; font-size: 14px; background: var(--mte-fg);
  color: var(--mte-card); white-space: nowrap; }
.attr-meta { display: none; }
@media (max-width: 560px) {
  .dialog-body { padding: 18px 16px; gap: 12px; }
  .attr-table .col_type, .attr-table .col_side { display: none; }
  .attr-meta { display: block; }
}
.button.primary { background: var(--mte-accent); color: var(--mte-on-accent); border-color: transparent; font-weight: 500; }
.status-stop { min-height: 24px; color: inherit; }
.storage { padding: 8px 10px; border-radius: 6px; background: color-mix(in srgb, var(--mte-fg) 5%, transparent); }
.storage.warn { box-shadow: inset 3px 0 0 var(--mte-warn); }

/* Status pill (spec 9.1): bottom centre of the map, between the panels' insets, with room left and right for the zoom
   group; the menu opens upwards. Dot and second line carry the state: ok, warn or error. */
.map { container-type: inline-size; }
.status-pill { position: absolute; z-index: 6; bottom: calc(var(--inset-bottom) + 12px);
  left: calc(var(--inset-left) + (100% - var(--inset-left) - var(--inset-right)) / 2); transform: translateX(-50%);
  max-width: calc(100% - var(--inset-left) - var(--inset-right) - 144px); }
.status-pill-button { display: flex; align-items: center; gap: 10px; width: 100%; height: 48px; padding: 0 16px 0 9px;
  border: none; border-radius: 14px; background: var(--mte-card); color: var(--mte-fg); box-shadow: var(--mte-float-shadow);
  font: inherit; text-align: left; cursor: pointer; white-space: nowrap; }
.status-pill-button:hover { box-shadow: 0 0 0 2px var(--mte-outline), var(--mte-float-shadow); }
.pill-arrow { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 30px; height: 30px;
  border-radius: 50%; background: color-mix(in srgb, var(--mte-fg) 8%, var(--mte-card)); }
.status-pill-button:hover .pill-arrow { background: color-mix(in srgb, var(--mte-fg) 18%, var(--mte-card)); }
.pill-text { display: flex; flex-direction: column; min-width: 0; line-height: 17px; }
.pill-name { font-size: 15px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; }
.pill-short { display: none; }
.pill-line { font-size: 12px; color: var(--mte-muted); overflow: hidden; text-overflow: ellipsis; }
.pill-dot { flex: none; width: 11px; height: 11px; border-radius: 50%; margin-left: 4px; background: var(--mte-ok); }
.level-warn .pill-dot { background: var(--mte-warn); }
.level-warn .pill-line { color: var(--mte-warn-text); }
.level-error .pill-dot { background: var(--mte-error); }
.level-error .pill-line { color: color-mix(in srgb, var(--mte-error) 70%, var(--mte-fg)); }
/* Phone width of the map: the second line goes, the name is the network's short one; the dot keeps the state. */
@container (max-width: 600px) {
  .pill-line, .pill-full { display: none; }
  .pill-short { display: inline; }
  .status-pill-button { height: 44px; padding-right: 14px; }
}
.pill-menu { position: absolute; left: 50%; bottom: calc(100% + 8px); transform: translateX(-50%); display: flex;
  flex-direction: column; width: min(300px, calc(100vw - 32px)); padding: 6px 0; color: var(--mte-fg);
  background: var(--mte-card); border-radius: 12px; box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25); outline: none; }
.menu-title { padding: 6px 14px 2px; font-size: 12px; color: var(--mte-muted); }
.menu-row { display: flex; align-items: center; gap: 10px; min-height: 40px; padding: 6px 14px; font: inherit;
  color: inherit; text-align: left; text-decoration: none; background: transparent; border: 0; cursor: pointer; }
button.menu-row { flex-direction: column; align-items: flex-start; gap: 2px; justify-content: center; }
.menu-row[aria-checked="true"] { font-weight: 600; }
.menu-row[aria-disabled="true"] { opacity: 0.55; cursor: default; }
.menu-row:hover:not([aria-disabled="true"]), .menu-row:focus-visible { background: var(--secondary-background-color, #eee); }
.menu-sep { border-top: 1px solid var(--mte-divider); margin: 4px 0; }
.menu-state { display: flex; flex-direction: column; gap: 4px; padding: 6px 14px; font-size: 13px; color: var(--mte-muted); }
.menu-line { display: flex; flex-wrap: wrap; align-items: center; gap: 0 8px; }
.view-settings { display: flex; flex-direction: column; gap: 2px; padding-top: 4px; border-top: 1px solid var(--mte-divider); }
.view-settings a { display: inline-flex; align-items: center; gap: 8px; min-height: 40px; color: inherit; }
`;
