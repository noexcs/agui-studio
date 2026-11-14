import { fileURLToPath } from "node:url";

/**
 * Single source of the agui-skins subpath aliases for every bundler config
 * (vite.config.ts / vitest.config.ts).
 *
 * Why aliases instead of "just resolve the workspace package"? The package's
 * `exports` point at dist/ for npm consumers, but this repo must dev/test
 * against the live src/ so package edits hot-reload and tests can never pass
 * against a stale build. tsconfig.json keeps the same mappings for the IDE —
 * both lists live next to each other and are checked by test:package.
 */
const at = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export const aguiAliases = [
  { find: /^agui-skins$/, replacement: at("../packages/agui-skins/src/index.ts") },
  { find: /^agui-skins\/i18n$/, replacement: at("../packages/agui-skins/src/i18n/index.ts") },
  { find: /^agui-skins\/contract$/, replacement: at("../packages/agui-skins/src/contract.ts") },
  {
    find: /^agui-skins\/skins\/([\w-]+)$/,
    replacement: at("../packages/agui-skins/src/skins/$1/index.tsx"),
  },
];
