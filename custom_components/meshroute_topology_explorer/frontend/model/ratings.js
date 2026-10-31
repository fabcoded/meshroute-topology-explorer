// SPDX-License-Identifier: MIT
// Rating relative to the reporter (spec 5.4). A rating is a rank, not a health claim: by construction a tenth of
// every reporter's readings fall in its lowest tenth. Pure functions.

const MIN_POOL = 10;

/** Median of a non-empty array of numbers. */
export function median(values) {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Mid-rank percentile (0 = lowest, 1 = highest) of `value` within `sorted` values that include it. */
function midRank(sorted, value) {
  let less = 0;
  let equal = 0;
  for (const v of sorted) { if (v < value) less += 1; else if (v === value) equal += 1; }
  return (less + equal / 2) / sorted.length;
}

/** Fill `rating`, `pool` ("reporter" | "vendor" | null) and `poolMedian` on every reading, then `rating` (reception:
 *  best rating as subject, LQI 0 excluded) on every device. Reporters with fewer than 10 non-zero values use all
 *  readings of reporters of the same vendor; still fewer than 10 means no rating. Mutates the arrays it is given. */
export function applyRatings(devices, readings) {
  const byId = new Map(devices.map((d) => [d.id, d]));
  const perReporter = new Map();
  const perVendor = new Map();
  for (const r of readings) {
    if (!(r.lqi > 0)) continue;
    if (!perReporter.has(r.reporter)) perReporter.set(r.reporter, []);
    perReporter.get(r.reporter).push(r.lqi);
    const vendor = byId.get(r.reporter).vendor;
    if (vendor) {
      if (!perVendor.has(vendor)) perVendor.set(vendor, []);
      perVendor.get(vendor).push(r.lqi);
    }
  }
  for (const list of [...perReporter.values(), ...perVendor.values()]) list.sort((a, b) => a - b);

  for (const r of readings) {
    r.rating = null; r.pool = null; r.poolMedian = null;
    if (!(r.lqi > 0)) continue; // 0 is ambiguous (unmeasured or very weak): never rated
    let pool = perReporter.get(r.reporter);
    let source = "reporter";
    if (pool.length < MIN_POOL) {
      pool = perVendor.get(byId.get(r.reporter).vendor) || [];
      source = "vendor";
    }
    if (pool.length < MIN_POOL) continue;
    r.rating = midRank(pool, r.lqi);
    r.pool = source;
    r.poolMedian = median(pool);
  }

  for (const d of devices) d.rating = null;
  for (const r of readings) {
    if (r.rating === null) continue;
    const d = byId.get(r.subject);
    if (d.rating === null || r.rating > d.rating) d.rating = r.rating;
  }
}
