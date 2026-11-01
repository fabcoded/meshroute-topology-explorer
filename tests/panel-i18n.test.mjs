// SPDX-License-Identifier: MIT
// Texts of the panel (spec 10): English and German have the same keys and placeholders, the language follows the
// Home Assistant locale with English as fallback, and the coordinator label is translated.
// node --test "tests/**/*.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import { STRINGS, languageOf, translator, localize } from "../custom_components/meshroute_topology_explorer/frontend/ui/i18n.js";
import { sampleNetwork } from "./panel-fixture.mjs";

const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

test("English and German have the same keys and the same placeholders", () => {
  const en = Object.keys(STRINGS.en).sort();
  const de = Object.keys(STRINGS.de).sort();
  assert.deepEqual(de, en);
  for (const key of en) {
    assert.equal(placeholders(STRINGS.de[key]), placeholders(STRINGS.en[key]), key);
    assert.ok(STRINGS.de[key].trim() && STRINGS.en[key].trim(), `${key} is not empty`);
  }
});

test("the language comes from hass.locale, then hass.language, else English", () => {
  assert.equal(languageOf({ locale: { language: "de" }, language: "en" }), "de");
  assert.equal(languageOf({ language: "de-CH" }), "de");
  assert.equal(languageOf({ locale: { language: "fr" } }), "en");
  assert.equal(languageOf(null), "en");
  const t = translator("de");
  assert.equal(t("status.tables", { x: 3, y: 4 }), "Tabellen 3 von 4");
  assert.equal(t("no.such.key"), "no.such.key");
  assert.equal(translator("xx").lang, "en");
  assert.equal(t.time("2026-01-01T11:30:28"), "2026-01-01 11:30", "ZHA's local time is shown as text, minutes only");
  assert.equal(t.time(null), "?");
  assert.equal(t.number(1234), "1.234");
});

test("the model's coordinator label is translated, user labels stay", () => {
  const network = sampleNetwork();
  const de = localize(network, translator("de"));
  const coordinator = de.devices.find((d) => d.labelKind === "coordinator");
  assert.equal(coordinator.label, "Koordinator");
  assert.equal(network.devices.find((d) => d.labelKind === "coordinator").label, "Coordinator", "the model is not changed");
  const others = de.devices.filter((d) => d.labelKind !== "coordinator");
  assert.ok(others.every((d) => d === network.devices.find((x) => x.id === d.id)), "other devices are the same objects");
});

test("node view, colour by reception and the path texts have words in English and German", () => {
  const en = translator("en");
  const de = translator("de");
  const keys = ["nodeview.title", "nodeview.coordinator", "nodeview.all", "options.nodeview", "settings.nodeview",
    "settings.nodeview_note", "links.colors", "lane.rx", "lane.path_unknown", "details.paths_coordinator",
    "details.paths_all", "details.paths_note", "details.path_up", "details.path_down", "details.path_out",
    "details.path_in", "details.path_hop", "details.path_unknown", "details.path_unavailable", "details.paths_none",
    "legend.link.path", "legend.link.path-implied", "legend.link.path-end", "legend.link.reception",
    "legend.link_short.reception"];
  for (const key of keys) {
    assert.ok(key in STRINGS.en && key in STRINGS.de, key);
  }
  assert.equal(en("nodeview.title"), "Node view");
  assert.equal(de("nodeview.title"), "Knotenansicht");
  assert.equal(en("nodeview.coordinator"), "Path to coordinator");
  assert.equal(en("nodeview.all"), "All paths");
  assert.equal(de("nodeview.all"), "Alle Wege");
  assert.equal(en("lane.rx"), "RX:");
  assert.equal(de("lane.rx"), "RX:", "the owner's own abbreviation, in both languages");
  assert.equal(de("options.nodeview", { value: de("nodeview.coordinator") }), "Knotenansicht: Weg zum Koordinator");
});
