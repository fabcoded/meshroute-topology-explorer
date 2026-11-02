// SPDX-License-Identifier: MIT
// Texts of the panel (spec 10). Decision of the owner (Fabian Schwamborn, 2026-11-01): the panel is English only for
// now; the German table `de` below stays in the file, dormant and no longer maintained, so German can be switched on
// later by adding "de" to ACTIVE_LANGUAGES and translating the keys that were added since. languageOf() therefore
// always answers "en"; translator("de") still renders the dormant table (tests and a later switch-on use it).
// Dates and numbers are not "German texts": they keep following the user's locale (t.formatLocale), independent of
// the text language. Placeholders are {name}; values are inserted as text, never as HTML. No DOM.
// tests/panel-i18n.test.mjs: English is the complete reference; every key of the dormant table must exist in English
// with the same placeholders.
// The tables below are the shared ones; each engine and adapter holds its own words (engines/<type>/texts.js,
// adapters/<source>-texts.js, engines cut step 9), merged here into STRINGS through the two registries.
import { ENGINES } from "../engines/index.js";
import { ADAPTERS } from "../adapters/index.js";

const en = {
  "header.sidebar": "Open sidebar",
  "header.findings_label": "Findings: {count}",
  "density.dense": "Dense",
  "density.medium": "Medium",
  "density.spread": "Spread",
  "zoom.in": "Zoom in",
  "zoom.out": "Zoom out",
  "zoom.fit": "Fit",
  "map.label": "Network map. Arrow keys and Enter work in the device list.",
  "map.incomplete": "Incomplete",
  "map.incomplete_detail": "{x} of {y} router tables: findings name what is missing.",
  "map.connection_lost": "Connection to Home Assistant lost. The map shows the last data and reloads when it is back.",
  "map.loading": "Reading data …",
  "drawer.close": "Close",
  "drawer.expand": "Expand",
  "drawer.collapse": "Collapse",
  "tab.details": "Details",
  "tab.devices": "Devices",
  "tab.findings": "Findings",
  "tab.legend": "Legend",
  "status.label": "Data status",
  "status.source": "Source: {source}",
  "status.unchanged": "unchanged since {time}",
  "message.loading": "Reading the network …",
  "message.not_admin": "This panel needs an administrator account.",
  "message.disconnected": "No connection to Home Assistant. The panel tries again by itself when it is back.",
  "message.error": "Could not read the network: {message}",
  "message.version": "The panel files in your browser are out of date: please reload the page.",
  "message.retry": "Try again",
  "message.reload": "Reload the page",
  "live.selected": "{name} selected: {role}, {reception}.",
  "live.cleared": "Selection cleared.",
  "live.lost": "Connection lost.",
  "live.reloaded": "Data read again.",
  "role.router": "Router",
  "role.unknown": "Unknown role",
  "lqi.uncertain": "0 (uncertain)",
  "lqi.none": "no value",
  "rank.value": "rank {pct} %",
  "rank.weakest": "rank {pct} %, weakest tenth of what {reporter} hears",
  "rank.basis_reporter": "rank among the readings of {reporter}",
  "rank.basis_vendor": "rank within the {vendor} group (fewer than ten readings of {reporter})",
  "rank.weakest_vendor": "rank {pct} %, lowest tenth within the {vendor} group (fewer than ten readings of {reporter})",
  "rank.none": "not rated",
  "reception.value": "reception rank {pct} %",
  "reception.none": "reception not rated",
  "details.empty": "Select a device on the map, in the device list or among the findings.",
  "devices.filter": "Name, model, area, address",
  "devices.count": "{shown} of {total} devices",
  "devices.none": "No device matches.",
  "devices.list": "Devices",
  "devices.unavailable": "unavailable",
  "findings.none": "No findings.",
  "findings.hints": "Hints ({count})",
  "findings.hints_note": "Hints are not counted in the number of findings.",
  "findings.missing_table": "Table of {name} missing ({count})",
  "findings.group": "{kind} ({count})",
  "findings.incomplete_group": "{kind} (missing tables: {tables}, devices: {count})",
  "kind.offline": "Offline",
  "kind.parent offline": "Parent offline",
  "kind.route to offline device": "Route to an offline device",
  "kind.data incomplete": "Data incomplete",
  "kind.weak reception": "Weak reception",
  "kind.very low reading": "Very low reading",
  "kind.parent unknown": "Parent unknown",
  "kind.no parent": "No parent",
  "kind.isolated": "Isolated",
  "kind.many end-device children": "Many end-device children",
  "evidence.offline": "Unavailable in Home Assistant; last seen {time}.",
  "evidence.parent_offline": "Parent {parent} is unavailable (last seen {time}).",
  "legend.fill_none": "Fill: none",
  "legend.fill_role": "Fill: role",
  "legend.fill_power": "Fill: power source",
  "legend.symbols_title": "Symbols",
  "legend.symbol_router": "Frame with gaps and strokes: router, passes packets on",
  "legend.states_title": "States",
  "legend.state_offline": "offline: no fill",
  "legend.state_selected": "selected: thick frame",
  "legend.state_pinned": "pinned: pin",
  "power.mains": "Mains power",
  "power.dc": "DC source",
  "power.none": "Not reported",
  "fill.none": "None",
  "fill.role": "Role",
  "fill.power": "Power source",
  "storage.loading": "Reading the stored settings …",
  "storage.stored": "Saved in Home Assistant for this network, shared by all administrators.",
  "storage.unsupported": "Kept only until this page is closed: the installed integration offers no storage. Update it to keep settings.",
  "storage.unauthorized": "Kept only until this page is closed: saving needs an administrator.",
  "storage.unreadable": "Kept only until this page is closed: the stored settings could not be read ({message}).",
  "storage.offline": "Kept here until the connection is back; then the stored settings are read and your changes saved.",
  "storage.error": "Could not save ({message}). The next change tries again.",
  "storage.too_large": "Too large to save ({kib} KiB, the limit is 256 KiB). Release some pins.",
  "status.unchanged_note": "Observed: a panel notices a change only while one is open, so a table may have changed earlier than shown.",
  "status.scan_running": "scan running: tables changed since the scan started: {changed} of {total} (an unchanged table may also have been answered)",
  "status.scan_stop": "Stop",
  "status.short_unchanged": "unchanged since {time}",
  "status.short_scan_running": "scan: {changed}/{total} tables changed",
  "status.scan_stop_label": "Stop following the scan",
  "live.scan_started": "Scan started. The tables are read again every 15 seconds.",
  "live.scan_over": "The panel no longer follows the scan.",
  "observations.stored": "Observations: kept in Home Assistant for this network ({count} tables).",
  "observations.memory": "Observations: kept only until this page is closed ({reason}).",
  "observations.dropped": "The {count} oldest entries were dropped to stay under 256 KiB.",
  "legend.link.route": "Path to another device",
  "legend.link.discovery": "Computed path: a candidate, not observed traffic.",
  "legend.link.heard": "Heard only",
  "legend.link.implied": "No traffic, no reading: only a route or parent entry proves this direction",
  "legend.link.width": "Width: lowest, middle or top third of what the hearer hears",
  "legend.link.not-listed": "No reception value in this direction: the hearer's table does not list the sender. This alone does not indicate a weak link.",
  "lane.parent": "Parent",
  "lane.route": "Route",
  "legend.link.path-end": "Dashed stem with ?: the path is unknown from here (a table or an entry is missing)",
  "legend.link.reception": "coloured: lower · middle · higher reception rank",
  "lane.rx": "RX:",
  "lane.path_unknown": "path unknown",
  "map.devices": "Devices",
  "map.devices_label": "Open devices, {count} findings",
  "map.details_on_click": "Details on click",
  "map.details_on_click_note": "On: a click on a device opens its details on the left.",
  "map.view": "View",
  "map.view_label": "Open view",
  "map.legend": "Legend",
  "map.legend_label": "Open legend",
  "panel.left_label": "Devices, findings and details",
  "panel.right_label": "View and legend",
  "tab.view": "View",
  "view.paths": "Communication paths",
  "view.path_display": "Path display",
  "view.grey": "Grey",
  "view.coloured": "Coloured by reception",
  "view.bad": "lower",
  "view.medium": "middle",
  "view.good": "higher",
  "view.color_bad_label": "Colour for lower reception rank",
  "view.color_medium_label": "Colour for middle reception rank",
  "view.color_good_label": "Colour for higher reception rank",
  "view.colors_info": "Colour shows the relative reception rank, not connection reliability.",
  "view.colors_info_label": "About colour by reception",
  "view.assumed_info": "The return path is assumed to follow the outbound path in reverse. It has not been verified.",
  "view.assumed_info_label": "About assumed return paths",
  "view.colors_note": "freely choosable, e.g. for colour blindness",
  "view.colors_reset": "Back to the default colours",
  "view.on_click": "On click on a device",
  "view.open_details": "Open details",
  "view.density": "Node distance (density)",
  "view.density_info": "Spacing helps arrange the network. It does not show physical distance.",
  "view.density_info_label": "About node distance",
  "view.fill": "Symbol fill",
  "view.labels": "Labels on the map",
  "view.label_type": "Device type above the symbol",
  "view.label_name": "Readable name below the symbol",
  "view.label_ha": "Original HA name",
  "view.debug": "Debug mode",
  "view.reload": "Read data again",
  "view.release": "Release all pins",
  "view.release_count": "Release all pins ({count})",
  "view.scan": "Scan topology …",
  "view.scan_running": "Scan running …",
  "view.scan_stop": "Stop following the scan",
  "legend.paths_title": "Communication paths",
  "legend.rx": "RX (LQI): reception at the arrowhead. Receiver scales may differ.",
  "devices.search": "Search",
  "devices.hint_on": "A click on a device, here or on the map, opens its details.",
  "devices.hint_off": "Details on click is off: a click selects and zooms; right-click or long-press opens the details.",
  "kind_short.light": "Light",
  "kind_short.outlet": "Plug",
  "kind_short.relay": "Relay",
  "kind_short.button": "Button",
  "kind_short.sensor": "Sensor",
  "kind_short.motion": "Motion sensor",
  "kind_short.temperature": "Temperature",
  "kind_short.thermostat": "Thermostat",
  "kind_short.blind": "Blind",
  "kind_short.lock": "Lock",
  "kind_short.hub": "Hub",
  "details.tab_entity": "Entity",
  "devices.network": "Network",
  "devices.sleeps": "sleeps",
  "devices.via": "via {name}",
  "view.source_route": "Return paths without a table entry (source route)",
  "view.sr_off": "Off: the return path stays “unknown”",
  "view.sr_assume": "Assume: the way up reversed (dotted)",
  "view.sr_experimental": "experimental",
  "view.paths_table": "routing table",
  "view.paths_table_hint": "Each router's table names the next hop to a destination. This view follows those entries until the destination or a gap.",
  "view.paths_returns": "include return routes",
  "view.paths_returns_hint": "Follow each destination's route back, using the routing table at every hop.",
  "view.paths_all_hint": "without a selection every lane any path uses (computed lighter); on click the device's trees there and back",
  "view.paths_heard": "additional heard neighbours (best 3)",
  "view.paths_heard_hint": "needs a selection: adds the device's 3 best partners with a reading and no drawn lane",
  "view.paths_note": "Each view has its own basis. Debug shows everything.",
  "view.reload_info_label": "About reading the data",
  "legend.link.assumed": "Return path assumed (source route): assumed to follow the outbound path in reverse; not verified.",
  "legend.option_heard": "(option under \"Routing table\", needs a selection)",
  "legend.stage": "(view {n})",
  "legend.stages": "(views {a} and {b})",
  "legend.stage_computed": "(computed, view {n})",
  "legend.symbol_wired": "Plug only, no arcs: wired device",
  "status.network_menu": "Network: {source}. Choose another network",
  "status.network_unavailable": "{source} is not available: {reason}",
  "status.age_minutes": "{n} min ago",
  "status.age_hours": "{n} h ago",
  "status.age_now": "just now",
};

const de = {
  "header.sidebar": "Seitenleiste öffnen",
  "header.findings_label": "Befunde: {count}",
  "density.dense": "dicht",
  "density.medium": "mittel",
  "density.spread": "weit",
  "zoom.in": "Vergrößern",
  "zoom.out": "Verkleinern",
  "zoom.fit": "Einpassen",
  "map.label": "Netzkarte. Pfeiltasten und Enter funktionieren in der Geräteliste.",
  "map.incomplete": "Unvollständig",
  "map.incomplete_detail": "{x} von {y} Router-Tabellen: Befunde nennen, was fehlt.",
  "map.connection_lost": "Verbindung zu Home Assistant verloren. Die Karte zeigt die letzten Daten und lädt neu, sobald sie zurück ist.",
  "map.loading": "Daten werden gelesen …",
  "drawer.close": "Schließen",
  "drawer.expand": "Aufklappen",
  "drawer.collapse": "Zuklappen",
  "tab.details": "Details",
  "tab.devices": "Geräte",
  "tab.findings": "Befunde",
  "tab.legend": "Legende",
  "status.label": "Datenstand",
  "status.source": "Quelle: {source}",
  "status.unchanged": "unverändert seit {time}",
  "message.loading": "Netz wird gelesen …",
  "message.not_admin": "Dieses Panel braucht ein Administratorkonto.",
  "message.disconnected": "Keine Verbindung zu Home Assistant. Das Panel versucht es selbst erneut, sobald sie zurück ist.",
  "message.error": "Das Netz konnte nicht gelesen werden: {message}",
  "message.version": "Die Panel-Dateien im Browser sind veraltet: bitte die Seite neu laden.",
  "message.retry": "Erneut versuchen",
  "message.reload": "Seite neu laden",
  "live.selected": "{name} ausgewählt: {role}, {reception}.",
  "live.cleared": "Auswahl aufgehoben.",
  "live.lost": "Verbindung verloren.",
  "live.reloaded": "Daten neu gelesen.",
  "role.router": "Router",
  "role.unknown": "Rolle unbekannt",
  "lqi.uncertain": "0 (unsicher)",
  "lqi.none": "kein Wert",
  "rank.value": "Rang {pct} %",
  "rank.weakest": "Rang {pct} %, schwächstes Zehntel dessen, was {reporter} hört",
  "rank.none": "nicht bewertet",
  "reception.value": "Empfangsrang {pct} %",
  "reception.none": "Empfang nicht bewertet",
  "details.empty": "Wähle ein Gerät auf der Karte, in der Geräteliste oder bei den Befunden.",
  "devices.filter": "Name, Modell, Bereich, Adresse",
  "devices.count": "{shown} von {total} Geräten",
  "devices.none": "Kein Gerät passt.",
  "devices.list": "Geräte",
  "devices.unavailable": "nicht verfügbar",
  "findings.none": "Keine Befunde.",
  "findings.hints": "Hinweise ({count})",
  "findings.hints_note": "Hinweise zählen nicht zur Befundzahl.",
  "findings.missing_table": "Tabelle von {name} fehlt ({count})",
  "findings.group": "{kind} ({count})",
  "findings.incomplete_group": "{kind} (fehlende Tabellen: {tables}, Geräte: {count})",
  "kind.offline": "Offline",
  "kind.parent offline": "Parent offline",
  "kind.route to offline device": "Route zu einem Offline-Gerät",
  "kind.data incomplete": "Daten unvollständig",
  "kind.weak reception": "Schwacher Empfang",
  "kind.very low reading": "Sehr niedriger Messwert",
  "kind.parent unknown": "Parent unbekannt",
  "kind.no parent": "Kein Parent",
  "kind.isolated": "Isoliert",
  "kind.many end-device children": "Viele End-Device-Kinder",
  "evidence.offline": "In Home Assistant nicht verfügbar; zuletzt gesehen {time}.",
  "evidence.parent_offline": "Parent {parent} ist nicht verfügbar (zuletzt gesehen {time}).",
  "legend.fill_none": "Füllung: keine",
  "legend.fill_role": "Füllung: Rolle",
  "legend.fill_power": "Füllung: Stromquelle",
  "legend.symbols_title": "Symbole",
  "legend.symbol_router": "Rahmen mit Lücken und Strichen: Router, leitet weiter",
  "legend.states_title": "Zustände",
  "legend.state_offline": "offline: ohne Füllung",
  "legend.state_selected": "ausgewählt: dicker Rahmen",
  "legend.state_pinned": "angepinnt: Nadel",
  "power.mains": "Netzstrom",
  "power.dc": "Gleichstrom",
  "power.none": "Nicht gemeldet",
  "fill.none": "keine",
  "fill.role": "Rolle",
  "fill.power": "Stromquelle",
  "storage.loading": "Gespeicherte Einstellungen werden gelesen …",
  "storage.stored": "In Home Assistant für dieses Netz gespeichert, gemeinsam für alle Administratoren.",
  "storage.unsupported": "Nur bis diese Seite geschlossen wird: die installierte Integration bietet keinen Speicher. Aktualisiere sie, um Einstellungen zu behalten.",
  "storage.unauthorized": "Nur bis diese Seite geschlossen wird: Speichern braucht einen Administrator.",
  "storage.unreadable": "Nur bis diese Seite geschlossen wird: die gespeicherten Einstellungen ließen sich nicht lesen ({message}).",
  "storage.offline": "Hier gehalten, bis die Verbindung zurück ist; dann werden die gespeicherten Einstellungen gelesen und deine Änderungen gespeichert.",
  "storage.error": "Speichern fehlgeschlagen ({message}). Die nächste Änderung versucht es erneut.",
  "storage.too_large": "Zu groß zum Speichern ({kib} KiB, Grenze 256 KiB). Löse einige Pins.",
  "status.unchanged_note": "Beobachtet: ein Panel bemerkt eine Änderung nur, solange eines offen ist; eine Tabelle kann sich also früher geändert haben als angezeigt.",
  "status.scan_running": "Scan läuft: seit Scanbeginn geänderte Tabellen: {changed} von {total} (auch eine unveränderte Tabelle kann geantwortet haben)",
  "status.scan_stop": "Stopp",
  "status.short_unchanged": "unverändert seit {time}",
  "status.short_scan_running": "Scan: {changed}/{total} Tabellen geändert",
  "status.scan_stop_label": "Scan nicht mehr verfolgen",
  "live.scan_started": "Scan gestartet. Die Tabellen werden alle 15 Sekunden neu gelesen.",
  "live.scan_over": "Das Panel verfolgt den Scan nicht mehr.",
  "observations.stored": "Beobachtungen: in Home Assistant für dieses Netz gespeichert ({count} Tabellen).",
  "observations.memory": "Beobachtungen: nur bis diese Seite geschlossen wird ({reason}).",
  "observations.dropped": "Die {count} ältesten Einträge wurden verworfen, um unter 256 KiB zu bleiben.",
  "legend.link.route": "Weg zu einem anderen Gerät",
  "legend.link.discovery": "einer der günstigsten Wege nach den LQI der Tabellen",
  "legend.link.heard": "nur gehört",
  "legend.link.implied": "kein Verkehr, kein Messwert: nur ein Routing- oder Parent-Eintrag belegt diese Richtung",
  "legend.link.width": "Breite: unteres, mittleres oder oberes Drittel dessen, was das hörende Gerät hört",
  "legend.link.not-listed": "Die Tabelle des hörenden Geräts führt den Sender nicht",
  "lane.parent": "Parent",
  "lane.route": "Route",
  "legend.link.path-end": "Gestrichelter Stummel mit ?: ab hier ist der Weg unbekannt (eine Tabelle oder ein Eintrag fehlt)",
  "legend.link.reception": "farbig: schlecht · mittel · gut",
  "lane.rx": "RX:",
  "lane.path_unknown": "Weg unbekannt",
  "map.devices": "Geräte",
  "map.devices_label": "Geräte öffnen, {count} Befunde",
  "map.details_on_click": "Details bei Klick",
  "map.details_on_click_note": "An: ein Klick auf ein Gerät öffnet links seine Details.",
  "map.view": "Ansicht",
  "map.view_label": "Ansicht öffnen",
  "map.legend": "Legende",
  "map.legend_label": "Legende öffnen",
  "panel.left_label": "Geräte, Befunde und Details",
  "panel.right_label": "Ansicht und Legende",
  "tab.view": "Ansicht",
  "view.paths": "Kommunikationspfade",
  "view.path_display": "Pfaddarstellung",
  "view.grey": "grau",
  "view.coloured": "farbig nach Empfang",
  "view.bad": "schlecht",
  "view.medium": "mittel",
  "view.good": "gut",
  "view.color_bad_label": "Farbe für schlechten Empfang",
  "view.color_medium_label": "Farbe für mittleren Empfang",
  "view.color_good_label": "Farbe für guten Empfang",
  "view.colors_note": "frei wählbar, z. B. für Farbenblinde",
  "view.colors_reset": "Zurück zu den Standardfarben",
  "view.on_click": "Bei Klick auf ein Gerät",
  "view.open_details": "Details öffnen",
  "view.density": "Knotenentfernung (Dichte)",
  "view.density_info": "Die Entfernung zwischen den Geräten ist aus Feldstärke und Empfangsqualität abgeleitet; die Dichte vervielfacht sie.",
  "view.density_info_label": "Info zur Knotenentfernung",
  "view.fill": "Füllung der Symbole",
  "view.labels": "Beschriftung auf der Karte",
  "view.label_type": "Gerätetyp über dem Symbol",
  "view.label_name": "lesbarer Name unter dem Symbol",
  "view.label_ha": "Original-HA-Bezeichnung",
  "view.debug": "Debug-Modus",
  "view.reload": "Daten neu lesen",
  "view.release": "Alle Pins lösen",
  "view.release_count": "Alle Pins lösen ({count})",
  "view.scan": "Topologie scannen …",
  "view.scan_running": "Scan läuft …",
  "view.scan_stop": "Scan nicht mehr verfolgen",
  "legend.paths_title": "Kommunikationspfade",
  "legend.rx": "Empfang beim Empfänger, ein Viertel vor ihm",
  "devices.search": "Suchen",
  "devices.hint_on": "Klick auf ein Gerät, hier oder auf der Karte, öffnet seine Details.",
  "devices.hint_off": "Details bei Klick ist aus: ein Klick wählt aus und zoomt; Rechtsklick oder langes Drücken öffnet die Details.",
  "kind_short.light": "Lampe",
  "kind_short.outlet": "Steckdose",
  "kind_short.relay": "Relais",
  "kind_short.button": "Taster",
  "kind_short.sensor": "Sensor",
  "kind_short.motion": "Bewegungsmelder",
  "kind_short.temperature": "Temperatur",
  "kind_short.thermostat": "Thermostat",
  "kind_short.blind": "Rollo",
  "kind_short.lock": "Schloss",
  "kind_short.hub": "Hub",
  "details.tab_entity": "Entität",
  "devices.network": "Netzwerk",
  "devices.sleeps": "schläft",
  "devices.via": "über {name}",
  "view.source_route": "Rückwege ohne Tabelleneintrag (Source Route)",
  "view.sr_off": "aus: Rückweg bleibt „unbekannt“",
  "view.sr_assume": "annehmen: Umkehr des Hinwegs (gepunktet)",
  "view.sr_experimental": "experimentell",
  "view.paths_all_hint": "ohne Auswahl alle Spuren, die irgendein Weg nutzt (berechnete heller); bei Klick der Baum des Geräts hin und zurück",
  "view.paths_heard": "zusätzlich gehörte Nachbarn (beste 3)",
  "view.paths_heard_hint": "braucht eine Auswahl: fügt die 3 besten Partner mit Messwert und ohne gezeichnete Spur hinzu",
  "view.paths_note": "Jede Ansicht hat ihre eigene Grundlage. Debug zeigt alles.",
  "view.reload_info_label": "Info zum Neulesen der Daten",
  "legend.link.assumed": "Rückweg angenommen (Source Route)",
  "legend.option_heard": "(Option unter \"Routing table\", braucht eine Auswahl)",
  "legend.stage": "(Ansicht {n})",
  "legend.stages": "(Ansichten {a} und {b})",
  "legend.stage_computed": "(berechnet, Ansicht {n})",
  "legend.symbol_wired": "nur Stecker, keine Bögen: Kabelgerät",
};

/** The shared tables alone, { en, de }. */
export const SHARED = Object.freeze({ en: Object.freeze(en), de: Object.freeze(de) });

/** One { en, de } from several: shared first, then each part's; a key two parts share must have the same text in both
 *  (two engines naming the same role), anything else is an error. */
export function mergeTexts(parts) {
  const out = { en: {}, de: {} };
  for (const part of parts) {
    for (const lang of ["en", "de"]) {
      for (const [key, text] of Object.entries(part[lang] || {})) {
        if (key in out[lang] && out[lang][key] !== text) throw new Error(`text ${lang}:${key} differs between tables`);
        out[lang][key] = text;
      }
    }
  }
  return Object.freeze({ en: Object.freeze(out.en), de: Object.freeze(out.de) });
}

/** Every text of the panel: the shared tables, every engine's and every adapter's. */
export const STRINGS = mergeTexts([SHARED, ...Object.values(ENGINES).map((e) => e.texts),
  ...ADAPTERS.map((a) => a.texts)]);

/** Languages the panel selects from the user's locale. "de" is dormant (owner decision 2026-11-01). */
export const ACTIVE_LANGUAGES = Object.freeze(["en"]);

function primaryTag(hass) {
  const tag = (hass && ((hass.locale && hass.locale.language) || hass.language)) || "en";
  return String(tag).toLowerCase().split(/[-_]/)[0];
}

/** The panel's text language: the user's locale (hass.locale.language, else hass.language) reduced to its primary
 *  subtag, if that language is active; English otherwise, which today means always. */
export function languageOf(hass) {
  const primary = primaryTag(hass);
  return ACTIVE_LANGUAGES.includes(primary) ? primary : "en";
}

/** The locale for dates and numbers: the user's primary language subtag if the browser's Intl knows it, else English.
 *  Independent of the text language (owner decision 2026-11-01: English texts, local number and date format). */
export function formatLocaleOf(hass) {
  const primary = primaryTag(hass);
  try {
    return Intl.NumberFormat.supportedLocalesOf([primary]).length ? primary : "en";
  } catch {
    return "en";
  }
}

/** t(key, params) for a language, with English and finally the key itself as fallbacks. Also: t.lang, t.formatLocale, t.number(n),
 *  t.list(items), t.time(text). strings: the tables, all of the panel's by default (tests pass fewer: mergeTexts). */
export function translator(lang, formatLocale = null, strings = STRINGS) {
  const english = strings.en;
  const table = strings[lang] || english;
  const t = (key, params = {}) => {
    const text = table[key] ?? english[key] ?? key;
    return text.replace(/\{(\w+)\}/g, (m, name) => (name in params ? String(params[name]) : m));
  };
  t.lang = lang in strings ? lang : "en";
  t.formatLocale = formatLocale || t.lang;
  t.has = (key) => key in table || key in english;
  /** A time the panel recorded (ISO, UTC) in the browser's local time: "14:32" today, with the date otherwise. */
  t.when = (iso, now = new Date()) => {
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return "?";
    const sameDay = d.toDateString() === now.toDateString();
    const options = sameDay ? { hour: "2-digit", minute: "2-digit" }
      : { year: d.getFullYear() === now.getFullYear() ? undefined : "numeric", month: "numeric", day: "numeric",
        hour: "2-digit", minute: "2-digit" };
    return new Intl.DateTimeFormat(t.formatLocale, options).format(d);
  };
  const numbers = new Intl.NumberFormat(t.formatLocale);
  t.number = (n) => (typeof n === "number" && Number.isFinite(n) ? numbers.format(n) : "?");
  t.list = (items) => items.join(", ");
  /** ZHA's last_seen is local time without a zone ("2026-01-01T11:30:28"): shown as text, minutes only, never
   *  converted (spec 5.5: for routers it is text only). */
  t.time = (text) => {
    if (typeof text !== "string" || !text) return "?";
    const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(text);
    return m ? `${m[1]} ${m[2]}` : text;
  };
  return t;
}

/** The network with the model's own labels translated: a label whose labelKind has a text "label.<labelKind>" is the
 *  model's own word (Zigbee: the coordinator, labelKind "coordinator") and takes that text; every other label is the
 *  user's or the device's own text and stays as it is. areas:
 *  Home Assistant's hass.areas (id -> { name }), where present: its names win over the registry's, so the area shown
 *  is the one the frontend shows. */
export function localize(network, t, areas = null) {
  const areaName = (d) => {
    const a = areas && d.areaId && Object.hasOwn(areas, d.areaId) ? areas[d.areaId] : null;
    return a && typeof a.name === "string" && a.name.trim() ? a.name.trim() : d.area;
  };
  return { ...network, devices: network.devices.map((d) => {
    const area = areaName(d);
    const key = `label.${d.labelKind}`;
    const own = typeof d.labelKind === "string" && t.has(key);
    if (!own && area === d.area) return d;
    return { ...d, area, ...(own ? { label: t(key) } : {}) };
  }) };
}
