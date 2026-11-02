// SPDX-License-Identifier: MIT
// Thread reception model (review draft, brief tq; docs/thread-quality-model.md): turns the readings of a Thread
// network (model.js, pairs { a, b, ab, ba }, ab = "a hears b") into one of three signal bands per direction,
// a stroke level for a lane, and finding candidates per node. Pure, no DOM. Not wired into the map yet: the engine
// refactor feeds laneLook() to the shared laneStyle() and the findings to the Findings tab.
// npm test
//
// The scale is absolute (dBm), anchored where the receiving Thread stack itself changes its link quality:
// - OpenThread link quality 0-3 is the link margin: the average RSSI minus the radio's receive-sensitivity constant
//   (otPlatRadioGetReceiveSensitivity, used as the noise floor), bucketed at > 20, > 10 and > 2 dB with 2 dB
//   hysteresis (link_quality.hpp / link_quality.cpp ComputeLinkMargin; Silicon Labs Thread Fundamentals). The
//   nRF528xx port returns -100 dBm and Zephyr defaults to -100 dBm, so -80 and -90 dBm are the stack's own link
//   quality 3 / 2 limits on those radios, not a convention. Other platforms' constants are unverified.
// - The snapshot carries no constant, so -100 dBm is assumed: above -80 dBm is link quality 3, -89 to -80 dBm is 2,
//   -90 dBm or below is 1 or less. The anonymized sample agrees: -85 dBm comes with link quality 2, -77 to -21 dBm
//   with 3. A receiver on another constant has its own limits; the receiver's link quality caps the band (below).
// - -90 dBm is also where a new router link stops being attempted: the Link Request margin (10 dB,
//   OPENTHREAD_CONFIG_MLE_LINK_REQUEST_MARGIN_MIN) is checked one-way on the advertisement's average RSS.
// RSSI 127 is "invalid or unknown" (openthread.io, OT_RADIO_RSSI_INVALID), so it is no value, never a strong one.
// The server's per-direction `strength` is not used: matter.js documents it as a renaming of link quality 0-3
// (none / weak / medium / strong), so it adds nothing to the link quality the band already uses. The server's `rssi`
// is the neighbour's average RSSI, the last one only as fallback (matterjs-server topology-utils.ts).
// Cap rule: where both RSSI and the receiver's own link quality exist, the band is
// the lower of the RSSI band and the link-quality band, because the receiver's class accounts for its own constant.
// Link quality 0 with a valid RSSI is a measured low reading (basis "rssi"); with no valid RSSI it gives no band.
import { threadLqi, threadRssi } from "./from-matter.js";

/** Nominal receiver noise floor (dBm) that turns link-margin limits into RSSI limits; see the header. */
export const NOMINAL_NOISE_FLOOR_DBM = -100;
/** Link-margin limits (dB) of Thread link quality 3, 2 and 1 (OpenThread API documentation, "per Thread spec"). */
export const LQ_MARGIN_DB = Object.freeze({ lq3: 20, lq2: 10, lq1: 2 });
/** RSSI above this is the high band (margin above 20 dB at the nominal floor: link quality 3). */
export const RSSI_HIGH_ABOVE_DBM = NOMINAL_NOISE_FLOOR_DBM + LQ_MARGIN_DB.lq3;
/** RSSI at or below this is the low band (margin 10 dB or less: link quality 1 or 0, and below OpenThread's minimum
 *  margin for setting up a router link). Between the two limits is the middle band. */
export const RSSI_LOW_AT_OR_BELOW_DBM = NOMINAL_NOISE_FLOOR_DBM + LQ_MARGIN_DB.lq2;
/** Bands from weakest to strongest. Neutral names on purpose: the legend states the dBm limits, not a judgement. */
export const BANDS = Object.freeze(["low", "mid", "high"]);
/** Stroke level per band, the 0..1 input of the shared laneStyle(): the middle of each of its three width steps
 *  (graph/links.js WIDTH_STEPS at 1/3 and 2/3), so width and colour have exactly three looks. Not a rank. */
export const BAND_LEVEL = Object.freeze({ low: 1 / 6, mid: 1 / 2, high: 5 / 6 });
/** RSSI band and link-quality band this many bands apart on one reading raise a hint. A gap that size means a
 *  different sensitivity constant on that radio, a non-OpenThread stack, or RSSI and link quality taken from
 *  different samples; the data cannot tell which, and does not suggest interference. */
export const MISMATCH_BANDS = 2;
/** Kinds this module raises: findings judge, hints point at something worth a look (as Zigbee's "very low reading"). */
export const QUALITY_FINDINGS = Object.freeze(["weak parent link", "weak router links"]);
export const QUALITY_HINTS = Object.freeze(["listed by one side", "signal and link quality disagree"]);

const ROUTER_ROLES = new Set(["router", "border router"]);
const rank = (band) => BANDS.indexOf(band);
const weaker = (x, y) => (x === null ? y : y === null ? x : rank(x) <= rank(y) ? x : y);

/** Band of an RSSI in dBm, or null when there is no valid value (missing, 127, outside a radio's range). */
export function rssiBand(rssi) {
  const v = threadRssi(rssi);
  if (v === null) return null;
  return v > RSSI_HIGH_ABOVE_DBM ? "high" : v > RSSI_LOW_AT_OR_BELOW_DBM ? "mid" : "low";
}

/** Band of a Thread link quality: 3 high, 2 mid, 1 low; 0 ("unknown cost", observed dead) and no value give null. */
export function lqBand(lq) {
  const v = threadLqi(lq);
  return v === 3 ? "high" : v === 2 ? "mid" : v === 1 ? "low" : null;
}

/** Band of one direction (a pair's ab or ba, "hearer hears sender"): the lower of the RSSI band and the receiver's
 *  own link-quality band; either alone where the other is missing. Link quality 0 with a valid RSSI is low (basis
 *  "rssi"). Only a measured direction has a band; implied (a parent link nobody measured) and unknown stay null.
 *  basis: "rssi", "lq" (no RSSI), "lq cap" (the link-quality band is lower than the RSSI band), or null.
 *  -> { band, basis, rssi, lq, rssiBand, lqBand, mismatch } */
export function directionBand(dir) {
  const measured = Boolean(dir && dir.state === "measured");
  const rssi = measured ? threadRssi(dir.rssi) : null;
  const lq = measured ? threadLqi(dir.lqi) : null;
  const rb = rssiBand(rssi);
  const lb = lq === 0 && rb ? "low" : lqBand(lq);
  const band = weaker(rb, lb);
  const basis = !band ? null : !rb ? "lq" : lb && lq > 0 && rank(lb) < rank(rb) ? "lq cap" : "rssi";
  return {
    band, basis, rssi, lq, rssiBand: rb, lqBand: lb,
    mismatch: Boolean(rb && lb && Math.abs(rank(rb) - rank(lb)) >= MISMATCH_BANDS),
  };
}

/** Look of one lane (one direction, drawn from sender to hearer; dir = the hearer's evidence): its band and the
 *  stroke level for laneStyle(); level null keeps the lane in the unknown look. -> { band, basis, level } */
export function laneLook(dir) {
  const { band, basis } = directionBand(dir);
  return { band, basis, level: band ? BAND_LEVEL[band] : null };
}

/** The pair between two devices, with its directions from the point of view of `hearer`, or null. */
function pairFor(pairs, hearer, sender) {
  const p = pairs.find((q) => (q.a === hearer && q.b === sender) || (q.a === sender && q.b === hearer));
  if (!p) return null;
  return p.a === hearer ? { hears: p.ab, heard: p.ba } : { hears: p.ba, heard: p.ab };
}

/** Evidence summary of a direction for a finding: the values and the band, no text. */
const summary = (dir) => {
  const q = directionBand(dir);
  return { band: q.band, basis: q.basis, rssi: q.rssi, lq: q.lq, state: dir ? dir.state : null };
};

/** Finding candidates of one node (spec 5.6 shape { kind, device, evidence, missing }), from its own readings and
 *  those of its neighbours. Nothing is raised from an unavailable device or from a direction without a value. */
export function nodeQualityFindings(network, deviceId) {
  const devices = (network && network.devices) || [];
  const pairs = (network && network.pairs) || [];
  const readings = (network && network.readings) || [];
  const byId = new Map(devices.map((d) => [d.id, d]));
  const d = byId.get(deviceId);
  if (!d || !d.available) return [];
  const out = [];
  const limits = { lowAtOrBelowDbm: RSSI_LOW_AT_OR_BELOW_DBM, lowLq: 1 };

  // An end device talks only to its parent: every poll and every message crosses this one link, so a low band in
  // either direction matters (a sleepy device pays it in retries and battery). Thread routing weighs both
  // directions (Silicon Labs Thread Fundamentals: "routing cost is based on bidirectional link quality").
  const parent = d.role === "end device" && d.parent ? byId.get(d.parent) : null;
  if (parent && parent.available) {
    const p = pairFor(pairs, d.id, parent.id);
    if (p) {
      const childHears = summary(p.hears);
      const parentHears = summary(p.heard);
      if (childHears.band === "low" || parentHears.band === "low") {
        out.push({ kind: "weak parent link", device: d.id, evidence: { parent: parent.id, sleepy: d.sleepy,
          childHears, parentHears, limits }, missing: missingDirections({ childHears, parentHears }) });
      }
    }
  }

  // A router whose every link to another router is low: its children and its share of the mesh hang on links at
  // the margin where OpenThread would not set up a new router link. Needs the router's own table (else unknown).
  if (d.role === "router" && d.tableRead) {
    const links = pairs.filter((q) => q.a === d.id || q.b === d.id)
      .map((q) => (q.a === d.id ? q.b : q.a)).map((id) => byId.get(id))
      .filter((o) => o && o.available && ROUTER_ROLES.has(o.role))
      .map((o) => {
        const p = pairFor(pairs, d.id, o.id);
        const hears = summary(p.hears);
        const heard = summary(p.heard);
        return { other: o.id, hears, heard, weaker: weaker(hears.band, heard.band) };
      });
    if (links.length && links.every((l) => l.weaker === "low")) {
      out.push({ kind: "weak router links", device: d.id, evidence: { links, only: links.length === 1, limits },
        missing: [] });
    }
  }

  // Listed by one side: d's table was read in this snapshot and has no live entry for a neighbour that lists d.
  // A hint, not a finding: the Matter server reads the tables one node at a time, so an entry may have aged out
  // (or appeared) in between; the two tables are of unknown age, possibly hours apart. Border routers are not Matter nodes and have no table, so they never raise it.
  if (d.tableRead) {
    const own = new Map(readings.filter((r) => r.reporter === d.id).map((r) => [r.subject, r]));
    const listers = readings.filter((r) => r.subject === d.id && r.measured && byId.get(r.reporter)
      && byId.get(r.reporter).available && (!own.has(r.reporter) || !own.get(r.reporter).measured));
    if (listers.length) {
      out.push({ kind: "listed by one side", device: d.id, evidence: { neighbours: listers.map((r) => ({
        other: r.reporter, otherHears: { rssi: threadRssi(r.rssi), lq: threadLqi(r.lqi) },
        ownEntry: own.has(r.reporter) ? "listed without a live link" : "not listed" })) }, missing: [] });
    }
  }

  // Signal and link quality disagree: the device itself rates a reading two bands away from what its RSSI says on
  // the nominal floor. A gap that size means another sensitivity constant, a non-OpenThread stack, or RSSI and link
  // quality from different samples; the cause is not knowable here, so it is not blamed on interference.
  const odd = pairs.filter((q) => q.a === d.id || q.b === d.id).map((q) => {
    const other = q.a === d.id ? q.b : q.a;
    return { other, q: directionBand(q.a === d.id ? q.ab : q.ba) };
  }).filter((x) => x.q.mismatch);
  if (odd.length) {
    out.push({ kind: "signal and link quality disagree", device: d.id, evidence: { readings: odd.map(({ other, q }) => ({
      other, rssi: q.rssi, lq: q.lq, rssiBand: q.rssiBand, lqBand: q.lqBand })), nominalNoiseFloorDbm:
      NOMINAL_NOISE_FLOOR_DBM }, missing: [] });
  }
  return out;
}

/** Directions of a finding that have no band, named for its "missing" list. */
function missingDirections(dirs) {
  return Object.entries(dirs).filter(([, s]) => s.band === null).map(([name]) => name);
}

/** Finding candidates of every node, in device order. */
export function qualityFindings(network) {
  return ((network && network.devices) || []).flatMap((d) => nodeQualityFindings(network, d.id));
}
