// SPDX-License-Identifier: MIT
// What a Thread device is, for its picture on the map (spec 3.2, 4.2): the matter/network_topology snapshot carries no
// device signature (Zigbee reads one, engines/zigbee/kinds.js), so the kind comes from the device's Home Assistant
// entities, which the panel already holds (hass.entities, hass.states): no further request. Pure, no DOM.
// npm test

/** Entities by device id, as { domain, deviceClass } with the helpers left out: entities of a category (config,
 *  diagnostic), disabled ones, and the domains number, select, update and button (identify) say nothing about what the
 *  device is. `entities` is hass.entities (an object by entity id, or a list), `states` is hass.states. */
export function entitiesByDevice(entities, states) {
  const byDevice = new Map();
  const list = Array.isArray(entities) ? entities : entities && typeof entities === "object" ? Object.values(entities) : [];
  for (const e of list) {
    if (!e || typeof e.entity_id !== "string" || !e.device_id) continue;
    if (e.entity_category || e.disabled_by) continue;
    const domain = e.entity_id.split(".")[0];
    if (domain === "number" || domain === "select" || domain === "update") continue;
    if (domain === "button" && e.entity_id.endsWith("_identify")) continue;
    const attrs = (states && states[e.entity_id] && states[e.entity_id].attributes) || {};
    if (!byDevice.has(e.device_id)) byDevice.set(e.device_id, []);
    byDevice.get(e.device_id).push({ domain, deviceClass: typeof attrs.device_class === "string" ? attrs.device_class : null });
  }
  return byDevice;
}

/** The kind (graph/symbols.js KINDS) of a device from its entities, or "unknown" (unknown beats wrong). When several
 *  apply the first wins: light, outlet or relay, blind, lock, thermostat, motion, temperature, sensor, button. */
export function threadKind(entities) {
  const list = Array.isArray(entities) ? entities : [];
  const has = (domain) => list.some((e) => e.domain === domain);
  if (has("light")) return "light";
  const sw = list.find((e) => e.domain === "switch");
  if (sw) return sw.deviceClass === "switch" ? "relay" : "outlet";
  if (has("cover")) return "blind";
  if (has("lock")) return "lock";
  if (has("climate")) return "thermostat";
  const binary = list.filter((e) => e.domain === "binary_sensor");
  if (binary.some((e) => ["motion", "occupancy", "presence"].includes(e.deviceClass))) return "motion";
  // Battery is a reading about the device, not what it measures.
  const sensors = list.filter((e) => e.domain === "sensor" && e.deviceClass !== "battery");
  if (!binary.length && sensors.length && sensors.every((e) => e.deviceClass === "temperature" || e.deviceClass === "humidity")) {
    return "temperature";
  }
  if (binary.length || sensors.length) return "sensor";
  if (has("event") || has("button")) return "button";
  return "unknown";
}
