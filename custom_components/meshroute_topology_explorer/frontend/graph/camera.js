// SPDX-License-Identifier: MIT
// Pan and zoom of the map (spec 9.3) as pure functions. A camera is { k, cx, cy }: scale k (screen pixels per
// layout unit; layout units are CSS pixels at zoom 1) and the layout point shown at the centre of the canvas.
// node --test tests/

/** Zoom range relative to the fitted view (spec 9.3). */
export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 8;
/** Zoom step per wheel notch and per button press (spec 9.3). */
export const ZOOM_STEP = 1.2;

export function toScreen(cam, x, y, width, height) {
  return [(x - cam.cx) * cam.k + width / 2, (y - cam.cy) * cam.k + height / 2];
}

export function toWorld(cam, sx, sy, width, height) {
  return [(sx - width / 2) / cam.k + cam.cx, (sy - height / 2) / cam.k + cam.cy];
}

/** Bounding box { minX, minY, maxX, maxY } of points given as parallel arrays; null if there are none. */
export function bounds(xs, ys) {
  if (!xs.length) return null;
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (let i = 0; i < xs.length; i++) {
    if (xs[i] < minX) minX = xs[i];
    if (xs[i] > maxX) maxX = xs[i];
    if (ys[i] < minY) minY = ys[i];
    if (ys[i] > maxY) maxY = ys[i];
  }
  return { minX, minY, maxX, maxY };
}

/** Camera that shows the whole box with a margin in screen pixels. A single point or an empty map is shown at
 *  zoom 1, so the fitted view never becomes infinite. */
export function fitCamera(box, width, height, margin = 48) {
  if (!box) return { k: 1, cx: 0, cy: 0 };
  const w = Math.max(box.maxX - box.minX, 1);
  const h = Math.max(box.maxY - box.minY, 1);
  const availW = Math.max(width - 2 * margin, 1);
  const availH = Math.max(height - 2 * margin, 1);
  const k = box.maxX - box.minX < 1 && box.maxY - box.minY < 1 ? 1 : Math.min(availW / w, availH / h);
  return { k, cx: (box.minX + box.maxX) / 2, cy: (box.minY + box.maxY) / 2 };
}

/** Zoom by factor keeping the layout point under (sx, sy) in place; k is clamped to [kMin, kMax]. */
export function zoomAt(cam, factor, sx, sy, width, height, kMin, kMax) {
  const k = Math.max(kMin, Math.min(kMax, cam.k * factor));
  const [wx, wy] = toWorld(cam, sx, sy, width, height);
  return { k, cx: wx - (sx - width / 2) / k, cy: wy - (sy - height / 2) / k };
}

export function panBy(cam, dx, dy) {
  return { k: cam.k, cx: cam.cx - dx / cam.k, cy: cam.cy - dy / cam.k };
}

/** Zoom factor of one wheel event: × 1.2 per notch. A notch is 100 pixels (deltaMode 0, what browsers send for a
 *  mouse wheel), 3 lines (deltaMode 1) or one page; touchpads send fractions and zoom smoothly. */
export function wheelFactor(deltaY, deltaMode = 0) {
  const perNotch = deltaMode === 1 ? 3 : deltaMode === 2 ? 1 : 100;
  return ZOOM_STEP ** (-deltaY / perNotch);
}

/** Camera between a and b at progress e (0..1): scale interpolated geometrically, centre linearly. */
export function interpolate(a, b, e) {
  return {
    k: a.k * (b.k / a.k) ** e,
    cx: a.cx + (b.cx - a.cx) * e,
    cy: a.cy + (b.cy - a.cy) * e,
  };
}
