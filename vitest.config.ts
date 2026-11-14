import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { aguiAliases } from "./config/agui-aliases";

export default defineConfig({
  // one shared alias list drives dev / test / build (see config/agui-aliases.ts)
  plugins: [react()],
  resolve: { alias: aguiAliases, dedupe: ["react", "react-dom"] },
  optimizeDeps: { exclude: ["agui-skins"] },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
    css: true,
    testTimeout: 30_000,
    // Coverage scope: protocol core, skins package and the app components
    // that carry logic. App.tsx is wiring-only (covered by build + e2e
    // screenshots), shell presentation is exercised through the app tests.
    coverage: {
      provider: "v8",
      include: ["src/core/**", "src/shared/**", "src/app/**", "packages/agui-skins/src/**"],
      exclude: ["**/*.d.ts", "**/*.css", "src/app/App.tsx"],
      // thresholds are set ~5-8 points below the measured values so the gate
      // catches regressions without being a copy of today's exact numbers.
      thresholds: {
        lines: 70,
        statements: 70,
        branches: 65,
        functions: 55,
      },
    },
  },
});
