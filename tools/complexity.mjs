// SPDX-License-Identifier: MIT
// Cognitive complexity of every JavaScript function above 15, with a name that survives moved lines, for the
// complexity ratchet (tools/complexity.py, docs/quality.md "Gates"). The score is ESLint's sonarjs rule from
// eslint.quality.config.mjs; the name comes from the rule `names` below, joined on the line and column where both
// report a function. Prints JSON [{ file, name, line, score }].
//   node tools/complexity.mjs [FILE ...]   (no files: the whole repository, with the quality config's ignores)
// Run it through python3 tools/complexity.py, which compares the result with tools/complexity-baseline.json.
import "./node-version.mjs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCORE = /Cognitive Complexity from (\d+) to/;
const FUNCTIONS = ["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"];

/** The token where sonarjs reports a function (its helper getMainFunctionTokenLocation, eslint-plugin-sonarjs
 *  4.2.2): the name of a declaration, the key of a method or property, else the `function` keyword or the arrow. */
function reportLoc(node, sourceCode) {
  const p = node.parent;
  if (node.type === "FunctionDeclaration" && node.id) return node.id.loc;
  if (node.type === "FunctionExpression" && p && (p.type === "MethodDefinition" || p.type === "Property")) return p.key.loc;
  const tokens = node.type === "ArrowFunctionExpression" ? sourceCode.getTokensBefore(node.body).reverse()
    : sourceCode.getTokens(node);
  const token = tokens.find((t) => t.value === (node.type === "ArrowFunctionExpression" ? "=>" : "function"));
  return token ? token.loc : node.loc;
}

/** A property or method key as written: `name`, `#private`, `"literal"`, or `[computed]`. */
function keyName(p, sourceCode) {
  if (p.computed) return `[${sourceCode.getText(p.key)}]`;
  if (p.key.type === "PrivateIdentifier") return `#${p.key.name}`;
  return p.key.type === "Identifier" ? p.key.name : String(p.key.value);
}

/** The call a callback is passed to: `map()`, or `test("title")` where the first argument is a string, the most
 *  stable key a test has. */
function callName(call) {
  const c = call.callee;
  const callee = c.type === "MemberExpression" && !c.computed ? c.property.name : c.type === "Identifier" ? c.name : "<call>";
  const first = call.arguments[0];
  return first && first.type === "Literal" && typeof first.value === "string" ? `${callee}(${JSON.stringify(first.value)})`
    : `${callee}()`;
}

/** A function's own name: its id, the key, variable or assignment target it is bound to, or the call it is passed to. */
function ownName(node, sourceCode) {
  const p = node.parent;
  if (node.id) return node.id.name;
  if (p.type === "MethodDefinition" || p.type === "Property" || p.type === "PropertyDefinition") {
    return (p.kind === "get" || p.kind === "set" ? `${p.kind} ` : "") + keyName(p, sourceCode);
  }
  if (p.type === "VariableDeclarator" && p.id.type === "Identifier") return p.id.name;
  if (p.type === "AssignmentExpression") return sourceCode.getText(p.left);
  if ((p.type === "CallExpression" || p.type === "NewExpression") && p.callee !== node) return callName(p);
  return p.type === "ExportDefaultDeclaration" ? "default" : "<anonymous>";
}

/** A class's name: its id or the variable it is bound to. */
function className(node) {
  if (node.id) return node.id.name;
  return node.parent.type === "VariableDeclarator" && node.parent.id.type === "Identifier" ? node.parent.id.name : "<class>";
}

/** ESLint rule that reports every function with its qualified name (Class.method, outer>inner; a repeat of the same
 *  name in a file gets #2, #3 in source order) at the place sonarjs reports it. Measurement only, never a finding. */
export const names = {
  meta: { type: "suggestion", schema: [] },
  create(context) {
    const { sourceCode } = context;
    const stack = []; // { name, cls }
    const seen = new Map();
    const enter = (name, cls) => {
      const top = stack[stack.length - 1];
      let full = top ? `${top.name}${top.cls ? "." : ">"}${name}` : name;
      const n = (seen.get(full) || 0) + 1;
      seen.set(full, n);
      if (n > 1) full += `#${n}`;
      stack.push({ name: full, cls });
      return full;
    };
    const leave = () => stack.pop();
    const visitors = {
      ClassDeclaration: (node) => enter(className(node), true),
      ClassExpression: (node) => enter(className(node), true),
      "ClassDeclaration:exit": leave,
      "ClassExpression:exit": leave,
    };
    for (const type of FUNCTIONS) {
      visitors[type] = (node) => context.report({ loc: reportLoc(node, sourceCode),
        message: enter(ownName(node, sourceCode), false) });
      visitors[`${type}:exit`] = leave;
    }
    return visitors;
  },
};

/** The ESLint of the ratchet: the quality config plus the naming rule. Inline configuration is off (review rev-s10
 *  F1): an `eslint-disable` comment, whole-file or for sonarjs alone, must not exempt a function. */
export async function createEslint() {
  const { ESLint } = await import("eslint");
  return new ESLint({
    cwd: ROOT, overrideConfigFile: path.join(ROOT, "eslint.quality.config.mjs"), warnIgnored: false, cache: false,
    allowInlineConfig: false,
    overrideConfig: { plugins: { complexity: { rules: { names } } }, rules: { "complexity/names": "warn" } },
  });
}

/** ESLint results as [{ file, name, line, score }] sorted by file and line. A score without a name stops the run: the
 *  join must never drop a function silently. */
export function collect(results) {
  const out = [];
  for (const result of results) {
    const file = path.relative(ROOT, result.filePath).split(path.sep).join("/");
    const fatal = result.messages.find((m) => m.fatal);
    if (fatal) throw new Error(`${file}:${fatal.line}: ${fatal.message}`);
    const at = new Map(result.messages.filter((m) => m.ruleId === "complexity/names")
      .map((m) => [`${m.line}:${m.column}`, m.message]));
    for (const m of result.messages.filter((x) => x.ruleId === "sonarjs/cognitive-complexity")) {
      const name = at.get(`${m.line}:${m.column}`);
      const score = SCORE.exec(m.message);
      if (!name || !score) {
        throw new Error(`${file}:${m.line}:${m.column}: cannot name or score "${m.message}"; did `
          + "eslint-plugin-sonarjs change where or how it reports?");
      }
      out.push({ file, name, line: m.line, score: Number(score[1]) });
    }
  }
  return out.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line));
}

/** Lint the files (or the repository) and return what collect() makes of it. */
export async function measure(files) {
  return collect(await (await createEslint()).lintFiles(files.length ? files : ["."]));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(`${JSON.stringify(await measure(process.argv.slice(2)))}\n`);
  } catch (err) {
    process.stderr.write(`complexity.mjs: ${err.message}\n`);
    process.exit(2);
  }
}
