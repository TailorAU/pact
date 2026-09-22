import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * #1160 Round 3 — Vitest bootstrap for Source unit tests.
 *
 * Keep this minimal: we only use Vitest for deterministic pure-TS libraries
 * under `src/lib/**`. Next.js app routes still run through `npm run build`
 * for end-to-end type checking.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
