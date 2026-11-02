// SPDX-License-Identifier: MIT
// The Matter adapter's texts (engines cut step 9): its name in the network switch and why a Thread network
// cannot be shown. English is the reference; the dormant German table moves along. Merged into the panel's tables by
// ui/i18n.js through adapters/index.js. Pure data. npm test

const en = {
  "source.thread": "Thread (Matter)",
  "status.thread_not_supported": "Home Assistant 2026.9 or newer is required",
  "status.thread_error": "the topology could not be read ({message})",
  "status.thread_empty": "the topology lists no Thread device",
};

const de = {

};

/** { en, de }: the tables, frozen. */
export const TEXTS = Object.freeze({ en: Object.freeze(en), de: Object.freeze(de) });
