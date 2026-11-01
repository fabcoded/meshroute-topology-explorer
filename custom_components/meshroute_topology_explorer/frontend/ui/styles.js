// SPDX-License-Identifier: MIT
// Styles of the panel's shadow root. Colours and fonts are Home Assistant's theme variables with fallbacks, so the
// panel follows light, dark and custom themes and stays readable outside Home Assistant (dev page). Interactive
// targets are at least 24 px (spec 9.3, WCAG 2.2 2.5.8); most are 40 px. Focus rings use the text colour, which
// keeps 3:1 where the theme's primary colour may not.
export const STYLES = `
:host {
  display: block; height: 100%; position: relative; box-sizing: border-box;
  --mte-bg: var(--primary-background-color, #fafafa);
  --mte-card: var(--card-background-color, var(--ha-card-background, #ffffff));
  --mte-fg: var(--primary-text-color, #212121);
  --mte-muted: var(--secondary-text-color, #5f5f5f);
  --mte-divider: var(--divider-color, rgba(0, 0, 0, 0.12));
  --mte-accent: var(--primary-color, #03a9f4);
  --mte-on-accent: var(--text-primary-color, #ffffff);
  --mte-warn: var(--warning-color, #ffa600);
  --mte-error: var(--error-color, #db4437);
  --mte-shadow: 0 2px 8px rgba(0, 0, 0, 0.18);
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
/* Controls on the map (design by Fabian Schwamborn, 2026-11-01): "Devices" and the switch top left, "View" and
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
/* Where the tabs do not fit (a narrow side panel, long German names) the row scrolls and fades out at the edge that
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
.details-head p { margin-top: 2px; }
.actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 10px 0 4px; }
.button { display: inline-flex; align-items: center; gap: 6px; min-height: 36px; padding: 0 12px; border-radius: 18px;
  border: 1px solid var(--mte-divider); background: transparent; color: var(--mte-fg); font: inherit; font-size: 13px;
  text-decoration: none; cursor: pointer; }
.button:disabled { color: var(--mte-muted); cursor: default; }
.link { display: inline; min-height: 24px; padding: 2px 0; border: none; background: none; color: inherit; font: inherit;
  text-align: left; text-decoration: underline; text-decoration-color: var(--mte-muted); text-underline-offset: 2px;
  cursor: pointer; }
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
.device-row { display: flex; flex-direction: column; justify-content: center; min-height: 44px; padding: 4px 8px;
  border-radius: 6px; cursor: pointer; }
.device-row[aria-selected="true"] { background: color-mix(in srgb, var(--mte-accent) 16%, transparent);
  box-shadow: inset 3px 0 0 var(--mte-accent); }
.devices:focus-visible .device-row[data-active="true"], .devices:focus .device-row[data-active="true"] {
  outline: 2px solid var(--mte-fg); outline-offset: -2px; }
.row-label { font-weight: 500; overflow-wrap: anywhere; }
.row-meta { color: var(--mte-muted); font-size: 12px; }
.swatches { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
.swatches li { display: flex; align-items: center; gap: 8px; font-size: 13px; }
.swatches.symbols li, .swatches.pictures li { gap: 12px; }
.swatches.pictures { grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); }
.small svg { vertical-align: middle; }
fieldset { border: none; margin: 0 0 14px; padding: 0; }
legend { font-weight: 600; padding: 0; margin-bottom: 4px; }
/* View tab (design by Fabian Schwamborn, 2026-11-01): groups of real checkboxes and radios, 44 px rows. */
.view-group { display: flex; flex-direction: column; margin: 0 0 16px; }
.view-group > legend { font-size: 13px; font-weight: 700; color: var(--mte-muted); margin-bottom: 2px; }
.with-info { display: flex; align-items: center; gap: 2px; }
.check-row { display: flex; align-items: center; gap: 10px; min-height: 44px; padding: 0 8px; margin: 0 -8px;
  border-radius: 8px; cursor: pointer; font-size: 15px; }
.check-row input { width: 20px; height: 20px; margin: 0; flex: none; accent-color: var(--mte-fg); }
.radio-line { display: flex; flex-wrap: wrap; column-gap: 20px; }
.radio-line .check-row { margin: 0; }
.color-row { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 14px; padding-left: 24px; margin-top: 2px; }
.color-pick { display: flex; flex-direction: column; align-items: center; gap: 4px; min-height: 44px; font-size: 13px;
  color: var(--mte-muted); cursor: pointer; }
.color-pick input { width: 44px; height: 32px; padding: 2px; border: 1px solid var(--mte-divider); border-radius: 8px;
  background: var(--mte-card); cursor: pointer; }
.color-note { flex: 1 1 8em; }
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
/* "RX:" over a value, as the map writes it beside a lane. */
.rx-sample { display: inline-flex; flex-direction: column; align-items: center; width: 36px; flex: none; font-size: 11px;
  line-height: 13px; }
/* Confirmation dialog (scan): native <dialog> in the top layer, themed like the panels. */
dialog.confirm { max-width: min(30em, calc(100vw - 32px)); padding: 20px 24px 16px; border: none; border-radius: 12px;
  background: var(--mte-card); color: var(--mte-fg); box-shadow: 0 8px 32px rgba(0, 0, 0, 0.35); }
dialog.confirm::backdrop { background: rgba(0, 0, 0, 0.45); }
dialog.confirm h2 { margin: 0 0 10px; }
dialog.confirm p { margin: 0 0 10px; }
.dialog-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
.button.primary { background: var(--mte-accent); color: var(--mte-on-accent); border-color: transparent; font-weight: 500; }
.status-stop { min-height: 24px; color: inherit; }
.storage { padding: 8px 10px; border-radius: 6px; background: color-mix(in srgb, var(--mte-fg) 5%, transparent); }
.storage.warn { box-shadow: inset 3px 0 0 var(--mte-warn); }

/* Status line: always visible, wraps on narrow screens */
.status { flex: none; display: flex; flex-wrap: wrap; align-items: center; gap: 0 4px; min-height: 28px;
  padding: 4px 12px; font-size: 12px; color: var(--mte-muted); background: var(--mte-bg);
  border-top: 1px solid var(--mte-divider); }
.status.compact { min-height: 0; padding: 3px 12px; line-height: 1.35; }
.status .part:not(:last-child)::after { content: "\\00B7"; margin-left: 4px; }
`;
