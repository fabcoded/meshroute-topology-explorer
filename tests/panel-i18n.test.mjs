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

test("node view, path display and the path texts have words in English and German", () => {
  const en = translator("en");
  const de = translator("de");
  const keys = ["view.on_click", "view.nodeview_coordinator", "view.nodeview_all", "view.path_display", "view.grey",
    "view.coloured", "lane.rx", "lane.path_unknown", "details.paths_coordinator",
    "details.paths_all", "details.paths_note", "details.path_up", "details.path_down", "details.path_out",
    "details.path_in", "details.path_hop", "details.path_unknown", "details.path_unavailable", "details.paths_none",
    "legend.link.path", "legend.link.path-implied", "legend.link.path-end", "legend.link.reception"];
  for (const key of keys) {
    assert.ok(key in STRINGS.en && key in STRINGS.de, key);
  }
  assert.equal(en("view.nodeview_coordinator"), "Only the communication path with the coordinator (there and back)");
  assert.equal(de("view.nodeview_coordinator"), "nur Kommunikationsweg mit dem Koordinator (hin und zurück)");
  assert.equal(de("view.nodeview_all"), "alle Routen von und zu anderen Geräten");
  assert.equal(en("lane.rx"), "RX:");
  assert.equal(de("lane.rx"), "RX:", "the owner's own abbreviation, in both languages");
});

test("the new menu: every control on the map and in both panels has words in English and German (design 2026-11-01)", () => {
  const de = translator("de");
  const en = translator("en");
  // The owner's German words, as on the design boards M1-M7.
  const words = {
    "map.devices": "Geräte", "map.details_on_click": "Details bei Klick", "map.view": "Ansicht", "map.legend": "Legende",
    "tab.devices": "Geräte", "tab.findings": "Befunde", "tab.details": "Details", "tab.view": "Ansicht", "tab.legend": "Legende",
    "view.paths": "Kommunikationspfade", "view.link_up": "Weg nach oben", "view.link_route": "andere Routen",
    "view.link_heard": "nur gehört", "view.path_display": "Pfaddarstellung", "view.grey": "grau",
    "view.coloured": "farbig nach Empfang", "view.bad": "schlecht", "view.medium": "mittel", "view.good": "gut",
    "view.colors_note": "frei wählbar, z. B. für Farbenblinde", "view.on_click": "Bei Klick auf ein Gerät",
    "view.open_details": "Details öffnen", "view.density": "Knotenentfernung (Dichte)", "view.fill": "Füllung der Symbole",
    "view.labels": "Beschriftung auf der Karte", "view.label_type": "Gerätetyp über dem Symbol",
    "view.label_name": "lesbarer Name unter dem Symbol", "view.label_ha": "Original-HA-Bezeichnung",
    "view.debug": "Debug-Modus", "view.reload": "Daten neu lesen", "view.release": "Alle Pins lösen",
    "legend.paths_title": "Kommunikationspfade", "legend.rx": "Empfang beim Empfänger, ein Viertel vor ihm",
    "devices.search": "Suchen", "map.devices_label": "Geräte öffnen, {count} Befunde",
    "view.density_info": "Die Entfernung zwischen den Geräten ist aus Feldstärke und Empfangsqualität abgeleitet; die Dichte vervielfacht sie.",
  };
  for (const [key, text] of Object.entries(words)) {
    assert.equal(STRINGS.de[key], text, key);
    assert.ok(STRINGS.en[key] && STRINGS.en[key] !== key, `en ${key}`);
  }
  assert.equal(en("map.devices_label", { count: 5 }), "Open devices, 5 findings");
  assert.equal(en("view.label_ha"), "Original HA name");
  for (const kind of ["light", "outlet", "relay", "button", "sensor", "motion", "temperature", "thermostat", "blind", "lock", "hub"]) {
    assert.ok(en(`kind_short.${kind}`) !== `kind_short.${kind}` && de(`kind_short.${kind}`) !== `kind_short.${kind}`, kind);
  }
  assert.equal(en("kind_short.light"), "Light");
  assert.equal(de("kind_short.light"), "Lampe");
  // What went with the old chrome has no words left.
  for (const gone of ["options.menu", "menu.settings", "tab.settings", "legend.pill", "selection.details", "links.colors"]) {
    assert.ok(!(gone in STRINGS.en) && !(gone in STRINGS.de), gone);
  }
});
