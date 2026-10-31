// SPDX-License-Identifier: MIT
// Version check of the panel (spec 10): the integration hands its version to the panel as panel.config.version; if the
// browser cached an older panel.js the two differ and the panel asks for a page reload. No DOM.
// Tested in Node (tests/panel-version.test.mjs).

/** True when Home Assistant's panel config names a version other than the one of this file. Without a config (the
 *  dev page) there is nothing to compare, so no mismatch. */
export function versionMismatch(panel, version) {
  return Boolean(panel && panel.config && panel.config.version !== version);
}
