// SPDX-License-Identifier: MIT
// Attribute values Home Assistant already knows, without radio traffic (spec 9.2 cluster popup; design by Fabian
// Schwamborn, 2026-11-01): where an attribute obviously is an entity's state, its current value comes from the
// `hass.states` object Home Assistant hands every panel (developers.home-assistant.io, "Frontend data": hass.states).
// Obvious means: the device has exactly one entity of the matching domain (and device class); with two lamps on two
// endpoints nothing is shown, since the endpoint of an entity is not known here. Pure functions, no DOM.
// npm test

/** Attribute -> entity. kind: "onoff" (the state on/off), "attribute" (a state attribute, `from`), "state" (a
 *  sensor's numeric state with its unit). Only server attributes: the device holds them for an input cluster. */
export const VALUE_MAP = Object.freeze([
  { cluster: 0x0006, attribute: 0x0000, domains: ["light", "switch"], kind: "onoff" },
  { cluster: 0x0008, attribute: 0x0000, domains: ["light"], kind: "attribute", from: "brightness" },
  { cluster: 0x0300, attribute: 0x0007, domains: ["light"], kind: "attribute", from: "color_temp_kelvin", unit: "K" },
  { cluster: 0x0402, attribute: 0x0000, domains: ["sensor"], classes: ["temperature"], kind: "state" },
  { cluster: 0x0405, attribute: 0x0000, domains: ["sensor"], classes: ["humidity"], kind: "state" },
  { cluster: 0x0400, attribute: 0x0000, domains: ["sensor"], classes: ["illuminance"], kind: "state" },
  { cluster: 0x0406, attribute: 0x0000, domains: ["binary_sensor"], classes: ["occupancy", "motion", "presence"],
    kind: "onoff" },
  { cluster: 0x0001, attribute: 0x0021, domains: ["sensor"], classes: ["battery"], kind: "state" },
  { cluster: 0x0702, attribute: 0x0000, domains: ["sensor"], classes: ["energy"], kind: "state" },
  { cluster: 0x0b04, attribute: 0x050b, domains: ["sensor"], classes: ["power"], kind: "state" },
  { cluster: 0x0b04, attribute: 0x0505, domains: ["sensor"], classes: ["voltage"], kind: "state" },
  { cluster: 0x0b04, attribute: 0x0508, domains: ["sensor"], classes: ["current"], kind: "state" },
]);

/** States that say "no value"; shown as "—", never as a value. */
const NO_VALUE = new Set(["unavailable", "unknown", ""]);

const domainOf = (entityId) => String(entityId).split(".", 1)[0];

/** The value Home Assistant knows for one attribute of an input cluster: { entityId, kind: "onoff" | "number",
 *  value (true/false or a number or text), unit } or null when there is no obvious entity or it has no value.
 *  direction: "in" or "out" (an output cluster's attributes live on the other device); entityIds: the device's
 *  entities; states: hass.states. */
export function knownValue(cluster, attribute, direction, entityIds, states) {
  if (direction !== "in" || !states || typeof states !== "object") return null;
  const rule = VALUE_MAP.find((r) => r.cluster === cluster && r.attribute === attribute);
  if (!rule) return null;
  const candidates = (Array.isArray(entityIds) ? entityIds : []).filter((id) => {
    const s = Object.hasOwn(states, id) ? states[id] : null;
    if (!s || !rule.domains.includes(domainOf(id))) return false;
    const cls = s.attributes && s.attributes.device_class;
    return !rule.classes || rule.classes.includes(cls);
  });
  if (candidates.length !== 1) return null;
  const entityId = candidates[0];
  const s = states[entityId];
  if (NO_VALUE.has(String(s.state))) return null;
  if (rule.kind === "onoff") {
    return s.state === "on" || s.state === "off" ? { entityId, kind: "onoff", value: s.state === "on", unit: null } : null;
  }
  if (rule.kind === "attribute") {
    const v = s.attributes ? s.attributes[rule.from] : null;
    return typeof v === "number" && Number.isFinite(v) ? { entityId, kind: "number", value: v, unit: rule.unit || null, from: rule.from }
      : null;
  }
  const unit = s.attributes && typeof s.attributes.unit_of_measurement === "string" ? s.attributes.unit_of_measurement : null;
  return { entityId, kind: "number", value: s.state, unit };
}

/** A known value as text: "on" / "off" in the user's language, else the number with its unit. */
export function valueText(known, t) {
  if (!known) return null;
  if (known.kind === "onoff") return t(known.value ? "value.on" : "value.off");
  return known.unit ? `${known.value} ${known.unit}` : String(known.value);
}
