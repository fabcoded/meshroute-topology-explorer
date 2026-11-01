// SPDX-License-Identifier: MIT
// Wording of the panel's short annotations (owner decision 2026-11-01, Codex review 1.3-1.6): relative ranks are not
// reliability, terms are used the same way everywhere, notes exist with their keys. Texts are English only.
// node --test tests/
import test from "node:test";
import assert from "node:assert/strict";
import { STRINGS, translator } from "../custom_components/meshroute_topology_explorer/frontend/ui/i18n.js";

const en = STRINGS.en;
const t = translator("en");

test("1.4a: relative ranks never read as reliability: no bad / medium / good in the active English texts", () => {
  for (const [key, text] of Object.entries(en)) {
    if (!/^(view\.(bad|medium|good|color_)|legend\.link\.reception|rank\.)/.test(key)) continue;
    assert.ok(!/\b(bad|good|poor|medium)\b/i.test(text), `${key}: ${text}`);
  }
  assert.equal(t("legend.link.reception"), "coloured: lower · middle · higher reception rank");
  assert.deepEqual(["bad", "medium", "good"].map((k) => t(`view.${k}`)), ["lower", "middle", "higher"]);
  assert.equal(t("view.color_bad_label"), "Colour for lower reception rank");
});

test("1.4a: the rank names the comparison basis the model used", () => {
  assert.equal(t("rank.basis_reporter", { reporter: "Router 12" }), "rank among the readings of Router 12");
  assert.match(t("rank.basis_vendor", { vendor: "IKEA", reporter: "Router 12" }), /^rank within the IKEA group/);
  assert.match(t("details.rank_note"), /vendor group/);
});

test("1.4b: no 'weakest RX' summary: the heading names hop counts and the markers, and the function is gone", async () => {
  assert.ok(!/weakest/i.test(en["details.theory_head"]), en["details.theory_head"]);
  assert.match(en["details.theory_head"], /number of hops/);
  const details = await import("../custom_components/meshroute_topology_explorer/frontend/ui/details.js");
  assert.equal("weakestHop" in details, false);
});

test("1.4c: the status line gives exact router-table counts, not a completeness percentage", async () => {
  const { statusParts } = await import("../custom_components/meshroute_topology_explorer/frontend/ui/status.js");
  const { sampleNetwork } = await import("./panel-fixture.mjs");
  const network = sampleNetwork();
  for (const compact of [false, true]) {
    const text = statusParts(network, { compact }).map(([key, params]) => t(key, params)).join(" · ");
    assert.match(text, /Router tables:? 29\/29/);
    assert.ok(!/%|complete/i.test(text), text);
  }
  assert.ok(!("status.complete" in en) && !("status.short_complete" in en));
});
