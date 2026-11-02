// SPDX-License-Identifier: MIT
// What the two panels do on a selection or a request (spec 9.1, 9.2;
// ui/drawer-rule.js): "Details on click" opens the left panel on Details from the map and the Devices list, never
// takes Findings away, never pushes the right sheet away on narrow screens; buttons toggle their tab; one sheet at a
// time on narrow screens. node --test "tests/**/*.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import { afterSelect, detailsRequest, tabRequest, openOnSelect, tabVisible } from "../custom_components/meshroute_topology_explorer/frontend/ui/drawer-rule.js";

const shut = { isOpen: false, tab: "devices", auto: false, mode: "side", expanded: false };
const state = (left = {}, right = {}, wide = true) => ({ wide, left: { ...shut, ...left }, right: { ...shut, tab: "view", ...right } });
const select = (id, source, open, st) => afterSelect({ id, source, openOnSelect: open, state: st });

test("Details on click: by screen width unless stored", () => {
  assert.equal(openOnSelect(null, true), true);
  assert.equal(openOnSelect(null, false), false);
  assert.equal(openOnSelect(undefined, false), false);
  assert.equal(openOnSelect(true, false), true);
  assert.equal(openOnSelect(false, true), false);
});

test("switch on: a click on the map opens the closed left panel on Details, collapsed and automatic", () => {
  assert.deepEqual(select("a", "map", true, state()),
    [{ panel: "left", action: "open", tab: "details", expanded: false, auto: true, focus: false }]);
  assert.deepEqual(select("a", "map", false, state()), [], "switch off: nothing opens");
  assert.deepEqual(select("a", "devices", false, state({ isOpen: true })), [], "switch off: the list stays");
});

test("switch on: a click on the map or in the list switches Devices to Details, but never takes Findings away", () => {
  const devices = state({ isOpen: true, tab: "devices", expanded: true });
  const [step] = select("a", "map", true, devices);
  assert.equal(step.tab, "details");
  assert.equal(step.auto, false, "still the user's panel");
  assert.deepEqual(select("a", "devices", true, devices),
    [{ panel: "left", action: "open", tab: "details", expanded: true, auto: false, focus: "panel" }]);
  const findings = state({ isOpen: true, tab: "findings" });
  assert.deepEqual(select("a", "map", true, findings), [], "Findings stays");
  assert.deepEqual(select("a", "findings", true, findings), [], "a finding selects and zooms, the list stays");
  const details = state({ isOpen: true, tab: "details", auto: true });
  assert.deepEqual(select("b", "details", true, details), [], "a device named in Details: Details follows by itself");
  assert.equal(select("b", "map", true, details)[0].auto, true, "an automatic panel stays automatic");
});

test("on narrow screens a click never pushes the right sheet away; on wide ones both panels may be open", () => {
  const narrowView = state({}, { isOpen: true, mode: "sheet" }, false);
  assert.deepEqual(select("a", "map", true, narrowView), []);
  const wideView = state({}, { isOpen: true }, true);
  assert.equal(select("a", "map", true, wideView).length, 1, "wide: details open beside the View panel");
});

test("clearing the selection on the map closes only an automatic left panel on Details", () => {
  const auto = state({ isOpen: true, tab: "details", auto: true });
  assert.deepEqual(select(null, "map", true, auto), [{ panel: "left", action: "close" }]);
  assert.deepEqual(select(null, "map", true, state({ isOpen: true, tab: "details" })), []);
  assert.deepEqual(select(null, "map", true, state({ isOpen: true, tab: "findings", auto: true })), []);
  assert.deepEqual(select(null, "devices", true, auto), []);
});

test("buttons open their tab expanded with focus and close it when it is already in view; one sheet at a time", () => {
  assert.deepEqual(tabRequest({ panel: "right", tab: "legend", state: state() }),
    [{ panel: "right", action: "open", tab: "legend", expanded: true, auto: false, focus: "tab" }]);
  const legend = state({}, { isOpen: true, tab: "legend" });
  assert.equal(tabVisible(legend.right, "legend"), true);
  assert.deepEqual(tabRequest({ panel: "right", tab: "legend", state: legend }), [{ panel: "right", action: "close" }]);
  assert.equal(tabRequest({ panel: "right", tab: "view", state: legend })[0].tab, "view", "the other tab switches");
  // Narrow: the Devices button closes the right sheet first; a collapsed sheet expands instead of closing.
  const narrow = state({ mode: "sheet" }, { isOpen: true, mode: "sheet", expanded: true }, false);
  assert.deepEqual(tabRequest({ panel: "left", tab: "devices", state: narrow }).map((s) => [s.panel, s.action]),
    [["right", "close"], ["left", "open"]]);
  const collapsed = state({ isOpen: true, tab: "devices", mode: "sheet", expanded: false }, {}, false);
  assert.equal(tabVisible(collapsed.left, "devices"), false);
  assert.equal(tabRequest({ panel: "left", tab: "devices", state: collapsed }).at(-1).action, "open");
  // Wide: the other panel stays.
  assert.deepEqual(tabRequest({ panel: "left", tab: "devices", state: state({}, { isOpen: true }) }).map((s) => s.panel), ["left"]);
});

test("details asked for (right-click, long press, menu key) open the left panel expanded; only the key moves focus", () => {
  assert.deepEqual(detailsRequest("long-press", state()),
    [{ panel: "left", action: "open", tab: "details", expanded: true, auto: false, focus: false }]);
  assert.equal(detailsRequest("context-menu", state())[0].focus, false);
  assert.equal(detailsRequest("key", state())[0].focus, "tab");
  const narrow = state({}, { isOpen: true, mode: "sheet" }, false);
  assert.deepEqual(detailsRequest("key", narrow).map((s) => [s.panel, s.action]), [["right", "close"], ["left", "open"]]);
});
