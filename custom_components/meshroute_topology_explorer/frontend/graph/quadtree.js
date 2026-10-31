// SPDX-License-Identifier: MIT
// Barnes-Hut approximation (Barnes and Hut 1986) of the repulsion sum in layout.js: far groups of devices act as
// one mass at their centre. Used only for large networks; small ones use exact pair sums. Pure, no DOM.
// node --test tests/

const MAX_DEPTH = 24; // coincident points end up together in one leaf instead of splitting forever

function makeNode(x0, y0, size, depth) {
  return { x0, y0, size, depth, mass: 0, mx: 0, my: 0, points: [], children: null };
}

function insert(node, i, xs, ys) {
  for (;;) {
    if (!node.children) {
      if (node.points.length === 0 || node.depth >= MAX_DEPTH) {
        node.points.push(i);
        return;
      }
      // Split the leaf and push its points one level down.
      const half = node.size / 2;
      node.children = [0, 1, 2, 3].map((q) =>
        makeNode(node.x0 + (q & 1) * half, node.y0 + (q >> 1) * half, half, node.depth + 1));
      const old = node.points;
      node.points = [];
      for (const j of old) insert(node, j, xs, ys);
    }
    const half = node.size / 2;
    const q = (xs[i] >= node.x0 + half ? 1 : 0) + (ys[i] >= node.y0 + half ? 2 : 0);
    node = node.children[q];
  }
}

function accumulate(node, xs, ys) {
  if (node.children) {
    for (const c of node.children) {
      accumulate(c, xs, ys);
      node.mass += c.mass;
      node.mx += c.mx * c.mass;
      node.my += c.my * c.mass;
    }
  } else {
    for (const j of node.points) { node.mass++; node.mx += xs[j]; node.my += ys[j]; }
  }
  if (node.mass) { node.mx /= node.mass; node.my /= node.mass; }
}

/** Tree over the given indices of the coordinate arrays. */
export function buildQuadtree(indices, xs, ys) {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const i of indices) {
    minX = Math.min(minX, xs[i]); maxX = Math.max(maxX, xs[i]);
    minY = Math.min(minY, ys[i]); maxY = Math.max(maxY, ys[i]);
  }
  const size = Math.max(maxX - minX, maxY - minY, 1) * 1.0001;
  const root = makeNode(minX, minY, size, 0);
  for (const i of indices) insert(root, i, xs, ys);
  accumulate(root, xs, ys);
  return { root, xs, ys };
}

/** Repulsion on device i at (px, py): sum of kk / d away from every other device, as [fx, fy]. */
export function quadtreeForce(tree, i, px, py, kk, theta) {
  const { xs, ys } = tree;
  let fx = 0;
  let fy = 0;
  const stack = [tree.root];
  while (stack.length) {
    const node = stack.pop();
    if (!node.mass) continue;
    if (!node.children) {
      for (const j of node.points) {
        if (j === i) continue;
        let dx = px - xs[j];
        let dy = py - ys[j];
        let d2 = dx * dx + dy * dy;
        if (d2 < 1e-6) {
          // Coincident: the same fixed direction as the exact sum in layout.js, the lower index to the upper left.
          const sign = i < j ? 1 : -1;
          dx = -0.6 * sign; dy = -0.8 * sign; d2 = 1;
        }
        fx += (dx * kk) / d2;
        fy += (dy * kk) / d2;
      }
      continue;
    }
    const dx = px - node.mx;
    const dy = py - node.my;
    const d2 = dx * dx + dy * dy;
    if (node.size * node.size < theta * theta * d2) {
      fx += (dx * kk * node.mass) / d2;
      fy += (dy * kk * node.mass) / d2;
    } else {
      for (const c of node.children) stack.push(c);
    }
  }
  return [fx, fy];
}
