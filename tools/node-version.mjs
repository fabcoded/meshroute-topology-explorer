// SPDX-License-Identifier: MIT
// Stops a run on a Node.js other than package.json's engines (22.13 or newer in the 22.x series, as CI and
// tools/check.py) with one line, instead of a stack trace from inside ESLint ("util.styleText is not a function" on
// Node 18). Callers: the npm lint script (node tools/node-version.mjs && ...) and tools/complexity.mjs (import).
import process from "node:process";

const [major, minor] = process.versions.node.split(".").map(Number);
if (major !== 22 || minor < 13) {
  const found = process.versions.node;
  process.stderr.write(`Use Node.js 22.13 or newer in the 22.x series (package.json engines); found v${found}.\n`);
  process.exit(2);
}
