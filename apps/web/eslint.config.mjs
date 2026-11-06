import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "no-restricted-syntax": ["error", {
        selector: ":function:has(CallExpression[callee.name='useActionState']) CallExpression[callee.property.name='bind']",
        message: "Pass IDs to useActionState actions in hidden form fields. An action bound here is new on every render, so rendering the page after a form post retries forever and hangs the server.",
      }],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
