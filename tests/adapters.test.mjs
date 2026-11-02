// SPDX-License-Identifier: MIT
// The adapter registry (adapters/index.js): one adapter per data source, in menu order, each with
// the same shape; a network finds its adapter by its source and nothing falls back to ZHA; the stored choices of the
// network switch stay "zha" and "thread" (spec 11).
// npm test
import test from "node:test";
import assert from "node:assert/strict";
import { ADAPTERS, adapterByKey, adapterFor } from "../custom_components/meshroute_topology_explorer/frontend/adapters/index.js";
import { NETWORK_KEYS, DEFAULT_NETWORK } from "../custom_components/meshroute_topology_explorer/frontend/ui/network-switch.js";

const SHAPE = ["Observations", "blocking", "devicePage", "key", "read", "reasonText", "reloadInfo", "scan", "texts",
  "unavailable"];

test("every adapter has the same shape, frozen; the keys are the stored network choices", () => {
  assert.deepEqual(ADAPTERS.map((a) => a.key), ["zha", "thread"]);
  assert.deepEqual(NETWORK_KEYS, ["zha", "thread"]);
  assert.equal(DEFAULT_NETWORK, "zha");
  for (const a of ADAPTERS) {
    assert.ok(Object.isFrozen(a), a.key);
    assert.deepEqual(Object.keys(a).sort(), SHAPE, a.key);
    assert.equal(typeof a.read, "function");
    assert.ok(a.texts[a.reloadInfo], `${a.key}: its reload note is one of its own texts`);
  }
  // Only ZHA blocks the panel, has a device page, a scan and observations.
  assert.equal(adapterByKey("zha").blocking, "zha_not_loaded");
  assert.equal(adapterByKey("thread").blocking, null);
  assert.equal(adapterByKey("thread").scan, null);
  assert.equal(adapterByKey("zha").devicePage({ id: "aa:bb:cc:dd:00:00:00:08" }, "clusters").path,
    "/config/zha/device/aa:bb:cc:dd:00:00:00:08/clusters");
});

test("a network finds its adapter by its source; an unknown source throws (no default adapter)", () => {
  assert.equal(adapterFor({ source: "zha" }), adapterByKey("zha"));
  assert.equal(adapterFor({ source: "thread" }), adapterByKey("thread"));
  for (const bad of [null, {}, { source: "z2m" }]) assert.throws(() => adapterFor(bad), /adapter/);
  assert.equal(adapterByKey("z2m"), null);
});

test("the network switch greys a Matter source that could not be used, never ZHA", () => {
  const thread = adapterByKey("thread");
  for (const status of ["not_supported", "empty", "error"]) assert.equal(thread.unavailable({ status }), true, status);
  for (const status of ["not_loaded", "ok", "skipped"]) assert.equal(thread.unavailable({ status }), false, status);
  assert.equal(thread.unavailable(null), false);
  for (const status of ["not_loaded", "empty", "ok"]) assert.equal(adapterByKey("zha").unavailable({ status }), false);
});
