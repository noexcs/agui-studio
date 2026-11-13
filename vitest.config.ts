import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { skinsAliases } from "./vite.config";

export default defineConfig({
  plugins: [react()],
  // tests must resolve agui-skins from src, not from the published dist
  resolve: { alias: skinsAliases },
  optimizeDeps: { exclude: ["agui-skins"] },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
    css: true,
    // Coverage scope: protocol core + shared UI helpers + skins package.
    // src/app (shell UI), src/i18n (shell translations), tests/, scripts/
    // and server/ are intentionally out of scope; src/core must stay counted.
    coverage: {
      provider: "v8",
      include: ["src/core/**", "src/shared/**", "packages/agui-skins/src/**"],
      exclude: ["**/*.d.ts", "**/*.css"],
      // Measured on 2026-11-14 (vitest 3.2.7, v8 provider):
      // lines/statements 85.43, branches 78.79, functions 59.29.
      // -> gates at 70 where measured >= 70; functions floors at 59 (the
      //    measured value, see task-5-report.md for the gap breakdown).
      thresholds: {
        lines: 70,
        statements: 70,
        branches: 70,
        functions: 59,
      },
    },
  },
});
