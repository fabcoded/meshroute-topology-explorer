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
