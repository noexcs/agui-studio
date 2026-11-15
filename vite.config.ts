import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { aguiAliases } from "./config/agui-aliases";

const config = defineConfig({
  plugins: [react(), tailwindcss()],
  base: process.env.VITE_BASE || "./",
  resolve: { alias: aguiAliases, dedupe: ["react", "react-dom"] },
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
          radix: ["@radix-ui/react-tabs", "@radix-ui/react-tooltip", "@radix-ui/react-dialog", "@radix-ui/react-dropdown-menu"],
          icons: ["lucide-react"],
        },
      },
    },
  },
});

export default config;
