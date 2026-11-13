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
  },
});
