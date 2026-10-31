// SPDX-License-Identifier: MIT
// Colours for the map from Home Assistant's theme (CSS variables of the frontend, with fallbacks), so the canvas
// follows light, dark and custom themes. Each variable is resolved through a hidden probe element: whatever form a
// theme uses (hex, rgb(), a colour name, another variable), the browser hands back rgb(). Runs in the browser.

/** Map theme key -> Home Assistant variable. The canvas sits on the panel background. */
const VARIABLES = {
  background: "--primary-background-color",
  foreground: "--primary-text-color",
  muted: "--secondary-text-color",
  accent: "--primary-color",
};

/** Theme for GraphView (palette.js resolveTheme fills the rest and enforces 3:1). probe: an element inside the panel
 *  that may be styled; host: the panel element (its font). */
export function readTheme(probe, host) {
  const out = {};
  for (const [key, name] of Object.entries(VARIABLES)) {
    probe.style.color = "";
    probe.style.color = `var(${name})`;
    const value = getComputedStyle(probe).color;
    // An unset variable makes the declaration invalid at computed time: the probe then inherits the panel's text
    // colour, which would be wrong for the background. Only accept a value when the variable is really set.
    if (getComputedStyle(host).getPropertyValue(name).trim()) out[key] = value;
  }
  const family = getComputedStyle(host).fontFamily || "sans-serif";
  out.font = `12px ${family}`;
  return out;
}

/** A key that changes when Home Assistant switches theme or dark mode (hass.themes.darkMode is the effective mode,
 *  home-assistant/frontend src/types.ts); the panel re-reads the variables when it changes. */
export function themeKey(hass) {
  const themes = (hass && hass.themes) || {};
  return JSON.stringify([themes.darkMode ?? null, themes.theme ?? null, (hass && hass.selectedTheme) ?? null]);
}
