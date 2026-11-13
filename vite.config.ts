import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * agui-skins is consumed from TS source inside this workspace, even though the
 * package's `exports` now point at dist/ (for npm publishing). These aliases
 * keep dev/test/build on src/ so the main site never depends on a built dist.
 * Keep in sync with tsconfig.json "paths" (they mirror the same subpaths).
 * Shared with vitest.config.ts.
 */
export const skinsAliases = [
  {
    find: /^agui-skins$/,
    replacement: fileURLToPath(new URL("./packages/agui-skins/src/index.ts", import.meta.url)),
  },
  {
    find: /^agui-skins\/i18n$/,
    replacement: fileURLToPath(new URL("./packages/agui-skins/src/i18n/index.ts", import.meta.url)),
  },
  {
    find: /^agui-skins\/contract$/,
    replacement: fileURLToPath(new URL("./packages/agui-skins/src/contract.ts", import.meta.url)),
  },
  {
    find: /^agui-skins\/skins\/([\w-]+)$/,
    replacement: fileURLToPath(new URL("./packages/agui-skins/src/skins/$1/index.tsx", import.meta.url)),
  },
];

export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE || "./",
  resolve: { alias: skinsAliases },
  optimizeDeps: { exclude: ["agui-skins"] },
  server: {
    port: 5178,
    strictPort: true,
    host: "127.0.0.1",
    watch: {
      // atomic-save temp dirs (and the studio's own artifacts) must not be watched
      ignored: ["**/*tmpdir/**", "**/.*tmpdir/**", "**/shots/**", "**/node_modules/**"],
    },
  },
  build: {
    target: "es2020",
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom"],
          markdown: ["react-markdown", "remark-gfm"],
          radix: ["@radix-ui/react-tabs", "@radix-ui/react-tooltip", "@radix-ui/react-dialog"],
          icons: ["lucide-react"],
        },
      },
    },
  },
});
