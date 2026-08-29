import { cp, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { defineConfig } from "tsup";

/**
 * Non-code assets that must ship inside `dist/` so the published package is
 * self-contained (`files: ["dist"]`).
 *
 * `src/schemas/*.json` is imported with `with { type: "json" }`, so esbuild
 * already inlines those into the bundle — copying them is belt-and-braces for
 * any code that instead resolves a schema by path at runtime.
 *
 * `src/templates/**\/*.yaml` is the real reason this step exists: YAML has no
 * import form esbuild understands, so the built-in doctype templates are read
 * from disk at runtime (relative to `import.meta.url`). Without the copy,
 * `dist/` would ship a CLI with no templates. The directory layout is
 * preserved, so `src/templates/foo/bar.yaml` lands at
 * `dist/templates/foo/bar.yaml` and a `new URL("./templates/...",
 * import.meta.url)` from `dist/cli.js` resolves.
 *
 * NOTE: this is a copy step, not tsup's `publicDir` — `publicDir` flattens a
 * directory's *contents* into the outDir root, which would drop the
 * `templates/` and `schemas/` prefixes.
 */
const ASSET_DIRS = ["src/templates", "src/schemas"] as const;

async function copyAssets(): Promise<void> {
  for (const dir of ASSET_DIRS) {
    if (!existsSync(dir)) continue;
    const dest = dir.replace(/^src\//, "dist/");
    await cp(dir, dest, {
      recursive: true,
      // Data files only: keep any co-located .ts loaders out of dist/.
      filter: async (source) =>
        (await stat(source)).isDirectory() || /\.(ya?ml|json)$/i.test(source),
    });
  }
}

export default defineConfig({
  entry: {
    cli: "src/cli.ts",
    index: "src/index.ts",
  },
  format: ["esm"],
  target: "node24",
  platform: "node",
  clean: true,
  // Declarations for the programmatic entry point only; nothing imports the CLI
  // as a module, so a cli.d.ts would just be dead weight.
  dts: { entry: { index: "src/index.ts" } },
  sourcemap: true,
  banner: {
    js: "#!/usr/bin/env node",
  },
  // Runs after the bundle is written (and after `clean` has wiped dist/).
  onSuccess: copyAssets,
});
