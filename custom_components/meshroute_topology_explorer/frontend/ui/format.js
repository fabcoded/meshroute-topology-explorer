// SPDX-License-Identifier: MIT
// Text forms of values shared by the tabs: LQI (0 is "uncertain", spec 3.1), ratings as ranks within what the
// reporter hears (spec 5.4), roles. Pure; t is the translator of i18n.js. Tested in Node: npm test

/** Below this rating a reading is in the "weakest tenth of what R hears" (spec 5.4 wording). */
const WEAKEST = 0.1;

export function lqiText(lqi, t) {
  if (lqi === 0) return t("lqi.uncertain");
  return typeof lqi === "number" && lqi > 0 ? t.number(lqi) : t("lqi.none");
}

/** A rating (0..1) as a whole percentage, at least 0 and at most 100. */
export function percent(rating) {
  return Math.max(0, Math.min(100, Math.round(rating * 100)));
}

/** "rank 35 %", or "rank 4 %, weakest tenth of what Router 07 hears"; "not rated" without a rating. */
export function rankText(rating, reporterLabel, t) {
  if (typeof rating !== "number") return t("rank.none");
  const pct = percent(rating);
  return rating < WEAKEST ? t("rank.weakest", { pct, reporter: reporterLabel }) : t("rank.value", { pct });
}

/** Tooltip of a reading row: the rank and the comparison basis the model used (engines/zigbee/ratings.js applyRatings).
 *  In a vendor pool no claim is made about the single reporter's readings. */
export function rankTooltip(r, t) {
  if (typeof r.rating !== "number") return t("rank.none");
  const pct = percent(r.rating);
  const reporter = r.reporter.label;
  if (r.pool === "vendor") {
    const vendor = r.reporter.vendor || "?";
    return r.rating < WEAKEST ? t("rank.weakest_vendor", { pct, vendor, reporter }) : `${t("rank.value", { pct })}, ${t("rank.basis_vendor", { vendor, reporter })}`;
  }
  return `${rankText(r.rating, reporter, t)}, ${t("rank.basis_reporter", { reporter })}`;
}

export function receptionText(rating, t) {
  return typeof rating === "number" ? t("reception.value", { pct: percent(rating) }) : t("reception.none");
}

export function roleText(role, t) {
  return t(`role.${role}`);
}
