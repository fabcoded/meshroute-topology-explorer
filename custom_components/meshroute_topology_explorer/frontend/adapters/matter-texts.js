// SPDX-License-Identifier: MIT
// The Matter adapter's texts: its name in the network switch, why a Thread network cannot be
// shown (greyed in the switch, and as the panel's message when no network is left) and the reload note. Merged into the panel's table by
// ui/i18n.js through adapters/index.js. Pure data. npm test

export const TEXTS = Object.freeze({
  "source.thread": "Thread (Matter)",
  "source_short.thread": "Thread",
  "status.thread_not_supported": "the Matter server does not offer the topology; update the Matter server",
  "status.thread_error": "the topology could not be read ({message})",
  "status.thread_not_running": "the Matter integration is not running ({message})",
  "status.thread_empty": "the topology lists no Thread device",
  "message.thread_not_supported": "Thread cannot be shown: the Matter server does not offer the topology. Update the Matter server, then try again.",
  "message.thread_empty": "Thread cannot be shown: the topology lists no Thread device.",
  "message.thread_not_running": "Thread cannot be shown: the Matter integration is not running ({message}).",
  "message.thread_error": "Thread cannot be shown: the topology could not be read ({message}).",
  "view.thread_reload_info": "Reloads the topology currently cached by the Matter server. It does not start a radio scan.",
});
