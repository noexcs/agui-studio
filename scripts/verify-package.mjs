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
 *     claim and the build have diverged again),
 *   - a Tailwind-migrated skin's dist CSS lacks its utilities block
 *     (task-13 Phase 2: element styling lives in utilities on the TSX; a
 *     broken Tailwind compile would ship "valid but empty" CSS — silent).
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
const skins = [
  "aurora",
  "paper",
  "terminal",
  "brutalist",
  "classic",
  "particle",
  "workbench",
  "dash",
  "bubble",
  "orbit",
];
// Tailwind-migrated skins = the per-skin compilation entries present in
// packages/agui-skins/tailwind/ (single source of truth, grows per Phase 2
// skin commit). Each must ship a utilities block inside its dist CSS.
const migratedSkins = existsSync(join(pkgDir, "tailwind"))
  ? readdirSync(join(pkgDir, "tailwind"))
      .filter((file) => /^skin-.+\.css$/.test(file))
      .map((file) => file.replace(/^skin-(.+)\.css$/, "$1"))
  : [];

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
  // Orbit ships its own CJK subset. No shipped code (or source map) may point
  // at a font CDN at runtime: troika's unicode-font-resolver picked
  // Mongolian/Nushu/Yi fonts for common Chinese punctuation and left the 3D
  // text blank when the CDN was unreachable.
  for (const file of files.filter((item) => item.endsWith(".js") || item.endsWith(".map"))) {
    const source = readFileSync(join(dist, file), "utf8");
    check(
      !/cdn\.jsdelivr\.net|fonts\.gstatic\.com|unpkg\.com|use\.typekit\.net/i.test(source),
      `dist/${file} references a remote font/CDN — fonts must be self-contained`
    );
  }

  // The bundled font must actually be in the published artifact, large
  // enough to be a real subset (not a stub/error payload saved as .woff).
  const fontAssets = files.filter((file) => /\.woff2?$/.test(file));
  check(fontAssets.length > 0, "no bundled WOFF/WOFF2 font in dist — orbit text would fall back to a CDN");
  for (const asset of fontAssets) {
    const size = statSync(join(dist, asset)).size;
    check(size > 100_000, `dist/${asset} is only ${size} bytes — bundled font looks truncated`);
  }
  check(
    fontAssets.some((file) => /NotoSansSC/i.test(file)),
    "bundled Noto Sans SC subset missing from dist (orbit fonts/)"
  );

  // Content assertions: a migrated skin's dist CSS must carry its compiled
  // Tailwind utilities — `@layer utilities` present plus a real body of
  // arbitrary-value selectors (`bg-(--sk-…)` style, the site-wide variable
  // convention; ≥20 keeps the bar far above the skeleton but below any real
  // skin). dist/index.css is the documented all-skins union, so once any skin
  // is migrated it must contain utilities too.
  if (migratedSkins.length > 0) {
    for (const skin of migratedSkins) {
      const cssPath = join(dist, "skins", `${skin}.css`);
      if (!existsSync(cssPath)) continue; // already covered by the required-files check
      const css = readFileSync(cssPath, "utf8");
      const arbSelectors = (css.match(/\\[(\[]/g) ?? []).length;
      check(css.includes("@layer utilities"), `dist/skins/${skin}.css lacks an @layer utilities block — Tailwind compile step did not run (build-tailwind.mjs)`);
      check(arbSelectors >= 20, `dist/skins/${skin}.css carries only ${arbSelectors} arbitrary-value utility selectors — utilities look missing/empty`);
      check(!css.includes("@media layer("), `dist/skins/${skin}.css contains an unparsed @media layer(...) wrapper — browsers drop the whole utilities block (build-tailwind.mjs must down-level it)`);
    }
    const indexCss = readFileSync(join(dist, "index.css"), "utf8");
    const indexArb = (indexCss.match(/\\[(\[]/g) ?? []).length;
    check(indexCss.includes("@layer utilities"), "dist/index.css lacks @layer utilities — the package-wide Tailwind scan (tailwind/index.css) did not run");
    check(indexArb >= 20, `dist/index.css carries only ${indexArb} arbitrary-value utility selectors — utilities look missing/empty`);
  }
}

// tarball contents (npm pack --dry-run --json)
try {
  const packed = JSON.parse(
    execSync("npm pack --dry-run --json", { cwd: pkgDir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  );
  // npm >= 12 returns an object keyed by package name; older npm returned an
  // array of package objects. Support both shapes.
  const pkg = Array.isArray(packed) ? packed[0] : packed[Object.keys(packed)[0]];
  const packedFiles = (pkg?.files ?? []).map((file) => file.path);
  for (const file of ["dist/index.js", "dist/index.d.ts", "dist/index.css", ...skins.map((s) => `dist/skins/${s}.css`)]) {
    check(packedFiles.includes(file), `npm tarball omits ${file}`);
  }
  check(
    packedFiles.some((file) => /\.woff2?$/.test(file) && /NotoSansSC/i.test(file)),
    "npm tarball omits the bundled Noto Sans SC subset — orbit would fall back to a CDN font"
  );
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
