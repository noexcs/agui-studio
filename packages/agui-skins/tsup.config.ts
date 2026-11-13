import { defineConfig } from "tsup";

/**
 * npm distribution build for agui-skins.
 *
 * JS + dts: one entry per public export subpath (`.` / `./i18n` / `./contract`
 * / `./skins/*`). `splitting: true` is required — i18n language state and the
 * host context are module-level singletons, so duplicating them across entries
 * (splitting:false) would break the documented mixed usage of
 * `SkinHostProvider` from "agui-skins" + a skin from "agui-skins/skins/*".
 * Shared code (host/i18n/shared components) is emitted into chunk-*.js which
 * every entry imports.
 *
 * CSS: esbuild strips the source's side-effect css imports from the JS output
 * and emits one stable css file per entry, each a complete union of everything
 * that entry needs: dist/index.css = tuning.css + all five skins,
 * dist/skins/<skin>.css = tuning.css + that skin. They are exposed as
 * `agui-skins/index.css` and `agui-skins/skins/*.css`; consumers add one
 * explicit css import — the standard ship-CSS-separately pattern
 * (reactflow / react-day-picker style).
 */
export default defineConfig({
  entry: {
    index: "src/index.ts",
    i18n: "src/i18n/index.ts",
    contract: "src/contract.ts",
    "skins/aurora": "src/skins/aurora/index.tsx",
    "skins/paper": "src/skins/paper/index.tsx",
    "skins/terminal": "src/skins/terminal/index.tsx",
    "skins/brutalist": "src/skins/brutalist/index.tsx",
    "skins/classic": "src/skins/classic/index.tsx",
  },
  format: ["esm"],
  dts: true,
  splitting: true,
  sourcemap: true,
  clean: true,
  tsconfig: "tsconfig.json",
});
