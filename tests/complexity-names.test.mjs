// SPDX-License-Identifier: MIT
// The names of the complexity ratchet (tools/complexity.mjs, docs/quality.md "Gates"): every function gets a
// qualified name that does not depend on its line, at exactly the place where sonarjs reports its score, so the
// two join. ESLint's Linter in memory, no files. npm test
import test from "node:test";
import assert from "node:assert/strict";
import { Linter } from "eslint";
import sonarjs from "eslint-plugin-sonarjs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collect, createEslint, names } from "../tools/complexity.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Names and sonarjs reports of `code` as { "line:column": name } and ["line:column"]; threshold 0 reports every
 *  function with any complexity. */
function lint(code) {
  const messages = new Linter({ configType: "flat" }).verify(code, [{
    languageOptions: { ecmaVersion: 2022, sourceType: "module" },
    plugins: { complexity: { rules: { names } }, sonarjs },
    rules: { "complexity/names": "warn", "sonarjs/cognitive-complexity": ["warn", 0] },
  }]);
  const at = (m) => `${m.line}:${m.column}`;
  assert.deepEqual(messages.filter((m) => !m.ruleId), [], "parses");
  return {
    named: Object.fromEntries(messages.filter((m) => m.ruleId === "complexity/names").map((m) => [at(m), m.message])),
    scored: messages.filter((m) => m.ruleId === "sonarjs/cognitive-complexity").map(at),
  };
}

const SAMPLE = `
export function outer(a) {
  if (a) return 1;
  const inner = (b) => { if (b) return 2; };
  [1].map((x) => { if (x) return x; });
  [2].map(function () { if (a) return a; });
  return inner;
}
class Box {
  get size() { if (this.n) return 1; return 0; }
  draw() { if (this.n) this.n--; }
  static draw() { if (Box.n) Box.n--; }
  #hidden() { if (this.n) return 1; }
  handler = () => { if (this.n) return 1; };
}
const api = { call(x) { if (x) return 1; }, "quoted key": function () { if (api) return 1; } };
api.later = () => { if (api) return 1; };
test("keeps the title", () => { if (api) return 1; });
describe("suite", () => { it("case", () => { if (api) return 1; }); });
export default function () { if (api) return 1; }
`;

test("every scored function has a name at the place sonarjs reports it", () => {
  const { named, scored } = lint(SAMPLE);
  assert.ok(scored.length >= 14, `sonarjs scored ${scored.length}`);
  for (const place of scored) assert.ok(named[place], `no name at ${place}`);
});

test("qualified names: declarations, bindings, class members, callbacks by their call, repeats numbered", () => {
  const { named } = lint(SAMPLE);
  assert.deepEqual(Object.values(named).sort(), [
    "Box.#hidden", "Box.draw", "Box.draw#2", "Box.get size", "Box.handler",
    "api.later", "call", "default",
    "describe(\"suite\")", "describe(\"suite\")>it(\"case\")",
    "outer", "outer>inner", "outer>map()", "outer>map()#2",
    "quoted key", "test(\"keeps the title\")",
  ].sort());
});

test("names do not depend on lines: moving code down keeps every name", () => {
  const a = Object.values(lint(SAMPLE).named);
  const b = Object.values(lint(`\n\n// moved\n${SAMPLE.replace("if (a) return 1;", "if (a) {\n    return 1;\n  }")}`).named);
  assert.deepEqual(b, a);
});

test("an assignment target or computed key reformatted keeps its name (review rev-s10 F6)", () => {
  const code = (target) => `${target} = () => { if (api) return 1; };\nconst o = { [ k . x ]() { if (o) return 1; } };`;
  const a = Object.values(lint(code("api.later")).named);
  assert.deepEqual(Object.values(lint(code("api\n  .later")).named), a);
  assert.deepEqual(Object.values(lint(code("api . later /* moved */")).named), a);
  assert.deepEqual(a, ["api.later", "[k.x]"]);
});

// Review rev-s10 F1: an inline directive hid a function from the ratchet. Inline configuration is off, so neither a
// whole-file disable nor one aimed at sonarjs exempts a function above 15.
const COMPLEX = `export function tangled(a, b, c) {
  for (const x of a) { if (x) { for (const y of b) { if (y && c) { if (x > y) { while (c) { if (b || a) c--; } } } } } }
}
`;

for (const [what, code] of [
  ["a whole-file eslint-disable", `/* eslint-disable */\n${COMPLEX}`],
  ["eslint-disable-next-line for sonarjs", `// eslint-disable-next-line sonarjs/cognitive-complexity\n${COMPLEX}`],
  ["no directive", COMPLEX],
]) {
  test(`the ratchet scores a function above 15 with ${what}`, async () => {
    const eslint = await createEslint();
    const found = collect(await eslint.lintText(code, { filePath: path.join(ROOT, "tools/inline-config-probe.mjs") }));
    assert.deepEqual(found.map(({ name, score }) => [name, score > 15]), [["tangled", true]]);
  });
}
