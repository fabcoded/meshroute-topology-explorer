// SPDX-License-Identifier: MIT
// Lint browser modules (sources and the generated bundle) and Node tests. Run npm run lint; see CONTRIBUTING.md.
import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["node_modules/**", "captures/**", "**/vendor/**", ".venv*/**"] },
  js.configs.recommended,
  {
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: { ecmaVersion: 2022, sourceType: "module" },
    rules: {
      "no-unused-vars": ["error", { args: "none", caughtErrors: "none", ignoreRestSiblings: true }],
      "eqeqeq": ["error", "always", { null: "ignore" }],
      "no-var": "error",
      "prefer-const": ["error", { destructuring: "all" }],
    },
  },
  { files: ["custom_components/**/*.js", "dev/**/*.js"], languageOptions: { globals: globals.browser } },
  // Shipped panel code: leftover debug output reaches every user's browser console.
  { files: ["custom_components/**/*.js"], rules: { "no-console": "error" } },
  { files: ["tests/**/*.mjs", "*.mjs"], languageOptions: { globals: globals.node } },
  {
    files: ["tests/**/*.test.mjs", "tests/**/*.budget.mjs"],
    rules: {
      "no-restricted-syntax": ["error", {
        selector: "CallExpression > MemberExpression.callee[property.name='only']",
        message: "Do not commit focused tests; the full suite must run.",
      }, {
        selector: "CallExpression > ObjectExpression.arguments > Property[key.name='only'][value.value=true]",
        message: "Do not commit focused tests; the full suite must run.",
      }],
    },
  },
];
