import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // Enforce structured logging — no raw console.* calls in API routes.
  // All logging must go through @/lib/logger so every call carries
  // a structured `op` field and auto-correlates with the request-ID
  // from AsyncLocalStorage (WS1).
  {
    files: ["src/app/api/**/*.ts"],
    rules: {
      "no-console": "error",
    },
  },
]);

export default eslintConfig;
