// SPDX-License-Identifier: MIT
// Texts of the panel (spec 10): one English table, placeholders, locale-bound dates and numbers, the coordinator label.
// npm test
import test from "node:test";
import assert from "node:assert/strict";
import { STRINGS, formatLocaleOf, translator, localize } from "../custom_components/meshroute_topology_explorer/frontend/ui/i18n.js";
import { sampleNetwork } from "./panel-fixture.mjs";

test("every text is non-empty", () => {
  for (const [key, text] of Object.entries(STRINGS)) assert.ok(text.trim(), `${key} is not empty`);
});

test("dates and numbers follow the user's locale; the texts stay English", () => {
  assert.equal(formatLocaleOf({ locale: { language: "de" } }), "de");
  assert.equal(formatLocaleOf({ language: "de-CH" }), "de");
  assert.equal(formatLocaleOf(null), "en");
  const t = translator("de");
  assert.equal(t("zoom.fit"), "Fit");
  assert.equal(t.number(1234), "1.234");
  assert.equal(translator("en").number(1234), "1,234");
});

test("translation helpers: placeholders, missing keys, time text", () => {
  const t = translator("en");
  assert.equal(t("status.tables", { x: 3, y: 4 }), "Router tables: 3/4");
  assert.equal(t("status.tables", { x: 3 }), "Router tables: 3/{y}", "a missing value keeps its placeholder");
  assert.equal(t("no.such.key"), "no.such.key");
  assert.equal(t.time("2026-01-01T11:30:28"), "2026-01-01 11:30", "ZHA's local time is shown as text, minutes only");
  assert.equal(t.time(null), "?");
});

test("the model's coordinator label is translated, user labels stay", () => {
  const network = sampleNetwork();
  const out = localize(network, translator("en"), null);
  assert.equal(out.devices.find((d) => d.labelKind === "coordinator").label, "Coordinator");
  assert.equal(network.devices.find((d) => d.labelKind === "coordinator").label, "Coordinator", "the model is not changed");
  const others = out.devices.filter((d) => d.labelKind !== "coordinator");
  assert.ok(others.every((d) => d === network.devices.find((x) => x.id === d.id)), "other devices are the same objects");
});

test("area names from Home Assistant's hass.areas win over the registry's", () => {
  const network = sampleNetwork();
  const t = translator("en");
  const device = network.devices.find((d) => d.areaId);
  const area = (areas) => localize(network, t, areas).devices.find((d) => d.id === device.id).area;
  assert.equal(area({ [device.areaId]: { name: "Wohnzimmer" } }), "Wohnzimmer");
  assert.equal(area(null), device.area, "without: the registry");
  assert.equal(area({ [device.areaId]: { name: " " } }), device.area, "an empty name does not win");
});

test("the style sheet module loads, with the code font on linked ids and a 20 px device row indent", async () => {
  const { STYLES } = await import("../custom_components/meshroute_topology_explorer/frontend/ui/styles.js");
  assert.match(STYLES, /\.link\.mono \{ font-family: var\(--ha-font-family-code/);
  assert.match(STYLES, /\.device-row \{[^}]*padding: 10px 0;/);
});
