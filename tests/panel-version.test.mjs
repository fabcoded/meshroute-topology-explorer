// SPDX-License-Identifier: MIT
// Version check of the panel (spec 10) and the one-time definition of its element.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { versionMismatch } from "../custom_components/meshroute_topology_explorer/frontend/ui/version.js";

test("a different version in the panel config asks for a reload", () => {
  assert.equal(versionMismatch({ config: { version: "0.1.0" } }, "0.1.0"), false);
  assert.equal(versionMismatch({ config: { version: "0.2.0" } }, "0.1.0"), true);
  assert.equal(versionMismatch({ config: {} }, "0.1.0"), true, "a config without version is not the same version");
  assert.equal(versionMismatch({}, "0.1.0"), false, "the dev page has no config");
  assert.equal(versionMismatch(null, "0.1.0"), false);
});

test("panel.js defines its element only if free and does not touch data in the hass setter", () => {
  const src = readFileSync(new URL("../custom_components/meshroute_topology_explorer/frontend/panel.js", import.meta.url), "utf8");
  assert.match(src, /if \(!customElements\.get\(ELEMENT\)\) customElements\.define\(ELEMENT,/);
  const setter = src.slice(src.indexOf("set hass(value)"), src.indexOf("get hass()"));
  assert.doesNotMatch(setter, /reload\(|callWS|_useNetwork/, "a new hass object must not reload data (spec 10)");
});

test("panel.js hides the scan control when the integration's radio_actions option is off (spec 10.1)", () => {
  const src = readFileSync(new URL("../custom_components/meshroute_topology_explorer/frontend/panel.js", import.meta.url), "utf8");
  assert.match(src, /config\.radio_actions === false/);
  assert.match(src, /canScan: Boolean\(this\._network\.capabilities\.scan\) && this\._radioActions\(\)/);
  assert.match(src, /radioActions: this\._radioActions\(\)/);
});
