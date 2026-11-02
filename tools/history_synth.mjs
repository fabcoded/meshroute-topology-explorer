// SPDX-License-Identifier: MIT
// Reception-history records from captures, for tests and the dev page (spec 10.2). Mirrors the recorder's reading of
// `zha/devices` (sources.py parse_zha) and writes the answer format of `history/records` ({ k, records }); between two
// captures it adds deterministic synthetic records (LQI drifting from one capture to the other with a small jitter,
// the routing tables switching over at a per-holder moment, a few entries missing now and then), so a long range has
// something to show. Real captures go in, the output goes to captures/ (git-ignored): never commit it.
// Usage:
//   node tools/history_synth.mjs --from captures/zha-A.json --to captures/zha-B.json --out captures/history-zha.json
//        [--start 1761868800] [--days 3] [--step-hours 4]
//   node tools/history_synth.mjs --sample --out tests/fixtures/zha-history-sample.json   (the committed fixture)
import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";
import { normalizeIeee, parseAddress } from "../custom_components/meshroute_topology_explorer/frontend/model/parse.js";

const nwkText = (v) => { const n = parseAddress(v); return n === null ? null : `0x${n.toString(16).toUpperCase().padStart(4, "0")}`; };

/** The recorder's snapshot of a `zha/devices` answer: { e: Map "rx|tx" -> lqi, r: [[holder, dest, hop, status]] }. */
export function snapshotOfRaw(devices) {
  const owner = new Map();
  for (const d of devices) {
    const n = nwkText(d.nwk);
    if (n) owner.set(n, owner.has(n) ? null : normalizeIeee(d.ieee));
  }
  const e = new Map();
  const r = new Set();
  for (const d of devices) {
    const holder = normalizeIeee(d.ieee);
    if (!holder || d.available === false) continue;
    for (const n of d.neighbors || []) {
      const tx = normalizeIeee(n.ieee);
      const lqi = typeof n.lqi === "string" && /^\d+$/.test(n.lqi.trim()) ? Number(n.lqi) : n.lqi;
      if (!tx || tx === holder || !Number.isInteger(lqi) || lqi < 0) continue;
      const k = `${holder}|${tx}`;
      if (!e.has(k) || lqi > e.get(k)) e.set(k, lqi);
    }
    for (const x of d.routes || []) {
      const [dest, hop] = [nwkText(x.dest_nwk), nwkText(x.next_hop)];
      if (dest && hop && typeof x.route_status === "string") r.add(JSON.stringify([holder, owner.get(dest) || dest, owner.get(hop) || hop, x.route_status]));
    }
  }
  return { e, r: [...r].map((x) => JSON.parse(x)).sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1)) };
}

/** `{ k, records }` of [{ t, snap }] in time order, with one key table; an unchanged snapshot becomes `{ t }`. */
export function toResponse(list) {
  const k = [];
  const idx = new Map();
  const key = (s) => { if (!idx.has(s)) { idx.set(s, k.length); k.push(s); } return idx.get(s); };
  const records = [];
  let prev = null;
  for (const { t, snap } of list) {
    const sig = JSON.stringify([[...snap.e], snap.r]);
    if (sig === prev) { records.push({ t }); continue; }
    prev = sig;
    const rec = { t, e: [...snap.e].sort().map(([p, lqi]) => { const [a, b] = p.split("|"); return [key(a), key(b), lqi]; }) };
    if (snap.r.length) rec.r = snap.r.map(([h, d, n, s]) => [key(h), key(d), key(n), s]);
    records.push(rec);
  }
  return { k, records };
}

/** Deterministic hash of a text to [0, 1). */
function unit(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return ((h >>> 0) % 100000) / 100000;
}

/** Snapshot at fraction f (0 = a, 1 = b) of the drift from snapshot a to b at step i. */
export function between(a, b, f, i) {
  const e = new Map();
  for (const k of new Set([...a.e.keys(), ...b.e.keys()])) {
    const [x, y] = [a.e.get(k), b.e.get(k)];
    if (unit(`gap${i}${k}`) < 0.03) continue; // a record without the entry
    if (x === undefined || y === undefined) { if (f < unit(`sw${k}`) === (x !== undefined)) e.set(k, x ?? y); continue; }
    e.set(k, Math.max(1, Math.min(255, Math.round(x + (y - x) * f + (unit(`j${i}${k}`) - 0.5) * 12))));
  }
  const byHolder = (s) => { const m = new Map(); for (const row of s.r) m.set(row[0], [...(m.get(row[0]) || []), row]); return m; };
  const [ra, rb] = [byHolder(a), byHolder(b)];
  const r = [];
  for (const h of new Set([...ra.keys(), ...rb.keys()])) r.push(...((f < 0.2 + 0.6 * unit(`rt${h}`) ? ra.get(h) : rb.get(h)) || []));
  return { e, r };
}

/** A deterministic variant of a sample capture for the committed fixture: every 7th route dropped, next hops of
 *  neighbouring routes swapped, so that routes differ between the two ends. */
export function perturbed(devices) {
  const copy = JSON.parse(JSON.stringify(devices));
  let n = 0;
  for (const d of copy) {
    d.routes = (d.routes || []).filter(() => (n++ % 7) !== 6);
    for (let i = 0; i + 1 < d.routes.length; i += 4) [d.routes[i].next_hop, d.routes[i + 1].next_hop] = [d.routes[i + 1].next_hop, d.routes[i].next_hop];
  }
  return copy;
}

/** Records from `a` to `b`: first and last are the captures themselves, in between `count - 2` synthetic ones. */
export function series(a, b, { start, step, count }) {
  return Array.from({ length: count }, (_, i) => {
    const f = i / (count - 1);
    return { t: start + i * step, snap: i === 0 ? a : i === count - 1 ? b : between(a, b, f, i) };
  });
}

function main(argv) {
  const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i < 0 ? d : argv[i + 1]; };
  const load = (p) => JSON.parse(readFileSync(p, "utf8")).responses["zha/devices"];
  const sample = argv.includes("--sample");
  const out = arg("out");
  if (!out || (!sample && !(arg("from") && arg("to")))) { process.stderr.write("usage: see the head of this file\n"); process.exit(2); }
  const a = sample ? load("tests/fixtures/zha-sample.json") : load(arg("from"));
  const b = sample ? perturbed(a) : load(arg("to"));
  const stepHours = Number(arg("step-hours", sample ? 24 : 4));
  const days = Number(arg("days", sample ? 5 : 3));
  const count = Math.round((days * 24) / stepHours) + 1;
  const start = Number(arg("start", 1761868800)); // 2025-10-31 00:00 UTC
  const res = toResponse(series(snapshotOfRaw(a), snapshotOfRaw(b), { start, step: stepHours * 3600, count }));
  writeFileSync(out, JSON.stringify(res) + "\n");
  process.stdout.write(`${out}: ${res.records.length} records, ${res.k.length} keys` + "\n");
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) main(process.argv.slice(2));
