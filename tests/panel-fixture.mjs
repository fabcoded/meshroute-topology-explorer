// SPDX-License-Identifier: MIT
// Test helper (not a test file): the sample network and its spec 12 variants built by the data model, for the panel
// tests (panel-*.test.mjs).
import { readFileSync } from "node:fs";
import { buildNetwork } from "../custom_components/meshroute_topology_explorer/frontend/engines/zigbee/model.js";
import { removedTables, withoutTables } from "./derive.mjs";

export const responses = JSON.parse(readFileSync(new URL("./fixtures/zha-sample.json", import.meta.url), "utf8")).responses;

export function sampleNetwork(variant = null) {
  const devices = responses["zha/devices"];
  const raw = variant ? withoutTables(devices, removedTables(devices)[variant]) : devices;
  return buildNetwork(raw, { deviceRegistry: responses["config/device_registry/list"],
    areaRegistry: responses["config/area_registry/list"], configEntries: responses["config_entries/get"] });
}

export const VARIANTS = [null, "minus1", "minus3", "without-coordinator", "coordinator-only"];
