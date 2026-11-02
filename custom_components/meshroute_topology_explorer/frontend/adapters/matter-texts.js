// SPDX-License-Identifier: MIT
// The Matter adapter's texts: its name in the network switch, why a Thread network cannot be
// shown and the reload note. Merged into the panel's table by
// ui/i18n.js through adapters/index.js. Pure data. npm test

export const TEXTS = Object.freeze({
  "source.thread": "Thread (Matter)",
  "status.thread_not_supported": "Home Assistant 2026.9 or newer is required",
  "status.thread_error": "the topology could not be read ({message})",
  "status.thread_empty": "the topology lists no Thread device",
  "view.thread_reload_info": "Reloads the topology currently cached by the Matter server. It does not start a radio scan.",
});
