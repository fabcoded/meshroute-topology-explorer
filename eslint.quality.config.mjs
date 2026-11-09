// SPDX-License-Identifier: MIT
// Measurement only, not a lint rule set: cognitive complexity per function for tools/quality.py and the complexity
// ratchet (tools/complexity.mjs, pre-commit hook `complexity`); not used by npm run lint. See docs/quality.md.
import sonarjs from "eslint-plugin-sonarjs";

export default [
  // The panel bundle repeats every source function (tools/bundle.mjs, issue #16): measured in the sources only.
  // No vendor/ exemption (review rev-s10 F5): no vendored code exists, and new code under any vendor/ directory is
  // measured; vendored code would be named here by its path.
  { ignores: ["node_modules/**", "captures/**", ".venv*/**", "custom_components/*/frontend/dist/**"] },
  {
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: { ecmaVersion: 2022, sourceType: "module" },
    plugins: { sonarjs },
    rules: { "sonarjs/cognitive-complexity": ["warn", 15] },
  },
];
