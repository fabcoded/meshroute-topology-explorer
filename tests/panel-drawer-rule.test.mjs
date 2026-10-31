// SPDX-License-Identifier: MIT
// What the drawer does on a selection or a request (spec 9.1, 9.2; ui/drawer-rule.js): it never takes a tab away,
// closes only what it opened by itself, opens collapsed when automatic and expanded when asked for.
// node --test "tests/**/*.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import { afterSelect, detailsRequest, tabRequest, openOnSelect, tabVisible } from "../custom_components/meshroute_topology_explorer/frontend/ui/drawer-rule.js";

const closed = { isOpen: false, tab: "details", auto: false, mode: "sheet", expanded: false };

test("open details on select: by screen width unless stored", () => {
  assert.equal(openOnSelect(null, true), true);
  assert.equal(openOnSelect(null, false), false);
  assert.equal(openOnSelect(undefined, false), false);
  assert.equal(openOnSelect(true, false), true);
  assert.equal(openOnSelect(false, true), false);
});

test("a selection on the map opens a closed drawer on Details, collapsed and automatic", () => {
  assert.deepEqual(afterSelect({ id: "a", source: "map", openOnSelect: true, drawer: closed }),
    { action: "open", tab: "details", expanded: false, auto: true, focus: false });
  assert.deepEqual(afterSelect({ id: "a", source: "map", openOnSelect: false, drawer: closed }), { action: "none" });
});

test("it never takes another tab away, and follows on Details without making a user-opened drawer automatic", () => {
  for (const tab of ["devices", "findings", "legend", "settings"]) {
    const open = { ...closed, isOpen: true, tab };
    assert.deepEqual(afterSelect({ id: "a", source: "map", openOnSelect: true, drawer: open }), { action: "none" }, tab);
  }
  const userDetails = { ...closed, isOpen: true, tab: "details", auto: false, expanded: true };
  const answer = afterSelect({ id: "b", source: "map", openOnSelect: true, drawer: userDetails });
  assert.equal(answer.action, "open");
  assert.equal(answer.auto, false, "still the user's drawer");
});

test("clearing the selection closes only an automatic drawer on Details", () => {
  const auto = { ...closed, isOpen: true, tab: "details", auto: true };
  assert.deepEqual(afterSelect({ id: null, source: "map", openOnSelect: true, drawer: auto }), { action: "close" });
  assert.deepEqual(afterSelect({ id: null, source: "map", openOnSelect: true, drawer: { ...auto, auto: false } }), { action: "none" });
  assert.deepEqual(afterSelect({ id: null, source: "map", openOnSelect: true, drawer: { ...auto, tab: "findings" } }), { action: "none" });
});

test("selections from lists and the chip leave the drawer alone", () => {
  for (const source of ["list", "chip"]) {
    assert.deepEqual(afterSelect({ id: "a", source, openOnSelect: true, drawer: closed }), { action: "none" });
    assert.deepEqual(afterSelect({ id: null, source, openOnSelect: true, drawer: { ...closed, isOpen: true, auto: true } }), { action: "none" });
  }
});

test("requests open expanded; keyboard requests move focus; header toggles close a tab in view", () => {
  assert.deepEqual(detailsRequest("long-press"), { action: "open", tab: "details", expanded: true, auto: false, focus: false });
  assert.equal(detailsRequest("context-menu").focus, false);
  assert.equal(detailsRequest("key").focus, true);
  assert.equal(detailsRequest("button").focus, true);
  assert.deepEqual(tabRequest({ tab: "findings", drawer: closed }), { action: "open", tab: "findings", expanded: true, auto: false, focus: true });
  const side = { isOpen: true, tab: "findings", mode: "side", expanded: false, auto: false };
  assert.equal(tabVisible(side, "findings"), true);
  assert.deepEqual(tabRequest({ tab: "findings", drawer: side }), { action: "close" });
  assert.equal(tabRequest({ tab: "findings", drawer: side, toggle: false }).action, "open", "menu entries always open");
  const collapsedSheet = { ...side, mode: "sheet", expanded: false };
  assert.equal(tabVisible(collapsedSheet, "findings"), false);
  assert.equal(tabRequest({ tab: "findings", drawer: collapsedSheet }).action, "open", "a collapsed sheet expands instead of closing");
});
