// SPDX-License-Identifier: MIT
// Helpers the path history charts share (spec 9.5): time text, axis ticks, linear scales, line paths that break at gaps,
// the colours of the two directions. Pure functions. npm test

/** Colours of the two directions of a lane or route, validated on the board (M36): "there" blue, "back" orange. */
export function directionColors(theme) {
  return theme.dark ? { there: "#3987e5", back: "#d95926", weak: "#ff6b6b" } : { there: "#2a78d6", back: "#eb6834", weak: "#c62828" };
}

/** "Nov 2 08:00" in the browser's time zone (or `zone`), the user's locale. */
export function timeText(sec, locale = "en", zone = undefined) {
  return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    timeZone: zone }).format(new Date(sec * 1000));
}

/** "Nov 2". */
export function dayText(sec, locale = "en", zone = undefined) {
  return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", timeZone: zone }).format(new Date(sec * 1000));
}

const STEPS = [6 * 3600, 12 * 3600, 86400, 2 * 86400, 7 * 86400, 14 * 86400, 30 * 86400];

/** Axis ticks inside [from, to]: [{ t, day (a day boundary or coarser: label with the date, else with the time) }], at
 *  most `max`, on multiples of the smallest step that fits, counted from local midnight of the browser. */
export function timeTicks(from, to, max = 7) {
  const step = STEPS.find((s) => (to - from) / s <= max) || STEPS[STEPS.length - 1];
  const offset = -new Date(from * 1000).getTimezoneOffset() * 60;
  const first = Math.ceil((from + offset) / step) * step - offset;
  const out = [];
  for (let t = first; t <= to; t += step) out.push({ t, day: step >= 86400 || (t + offset) % 86400 === 0 });
  return out;
}

/** Linear scale from the domain [d0, d1] to the range [r0, r1]. */
export function scale([d0, d1], [r0, r1]) {
  const k = d1 === d0 ? 0 : (r1 - r0) / (d1 - d0);
  return (v) => r0 + (v - d0) * k;
}

const r1 = (v) => Math.round(v * 10) / 10;

/** SVG path of points [[t, value|null]]: a null value breaks the line (a record without the entry is a gap, never a
 *  zero). A single point between gaps has no line; the caller draws dots. */
export function linePath(points, x, y) {
  let d = "";
  let pen = false;
  for (const [t, v] of points) {
    if (v === null || v === undefined) { pen = false; continue; }
    d += `${pen ? "L" : "M"}${r1(x(t))} ${r1(y(v))}`;
    pen = true;
  }
  return d;
}

/** The value of series points at the record nearest to t: { t, value } or null for an empty series. */
export function nearestPoint(points, t) {
  let best = null;
  for (const p of points) if (!best || Math.abs(p[0] - t) < Math.abs(best[0] - t)) best = p;
  return best;
}

/** An axis tick's label: the date at a day boundary, else the time of day, so a 12 h tick is never read as the date. */
export function tickText(tick, locale = "en", zone = undefined) {
  return tick.day ? dayText(tick.t, locale, zone) : timeText(tick.t, locale, zone).split(" ").pop();
}
