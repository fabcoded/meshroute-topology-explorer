// SPDX-License-Identifier: MIT
// Measurement only, not a lint rule set: cognitive complexity per function for tools/quality.py.
// Not used by pre-commit or npm run lint; see CONTRIBUTING.md "Quality report".
import sonarjs from "eslint-plugin-sonarjs";

export default [
  // The panel bundle repeats every source function (tools/bundle.mjs, issue #16): measured in the sources only.
  { ignores: ["node_modules/**", "captures/**", "**/vendor/**", ".venv*/**", "custom_components/*/frontend/dist/**"] },
  {
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: { ecmaVersion: 2022, sourceType: "module" },
    plugins: { sonarjs },
    rules: { "sonarjs/cognitive-complexity": ["warn", 15] },
  },
];
