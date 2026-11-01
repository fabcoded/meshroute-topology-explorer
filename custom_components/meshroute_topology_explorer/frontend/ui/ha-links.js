// SPDX-License-Identifier: MIT
// Ways into Home Assistant's own pages for one device (spec 9.2 "Entity"; design by Fabian Schwamborn, 2026-11-01).
// Paths follow Home Assistant's public frontend routes (home-assistant/frontend, read for the route contracts only):
// - device page: src/panels/config/devices/ha-config-devices.ts, route "device" reads the registry id from the path;
// - ZHA's own device page: src/panels/config/integrations/integration-panels/zha/zha-config-dashboard-router.ts,
//   route "device" with the IEEE as first path segment, and zha-device-page.ts with the tabs "clusters" (manage:
//   attributes, commands), "bindings", "signature" (Zigbee info) and, for routers, "neighbors"; the device page's own
//   ZHA actions link to /config/zha/device/<ieee>/clusters (src/panels/config/devices/device-detail/integration-
//   elements/zha/device-actions.ts);
// - area page: src/panels/config/areas/ha-config-areas.ts, route "area" with the area id;
// - logbook and history: src/common/url/history-logbook-query-params.ts, list parameter entity_id joined by commas
//   (src/common/url/query-params.ts);
// - entity list: src/common/url/entities-query-params.ts, parameter "device" filters by device registry id;
// - more-info dialog: the bubbling, composed event "hass-more-info" with detail { entityId }
//   (src/state/more-info-mixin.ts).
// Pure path builders plus two small browser helpers. node --test tests/

/** Home Assistant's device page. */
export const devicePagePath = (registryId) => `/config/devices/device/${encodeURIComponent(registryId)}`;

/** ZHA's own page of a device, on one of its tabs ("signature" is the Zigbee info, "clusters" the management). The
 *  IEEE goes in with its colons, as the frontend writes it: the page reads the path segment as it is, so an encoded
 *  colon would name no device. The model's ids are validated EUI-64s (model/parse.js), nothing else reaches here. */
export const zhaDevicePath = (ieee, tab = "signature") => `/config/zha/device/${ieee}/${tab}`;

export const areaPath = (areaId) => `/config/areas/area/${encodeURIComponent(areaId)}`;

const withEntities = (base, entityIds) => `${base}?${new URLSearchParams({ entity_id: entityIds.join(",") })}`;
/** The logbook and the history, filtered to the device's entities. */
export const logbookPath = (entityIds) => withEntities("/logbook", entityIds);
export const historyPath = (entityIds) => withEntities("/history", entityIds);

/** The entity list, filtered to the device. */
export const entitiesPath = (registryId) => `/config/entities?${new URLSearchParams({ device: registryId })}`;

/** The links of the Entity tab for a device: [{ key, path }] in the board's order; a link whose target is unknown
 *  (no registry entry, no area, no entities) is left out. capabilities: the network's (spec 4.6); `devicePage` says
 *  the source has its own device page (ZHA's). */
export function deviceLinks(device, capabilities) {
  const ids = Array.isArray(device.entities) ? device.entities : [];
  const out = [];
  if (device.registryId) out.push({ key: "device", path: devicePagePath(device.registryId) });
  if (capabilities && capabilities.devicePage) out.push({ key: "zha", path: zhaDevicePath(device.id, "signature") });
  if (device.areaId) out.push({ key: "area", path: areaPath(device.areaId) });
  if (ids.length) out.push({ key: "logbook", path: logbookPath(ids) }, { key: "history", path: historyPath(ids) });
  if (device.registryId) out.push({ key: "entities", path: entitiesPath(device.registryId) });
  return out;
}

/** In-app navigation as Home Assistant's frontend does it (src/common/navigate.ts): push the path onto the history,
 *  then fire "location-changed" on the window; the app's router listens for it. A plain link would reload the whole
 *  frontend. */
export function navigate(path) {
  history.pushState(null, "", path);
  window.dispatchEvent(new CustomEvent("location-changed", { detail: { replace: false } }));
}

/** Click handler for an <a href> that stays in the app on ordinary clicks; modified clicks (new tab, new window) keep
 *  the browser's behaviour. */
export function inApp(path) {
  return (e) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(path);
  };
}

/** Open Home Assistant's more-info dialog of an entity from inside the panel's shadow root. */
export function moreInfo(from, entityId) {
  from.dispatchEvent(new CustomEvent("hass-more-info", { bubbles: true, composed: true, detail: { entityId } }));
}
