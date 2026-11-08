// SPDX-License-Identifier: MIT
// #4 (status pill hidden behind the Android navigation bar): Home Assistant pads the custom panel's container with
// --safe-area-inset-*, so the panel's :host must not be sized by the raw viewport, and the phone's full-screen dialog
// (top layer, outside that container) pads its bottom. node --test "tests/**/*.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import { STYLES } from "../custom_components/meshroute_topology_explorer/frontend/ui/styles.js";

const block = (selectorStart) => {
  const at = STYLES.indexOf(selectorStart);
  assert.ok(at >= 0, `${selectorStart} not found`);
  return STYLES.slice(at, STYLES.indexOf("}", at));
};

test("#4: :host height is the viewport minus the system insets, never a bare 100vh/100dvh", () => {
  const heights = [...block(":host {").matchAll(/(?<![-\w])height:\s*([^;]+);/g)].map((m) => m[1]);
  assert.ok(heights.length >= 1);
  for (const value of heights) {
    assert.match(value, /--safe-area-inset-top/, `height: ${value}`);
    assert.match(value, /--safe-area-inset-bottom/, `height: ${value}`);
  }
});

test("#4: the phone history dialog pads the bottom system inset", () => {
  const phone = STYLES.slice(STYLES.indexOf("@media (max-width: 560px)"));
  assert.match(phone, /dialog\.history-dialog\s*\{[^}]*padding-bottom:\s*var\(--safe-area-inset-bottom/);
});
