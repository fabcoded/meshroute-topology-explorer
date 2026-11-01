// SPDX-License-Identifier: MIT
// Texts of the panel (spec 10): English only (owner decision 2026-11-01), English is the complete reference, the dormant
// German table may lack keys, and the coordinator label is translated.
// node --test "tests/**/*.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import { STRINGS, ACTIVE_LANGUAGES, languageOf, formatLocaleOf, translator, localize } from "../custom_components/meshroute_topology_explorer/frontend/ui/i18n.js";
import { sampleNetwork } from "./panel-fixture.mjs";

const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

test("English is the complete reference: every key of the dormant German table exists in English with the same placeholders", () => {
  for (const [key, text] of Object.entries(STRINGS.de)) {
    assert.ok(key in STRINGS.en, `${key} exists in English`);
    assert.equal(placeholders(text), placeholders(STRINGS.en[key]), key);
  }
  for (const [key, text] of Object.entries(STRINGS.en)) assert.ok(text.trim(), `${key} is not empty`);
});

test("the panel is English only: any Home Assistant locale gets English texts (owner decision 2026-11-01)", () => {
  assert.deepEqual([...ACTIVE_LANGUAGES], ["en"]);
  for (const hass of [{ locale: { language: "de" }, language: "en" }, { language: "de-CH" }, { locale: { language: "fr" } }, null]) {
    assert.equal(languageOf(hass), "en");
  }
  assert.equal(translator(languageOf({ language: "de" }))("status.tables", { x: 3, y: 4 }), "Router tables: 3/4");
});

test("dates and numbers keep following the user's locale, not the text language", () => {
  assert.equal(formatLocaleOf({ locale: { language: "de" } }), "de");
  assert.equal(formatLocaleOf({ language: "de-CH" }), "de");
  assert.equal(formatLocaleOf(null), "en");
  const t = translator("en", "de");
  assert.equal(t("zoom.fit"), "Fit");
  assert.equal(t.number(1234), "1.234");
  assert.equal(translator("en").number(1234), "1,234");
});

test("translation helpers: placeholders, missing keys, unknown language, time text", () => {
  const t = translator("de");
  assert.equal(t("status.tables", { x: 3, y: 4 }), "Tabellen 3 von 4", "the dormant table still renders");
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

test("communication paths, path display and the path texts have words in English and German", () => {
  const en = translator("en");
  const de = translator("de");
  const keys = ["view.on_click", "view.paths_coordinator", "view.paths_all", "view.paths_heard", "view.path_display", "view.grey",
    "view.coloured", "lane.rx", "lane.path_unknown", "details.paths_coordinator",
    "details.paths_all", "details.paths_note", "details.path_up", "details.path_down", "details.path_out",
    "details.path_in", "details.path_down_assumed", "details.rx", "details.path_unknown", "details.path_unavailable", "details.paths_none",
    "legend.link.coordinator", "legend.link.assumed", "legend.link.path-end", "legend.link.reception"];
  for (const key of keys) {
    assert.ok(key in STRINGS.en && key in STRINGS.de, key);
  }
  assert.equal(en("view.paths_all"), "+ paths to all devices (theoretical)");
  assert.equal(de("view.paths_all"), "+ Wege zu allen Geräten (theoretisch)");
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
    "view.paths": "Kommunikationspfade", "view.paths_heard": "nur gehört (beste 3)",
    "view.path_display": "Pfaddarstellung", "view.grey": "grau",
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

test("Details, cluster popup, device rows and the source-route stage use the owner's words (boards M1-M4, M8-M10)", () => {
  const words = {
    "details.tab_communication": "Kommunikation", "details.tab_entity": "Entität", "details.tab_cluster": "Cluster",
    "details.paths_coordinator": "Kommunikationsweg mit dem Koordinator", "details.path_up": "hin", "details.path_down": "zurück",
    "details.children_title": "Kinder (End-Devices)", "details.heard_title": "Wird gehört von {by} \u00b7 hört {hears}",
    "details.readings_all": "\u2026 alle {count} mit RX und Rang relativ zum Messenden", "details.tables_title": "Tabellen und Last",
    "rank.short": "Rang {pct} %", "node.title": "Knoten", "node.rx_on": "immer empfangsbereit", "node.band_2400": "2,4 GHz",
    "node.firmware": "Firmware", "node.quirk_none": "keiner", "node.buffer_value": "{n} Byte, Transfer {transfer} Byte",
    "node.last_heard": "Zuletzt gehört", "node.unknown": "unbekannt",
    "ha.title": "In Home Assistant öffnen", "ha.device": "Geräteseite", "ha.zha": "Zigbee-Infos (ZHA)", "ha.area": "Bereich {name}",
    "ha.logbook": "Logbuch", "ha.history": "Verlauf", "ha.entities": "Entitätenliste",
    "ha.entities_title": "Entitäten in Home Assistant ({count}) \u00b7 Klick öffnet den Detaildialog",
    "cluster.in": "Eingang", "cluster.out": "Ausgang", "cluster.col_direction": "Richtung", "cluster.manufacturer": "herstellereigen",
    "cluster.endpoint": "Endpunkt {n}", "attr.title": "Bekannte Attribute laut Zigbee-Spezifikation", "attr.col_value": "Aktueller Wert",
    "read.button": "Werte am Gerät lesen", "read.manage": "In ZHA verwalten",
    "read.read_only": "Die Karte ist nur lesend: Schreiben, Reporting und Binden gehen in der Geräteverwaltung von ZHA.",
    "devices.direct": "direkt am Koordinator", "devices.via": "über {name}", "devices.sleeps": "schläft", "devices.network": "Netzwerk",
    "view.source_route": "Rückwege ohne Tabelleneintrag (Source Route)", "view.sr_off": "aus: Rückweg bleibt \u201eunbekannt\u201c",
    "view.sr_assume": "annehmen: Umkehr des Hinwegs (gepunktet)", "view.sr_zigpy": "aus zigpy lesen",
    "view.sr_experimental": "experimentell",
  };
  for (const [key, text] of Object.entries(words)) {
    assert.equal(STRINGS.de[key], text, key);
    assert.ok(STRINGS.en[key] && STRINGS.en[key] !== key, `en ${key}`);
  }
  const en = translator("en");
  assert.equal(en("read.button"), "Read values from the device");
  assert.equal(en("read.read_only"), "The map is read-only: writing, reporting and binding are done in ZHA's device management.");
  assert.equal(en("view.source_route"), "Return paths without a table entry (source route)");
  // The Details rebuilt in cards left these without callers.
  for (const gone of ["details.path_hop", "details.open_ha", "details.heard_by", "details.col_lqi"]) {
    assert.ok(!(gone in STRINGS.en) && !(gone in STRINGS.de), gone);
  }
});

test("area names from Home Assistant's hass.areas win over the registry's; the coordinator is translated", () => {
  const network = sampleNetwork();
  const device = network.devices.find((d) => d.areaId);
  const out = localize(network, translator("de"), { [device.areaId]: { name: "Wohnzimmer" } });
  assert.equal(out.devices.find((d) => d.id === device.id).area, "Wohnzimmer");
  assert.equal(localize(network, translator("de")).devices.find((d) => d.id === device.id).area, device.area, "without: the registry");
  assert.equal(localize(network, translator("de"), { [device.areaId]: { name: " " } }).devices.find((d) => d.id === device.id).area,
    device.area, "an empty name does not win");
});

test("legend, View and Details texts of the A4j boards (M2, M7) in German, with English counterparts", () => {
  const words = {
    "legend.symbol_router": "Rahmen mit Lücken und Strichen: Router, leitet weiter",
    "legend.symbol_end_sleepy": "geschlossener Rahmen, Bett: Endgerät, schläft",
    "legend.symbol_coordinator": "Krone C: Koordinator; Stecker unten: am Kabel",
    "legend.symbol_wired": "nur Stecker, keine Bögen: Kabelgerät",
    "legend.state_offline": "offline: ohne Füllung", "legend.state_selected": "ausgewählt: dicker Rahmen",
    "legend.state_pinned": "angepinnt: Nadel", "legend.symbols_title": "Symbole", "legend.states_title": "Zustände",
    "view.reload_info": "ZHA liest die Tabellen selbst, standardmäßig alle 4 Stunden.",
    "details.children_title": "Kinder (End-Devices)",
  };
  for (const [key, text] of Object.entries(words)) {
    assert.equal(STRINGS.de[key], text, key);
    assert.ok(STRINGS.en[key] && STRINGS.en[key] !== key, `en ${key}`);
  }
  assert.equal(STRINGS.en["details.children_title"], "Children (end devices)", "not every end-device child sleeps");
  // The status line lost its count of listed devices and the scan hint (board M1); the long legend paragraphs went.
  for (const gone of ["status.listed", "status.short_listed", "status.scan_hint", "legend.links_default", "legend.rank",
    "legend.debug", "legend.pictures_title", "legend.state_ring"]) {
    assert.ok(!(gone in STRINGS.en) && !(gone in STRINGS.de), gone);
  }
});

test("board texts M1 and M8: fit button, IEEE label and mains power badge (brief a4o)", () => {
  const want = { "zoom.fit": ["Fit", "Einpassen"], "details.ieee": ["IEEE", "IEEE"], "power.mains": ["Mains power", "Netzstrom"],
    "raw.power.mains": ["Mains", "Netzstrom"] };
  for (const [key, [en, de]] of Object.entries(want)) {
    assert.equal(STRINGS.en[key], en, `en ${key}`);
    assert.equal(STRINGS.de[key], de, `de ${key}`);
  }
});

test("the style sheet module loads, with the code font on linked ids and a 20 px device row indent (brief a4o)", async () => {
  const { STYLES } = await import("../custom_components/meshroute_topology_explorer/frontend/ui/styles.js");
  assert.match(STYLES, /\.link\.mono \{ font-family: var\(--ha-font-family-code/);
  assert.match(STYLES, /\.device-row \{[^}]*padding: 10px 0;/);
});
