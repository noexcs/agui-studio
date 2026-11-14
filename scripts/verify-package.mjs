/**
 * Package smoke test for agui-skins.
 *
 * Regression target: the npm build must actually ship JS + d.ts + CSS. A
 * previous revision documented "import the skin entry and the CSS comes with
 * it", while tsup correctly stripped CSS from the JS — so consumers ended up
 * with unstyled pages. This script fails if:
 *   - dist/ or its required files are missing,
 *   - the published tarball would omit CSS,
 *   - the JS tries to import CSS (which would mean the docs' "bundled CSS"
 *     claim and the build have diverged again).
 *
 * Run: node scripts/verify-package.mjs  (after `pnpm --filter agui-skins build`)
 */
import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const pkgDir = join(root, "packages", "agui-skins");
const dist = join(pkgDir, "dist");
const skins = ["aurora", "paper", "terminal", "brutalist", "classic"];

const errors = [];
const check = (ok, message) => {
  if (!ok) errors.push(message);
};

check(existsSync(dist), "packages/agui-skins/dist is missing — run `pnpm --filter agui-skins build`");

if (existsSync(dist)) {
  const required = [
    "index.js",
    "index.d.ts",
    "index.css",
    "i18n.js",
    "contract.js",
    ...skins.flatMap((skin) => [`skins/${skin}.js`, `skins/${skin}.d.ts`, `skins/${skin}.css`]),
  ];
  for (const file of required) check(existsSync(join(dist, file)), `missing dist/${file}`);

  const files = readdirSync(dist, { recursive: true }).map(String);
  check(
    files.some((file) => /^chunk-.*\.js$/.test(file)),
    "no chunk-*.js emitted — tsup splitting is required for shared host/i18n state"
  );

  const jsFiles = files.filter((file) => file.endsWith(".js"));
  for (const file of jsFiles) {
    const source = readFileSync(join(dist, file), "utf8");
    check(!/from\s+["'][^"']+\.css["']/.test(source), `dist/${file} imports CSS — CSS must stay a separate entry`);
  }
}

// tarball contents (npm pack --dry-run --json)
try {
  const packed = JSON.parse(
    execSync("npm pack --dry-run --json", { cwd: pkgDir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  );
  const packedFiles = (packed[0]?.files ?? []).map((file) => file.path);
  for (const file of ["dist/index.js", "dist/index.d.ts", "dist/index.css", ...skins.map((s) => `dist/skins/${s}.css`)]) {
    check(packedFiles.includes(file), `npm tarball omits ${file}`);
  }
} catch (error) {
  errors.push(`npm pack --dry-run failed: ${error instanceof Error ? error.message : String(error)}`);
}

if (errors.length) {
  console.error("✗ agui-skins package verification failed:\n" + errors.map((error) => `  - ${error}`).join("\n"));
  process.exit(1);
}
console.log(
  `✓ agui-skins package OK — JS + d.ts + CSS for ${skins.length} skins, CSS not imported from JS, tarball complete`
);
