/**
 * Tailwind v4 compilation step for the agui-skins npm package (task-13 Phase 2).
 *
 * tsup emits dist/skins/<id>.css as the union of the skin's residual CSS
 * (tokens/keyframes/pseudo-elements) plus tuning.css — but since task-13, the
 * skins' element styling lives in Tailwind utilities written on the TSX, which
 * esbuild cannot see. Without this step the npm CSS ships without utilities
 * and consumers get unstyled migrated skins (Phase 1 report §6/§8).
 *
 * How it works, per tailwind/skin-<id>.css entry (the list of migrated skins
 * is exactly the set of these files — add one per migrated skin):
 *   1. @tailwindcss/cli compiles the entry (theme layer + utilities layer,
 *      sources = that skin's TSX + shared/ + host.tsx + utils.ts, source(none)
 *      so the CLI never scans dist/) into a utilities-only block;
 *   2. the block is concatenated with tsup's dist/skins/<id>.css — residual
 *      CSS stays unlayered on top, utilities land in @layer utilities.
 *      Unlayered rules beat layered utilities regardless of source order, so
 *      this reproduces the studio cascade (skin CSS wins where they must not
 *      collide; by convention they never style the same element+property).
 * dist/index.css gets one package-wide scan (tailwind/index.css).
 *
 * Run: node scripts/build-tailwind.mjs  (after tsup; wired into `pnpm build`)
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const tailwindDir = join(pkgDir, "tailwind");
const distDir = join(pkgDir, "dist");

// entries: tailwind/index.css -> dist/index.css, tailwind/skin-<id>.css -> dist/skins/<id>.css
const entries = readdirSync(tailwindDir)
  .filter((file) => file.endsWith(".css"))
  .map((file) =>
    file === "index.css"
      ? { id: "index", entry: join(tailwindDir, file), out: join(distDir, "index.css") }
      : { id: file.replace(/^skin-(.+)\.css$/, "$1"), entry: join(tailwindDir, file), out: join(distDir, "skins", file.replace(/^skin-/, "")) }
  );

if (!entries.some((entry) => entry.id === "index")) {
  console.error("✗ tailwind/index.css missing — the package-wide scan entry is required");
  process.exit(1);
}

const cliBin = join(pkgDir, "node_modules", ".bin", "tailwindcss");
const scratch = mkdtempSync(join(tmpdir(), "agui-skins-tw-"));

let failures = 0;
for (const { id, entry, out } of entries) {
  if (!exists(out)) {
    console.error(`✗ ${out} missing — run tsup before this script`);
    failures++;
    continue;
  }
  const compiled = join(scratch, `${id}.css`);
  try {
    execFileSync(cliBin, ["-i", entry, "-o", compiled, "--cwd", pkgDir], { stdio: ["ignore", "pipe", "inherit"] });
  } catch {
    console.error(`✗ tailwind compile failed for ${id}`);
    failures++;
    continue;
  }
  const raw = readFileSync(compiled, "utf8");
  // v4.3's CLI emits the utilities layer as `@media layer(utilities)` — a
  // cascade-layer media condition browsers do not parse yet (verified in
  // Chrome for Testing: the whole block is dropped, styles never apply). The
  // vite plugin down-levels this via lightningcss; the CLI does not, so we do
  // the equivalent here: exactly one occurrence wraps the utilities layer and
  // `@layer utilities { … }` is the supported same-shape result the studio
  // build ships (inner @media variants stay nested inside).
  if (!/@media layer\(utilities\)/.test(raw)) {
    console.error(`✗ utilities compile for ${id} has no @media layer(utilities) wrapper — unexpected emitter shape`);
    failures++;
    continue;
  }
  const utilities = raw.replace(/@media layer\(utilities\)/, "@layer utilities");
  if (/layer\((?!#)[a-z-]+\)/.test(utilities) && /@media layer\(/.test(utilities)) {
    console.error(`✗ unhandled @media layer(...) left in ${id} output`);
    failures++;
    continue;
  }
  // A healthy compile carries hundreds of class selectors (indented `.` / `[`
  // selector heads) — a broken @source glob yields only the skeleton.
  const ruleCount = (utilities.match(/^[ \t]*[.\[]/gm) ?? []).length;
  if (ruleCount < 20) {
    console.error(`✗ utilities block for ${id} looks empty (${ruleCount} selector lines) — @source globs may have missed the TSX`);
    failures++;
    continue;
  }
  writeFileSync(out, spliceUtilities(readFileSync(out, "utf8"), utilities));
  console.log(`✓ dist/${id === "index" ? "index.css" : `skins/${id}.css`} + utilities (${utilities.length} bytes)`);
}

rmSync(scratch, { recursive: true, force: true });
process.exit(failures ? 1 : 0);

/** Insert the utilities block before a trailing sourceMappingURL comment (the map covers only the residual part and must stay last). */
function spliceUtilities(residual, utilities) {
  const map = residual.match(/\s*\/\*# sourceMappingURL=[^*]+\*\/\s*$/);
  if (!map) return `${residual.trimEnd()}\n${utilities}`;
  return `${residual.slice(0, map.index).trimEnd()}\n${utilities}\n${map[0].trim()}\n`;
}

function exists(path) {
  try {
    readdirSync(dirname(path));
    readFileSync(path);
    return true;
  } catch {
    return false;
  }
}
