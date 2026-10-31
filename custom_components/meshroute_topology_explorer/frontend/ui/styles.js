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
  --mte-header-bg: var(--app-header-background-color, var(--mte-bg));
  --mte-header-fg: var(--app-header-text-color, var(--mte-fg));
  --mte-shadow: 0 2px 8px rgba(0, 0, 0, 0.18);
  --inset-right: 0px; --inset-bottom: 0px;
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

/* Header */
.toolbar { display: flex; align-items: center; gap: 4px; flex: none; height: var(--header-height, 56px);
  padding: 0 4px 0 12px; background: var(--mte-header-bg); color: var(--mte-header-fg);
  border-bottom: var(--app-header-border-bottom, 1px solid var(--mte-divider)); }
.toolbar.narrow { padding-left: 4px; }
.title { flex: 1; min-width: 0; margin: 0 8px 0 4px; font-size: 20px; font-weight: 400; white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis; }
.density { display: flex; align-items: center; gap: 6px; font-size: 13px; }
.density select { height: 32px; }
select { font: inherit; color: inherit; background: transparent; border: 1px solid currentColor; border-radius: 6px;
  padding: 0 6px; min-height: 32px; }
option { color: var(--mte-fg); background: var(--mte-card); }
.badge { display: inline-flex; align-items: center; gap: 6px; height: 40px; padding: 0 10px; border-radius: 20px;
  border: none; background: transparent; color: inherit; font: inherit; cursor: pointer; }
.badge .count { min-width: 24px; height: 24px; padding: 0 7px; border-radius: 12px; display: inline-flex;
  align-items: center; justify-content: center; font-weight: 500; font-size: 13px;
  border: 1.5px solid currentColor; }
.badge[data-count="0"] .count { opacity: 0.75; }
.icon-button { display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 40px;
  flex: none; border: none; border-radius: 50%; background: transparent; color: inherit; cursor: pointer; padding: 0; }
.icon-button:hover, .badge:hover, .menu-item:hover:not(:disabled), .tab:hover, .sheet-line:hover {
  background: color-mix(in srgb, currentColor 10%, transparent); }
button:focus-visible, a:focus-visible, select:focus-visible, input:focus-visible, [tabindex]:focus-visible {
  outline: 2px solid var(--mte-fg); outline-offset: 2px; }
.menu-wrap { position: relative; }
.menu-pop { position: absolute; right: 0; top: 44px; z-index: 20; min-width: 220px; padding: 6px 0;
  background: var(--mte-card); color: var(--mte-fg); border-radius: 8px; box-shadow: var(--mte-shadow);
  border: 1px solid var(--mte-divider); }
.menu-item { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 40px; padding: 0 16px;
  border: none; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.menu-item:disabled { color: var(--mte-muted); cursor: default; }
.menu-item .check { width: 16px; text-align: center; }
.menu-pop .sep { height: 1px; margin: 6px 0; background: var(--mte-divider); }

/* Map and what floats on it */
.map { position: relative; flex: 1; min-height: 0; overflow: hidden; background: var(--mte-bg); }
canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; outline: none; }
canvas:focus-visible { box-shadow: inset 0 0 0 2px var(--mte-fg); }
.float { background: var(--mte-card); color: var(--mte-fg); border: 1px solid var(--mte-divider); border-radius: 8px;
  box-shadow: var(--mte-shadow); }
.top { position: absolute; top: 8px; left: 8px; right: calc(var(--inset-right) + 8px); display: flex;
  flex-direction: column; align-items: center; gap: 6px; pointer-events: none; }
.top > * { pointer-events: auto; max-width: 100%; }
.banner { padding: 6px 12px; font-size: 13px; display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap;
  justify-content: center; text-align: center; }
.banner strong { font-weight: 600; }
.banner.incomplete { border-left: 4px solid var(--mte-warn); }
.banner.lost { border-left: 4px solid var(--mte-error); }
.banner.loading { border-left: 4px solid var(--mte-accent); }
.chip { align-self: flex-start; display: flex; align-items: center; gap: 2px; padding: 0 2px 0 12px; min-height: 44px;
  max-width: min(100%, 420px); }
.chip .chip-name { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-right: 4px; }
.chip .chip-details { display: inline-flex; align-items: center; gap: 4px; height: 36px; padding: 0 10px;
  border-radius: 18px; border: 1px solid var(--mte-divider); background: transparent; color: inherit; font: inherit;
  cursor: pointer; white-space: nowrap; }
.zoom { position: absolute; right: calc(var(--inset-right) + 12px); bottom: calc(var(--inset-bottom) + 12px);
  display: flex; flex-direction: column; overflow: hidden; }
.zoom .icon-button { border-radius: 0; width: 40px; height: 40px; }
.zoom .icon-button + .icon-button { border-top: 1px solid var(--mte-divider); }
.mini-legend { position: absolute; left: 12px; bottom: calc(var(--inset-bottom) + 12px); display: flex;
  flex-direction: column; align-items: stretch; gap: 3px; padding: 6px 10px; font: inherit; font-size: 12px;
  text-align: left; cursor: pointer; max-width: calc(100% - var(--inset-right) - 88px); }
.mini-title { font-weight: 500; }
.scale-bar { display: block; height: 10px; border-radius: 2px; min-width: 140px; }
.scale-bar.mini { height: 8px; }
.scale-ends { display: flex; justify-content: space-between; gap: 12px; color: var(--mte-muted); }
.mini-swatches { display: flex; flex-wrap: wrap; gap: 2px 10px; }
.mini-swatch { display: inline-flex; align-items: center; gap: 2px; }
.mini-swatch svg { width: 16px; height: 16px; }
.message { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center;
  justify-content: center; gap: 12px; padding: 24px; text-align: center; }
.message p { max-width: 36em; margin: 0; font-size: 16px; }
.message.warn p::before, .message.error p::before { content: ""; display: block; width: 40px; height: 4px;
  margin: 0 auto 12px; border-radius: 2px; background: var(--mte-warn); }
.message.error p::before { background: var(--mte-error); }

/* Drawer */
.drawer { position: absolute; z-index: 10; display: flex; flex-direction: column; background: var(--mte-card);
  color: var(--mte-fg); box-shadow: var(--mte-shadow); }
.drawer[data-mode="side"] { top: 0; right: 0; bottom: 0; width: var(--drawer-size, 360px);
  border-left: 1px solid var(--mte-divider); }
.drawer[data-mode="sheet"] { left: 0; right: 0; bottom: 0; height: var(--drawer-size, 56px);
  border-top: 1px solid var(--mte-divider); border-radius: 12px 12px 0 0; }
.drawer-head { display: flex; align-items: center; flex: none; min-height: 48px; padding-right: 4px;
  border-bottom: 1px solid var(--mte-divider); }
.drawer[data-collapsed="true"] .drawer-head { border-bottom: none; height: 100%; }
.tabs { display: flex; flex: 1; min-width: 0; overflow-x: auto; scrollbar-width: none; }
.tab { flex: none; height: 48px; padding: 0 12px; border: none; border-bottom: 3px solid transparent;
  background: transparent; color: var(--mte-muted); font: inherit; font-size: 13px; cursor: pointer; }
.tab[aria-selected="true"] { color: var(--mte-fg); font-weight: 600; border-bottom-color: var(--mte-accent); }
.sheet-line { flex: 1; min-width: 0; display: flex; align-items: center; justify-content: space-between; gap: 8px;
  height: 48px; padding: 0 8px 0 16px; border: none; background: transparent; color: inherit; font: inherit;
  text-align: left; cursor: pointer; }
.summary-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.drawer-body { flex: 1; min-height: 0; overflow: auto; }
.tabpanel { padding: 12px 16px 24px; }
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
.filter-label { display: block; }
.filter { width: 100%; height: 40px; padding: 0 12px; font: inherit; color: var(--mte-fg); background: transparent;
  border: 1px solid var(--mte-divider); border-radius: 8px; }
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
.scale { margin: 6px 0 10px; }
.scale p { display: flex; align-items: center; gap: 6px; }
.small svg { vertical-align: middle; }
fieldset { border: none; margin: 0 0 14px; padding: 0; }
legend { font-weight: 600; padding: 0; margin-bottom: 4px; }
.radio { display: flex; align-items: center; gap: 8px; min-height: 32px; cursor: pointer; }
.radio input { width: 18px; height: 18px; margin: 0; accent-color: var(--mte-accent); }
.field { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px;
  margin: 0 0 14px; }
.field label { font-weight: 600; }
.storage { padding: 8px 10px; border-radius: 6px; background: color-mix(in srgb, var(--mte-fg) 5%, transparent); }
.storage.warn { box-shadow: inset 3px 0 0 var(--mte-warn); }

/* Status line: always visible, wraps on narrow screens */
.status { flex: none; display: flex; flex-wrap: wrap; align-items: center; gap: 0 4px; min-height: 28px;
  padding: 4px 12px; font-size: 12px; color: var(--mte-muted); background: var(--mte-bg);
  border-top: 1px solid var(--mte-divider); }
.status .part:not(:last-child)::after { content: "\\00B7"; margin-left: 4px; }
`;
