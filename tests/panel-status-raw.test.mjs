// SPDX-License-Identifier: MIT
// The status line's words for observations and the scan (spec 6, 9.4), local times, and ZHA's raw value texts in
// English with the raw text kept in debug mode. node --test "tests/**/*.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import { statusParts } from "../custom_components/meshroute_topology_explorer/frontend/engines/zigbee/status.js";
import { translator } from "../custom_components/meshroute_topology_explorer/frontend/ui/i18n.js";
import { rawKey, rawText, RAW_COLUMNS } from "../custom_components/meshroute_topology_explorer/frontend/engines/zigbee/ui/raw-values.js";
import { responses, sampleNetwork } from "./panel-fixture.mjs";

test("status line (board M1): source, router tables, observed unchanged since, then the scan", () => {
  const network = sampleNetwork();
  const scan = { status: "running", changed: 11, total: 29 };
  const parts = statusParts(network, { unchangedSince: "14:32", scan });
  assert.deepEqual(parts.map(([key]) => key), ["status.source", "status.tables", "status.unchanged",
    "status.scan_running"]);
  const en = translator("en");
  const text = (t) => parts.map(([key, params]) => t(key, params)).join(" · ");
  assert.match(text(en), /unchanged since 14:32/);
  assert.match(text(en), /scan running: tables changed since the scan started: 11 of 29 \(an unchanged table may also have been answered\)/);
  for (const status of ["ended", "stopped", "not-sent"]) {
    const [key, params] = statusParts(network, { scan: { status, changed: 3, total: 29, message: "Connection lost" } })[2];
    assert.ok(key.startsWith("status.scan_"), status);
    assert.ok(!/finished/i.test(en(key, params)), "never claims the scan finished");
  }
  assert.equal(statusParts(network, { scan: { status: "idle" } }).length, 2, "an idle scan adds nothing");
  assert.ok(en("status.unchanged_note").includes("only while one is open"));
});

test("times the panel recorded are shown in local time, with the date when not today", () => {
  const en = translator("en");
  const now = new Date(2026, 9, 31, 15, 0);
  const today = new Date(2026, 9, 31, 14, 32).toISOString();
  const earlier = new Date(2026, 9, 29, 9, 5).toISOString();
  assert.match(en.when(today, now), /^0?2:32\s?PM$|^14:32$/);
  assert.match(en.when(earlier, now), /10\/29/);
  assert.match(translator("de").when(earlier, now), /29\.10\./, "dates follow the user's locale");
  assert.equal(en.when("garbage", now), "?");
});

test("ZHA's raw values in words, with the raw text in debug mode and as a fallback", () => {
  assert.equal(rawKey("NoneOfTheAbove"), "none_of_the_above");
  assert.equal(rawKey("Battery or Unknown"), "battery_or_unknown");
  assert.equal(rawKey("Mains (single phase)"), "mains_single_phase");
  assert.equal(rawKey("Discovery_Underway"), "discovery_underway");
  assert.equal(rawKey("EndDevice"), "end_device");
  assert.equal(rawKey(true), "true");
  const en = translator("en");
  assert.equal(rawText("power", "Battery or Unknown", en), "Battery or unknown");
  assert.equal(rawText("power", "Battery or Unknown", en, { debug: true }), "Battery or unknown (Battery or Unknown)");
  assert.equal(rawText("relationship", "NoneOfTheAbove", en), "None of these");
  assert.equal(rawText("available", false, en), "Unavailable");
  assert.equal(rawText("power", "Nuclear", en), "Nuclear", "unknown values stay as ZHA sent them");
  assert.equal(rawText("power", "Nuclear", en, { debug: true }), "Nuclear");
  assert.equal(rawText("power", null, en), "");
});

test("every raw value of the sample has words", () => {
  const values = new Map(); // kind -> Set of raw values
  const add = (kind, v) => { if (!values.has(kind)) values.set(kind, new Set()); values.get(kind).add(v); };
  for (const d of responses["zha/devices"]) {
    add("power", d.power_source);
    add("available", d.available);
    for (const n of d.neighbors) for (const [col, v] of Object.entries(n)) if (RAW_COLUMNS[col]) add(RAW_COLUMNS[col], v);
    for (const r of d.routes) for (const [col, v] of Object.entries(r)) if (RAW_COLUMNS[col]) add(RAW_COLUMNS[col], v);
  }
  const t = translator("en");
  for (const [kind, set] of values) {
    for (const v of set) assert.ok(t.has(`raw.${kind}.${rawKey(v)}`), `${kind} ${v}`);
  }
  assert.ok(values.get("relationship").has("Sibling") && values.get("permit_joining").has("NotAccepting"));
});

test("narrow screens get the short status line: no source, long forms as descriptions", () => {
  const network = sampleNetwork();
  const en = translator("en");
  const idle = statusParts(network, { unchangedSince: "18:20", compact: true });
  assert.deepEqual(idle.map(([key]) => key),
    ["status.short_tables", "status.short_unchanged"]);
  assert.ok(idle.every(([, , long]) => long && en.has(long)), "every short part names its long form");
  const line = (t, parts) => parts.map(([key, params]) => t(key, params)).join(" · ");
  assert.equal(line(en, idle), "Router tables 29/29 · unchanged since 18:20");
  const running = statusParts(network, { unchangedSince: "18:20", compact: true, scan: { status: "running", changed: 5, total: 29 } });
  assert.equal(running.at(-1)[0], "status.short_scan_running");
  assert.equal(running.at(-1)[2], "status.scan_running", "the long form with the note stays as the description");
  assert.equal(en(running.at(-1)[0], running.at(-1)[1]), "scan: 5/29 tables changed");
  for (const status of ["ended", "stopped"]) {
    const [key, params] = statusParts(network, { compact: true, scan: { status, changed: 12, total: 29 } }).at(-1);
    assert.equal(en(key, params), "last scan: 12/29 tables changed", "never claims the scan finished");
  }
  // Short enough for two lines on a 390 px phone (366 px of text at about 6.5 px per character, 12 px font).
  const text = `${line(en, running)} · ${en("status.scan_stop")}`;
  assert.ok(text.length <= 2 * 366 / 6.5, `${text.length} characters`);
  assert.ok(!line(en, running).includes("4 hours"), "the 4-hour hint stays on wide screens");
});
