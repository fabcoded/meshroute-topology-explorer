// SPDX-License-Identifier: MIT
// Test helper (also used by dev/graph.html), not shipped: the fidelity measure of spec 12, the rank correlation (Spearman, mid-ranks for
// ties) between the drawn length of each reading's spring and its LQI. Readings without a value are left out.

function ranks(values) {
  const order = values.map((v, i) => i).sort((a, b) => values[a] - values[b]);
  const out = new Array(values.length);
  for (let s = 0; s < order.length;) {
    let e = s;
    while (e + 1 < order.length && values[order[e + 1]] === values[order[s]]) e++;
    for (let k = s; k <= e; k++) out[order[k]] = (s + e) / 2 + 1;
    s = e + 1;
  }
  return out;
}

export function spearman(xs, ys) {
  const rx = ranks(xs);
  const ry = ranks(ys);
  const n = xs.length;
  const mx = rx.reduce((a, b) => a + b, 0) / n;
  const my = ry.reduce((a, b) => a + b, 0) / n;
  let sxy = 0; let sxx = 0; let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (rx[i] - mx) * (ry[i] - my);
    sxx += (rx[i] - mx) ** 2;
    syy += (ry[i] - my) ** 2;
  }
  return sxy / Math.sqrt(sxx * syy);
}

/** Fidelity of a finished Layout: Spearman(drawn length, LQI) over all springs with a known LQI. */
export function fidelity(layout) {
  const known = layout.springLengths().filter((s) => s.lqi !== null);
  return spearman(known.map((s) => s.length), known.map((s) => s.lqi));
}
