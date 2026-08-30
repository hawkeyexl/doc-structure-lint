/**
 * Smoke-test the built package, not the source.
 *
 * The unit and integration suites run against `src/`, where the built-in
 * templates sit at `../templates/` relative to the module that reads them.
 * `tsup` bundles the library into one chunk at the root of `dist/`, where they
 * sit at `./templates/` instead — so a path that is correct in the repo can be
 * wrong in the published package, and every test still passes. That is exactly
 * how it happened once.
 *
 * This runs the real `dist/cli.js` the way a user would, and asserts the parts
 * that only exist after a build: that built-ins load, that a page routes by its
 * `type`, and that exit codes are what CI will branch on.
 *
 * Usage: npm run smoke   (runs `build` first)
 */
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const CLI = "dist/cli.js";

let failures = 0;

/** Run the built CLI and return `{ code, stdout, stderr }` without throwing. */
async function cli(args, options = {}) {
  // `cwd` matters for config discovery; the CLI path stays absolute so it
  // resolves from wherever the run happens.
  const cliPath = options.cwd ? resolve(CLI) : CLI;
  try {
    const { stdout, stderr } = await run(process.execPath, [cliPath, ...args], options);
    return { code: 0, stdout, stderr };
  } catch (err) {
    return { code: err.code ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
}

function check(name, ok, detail) {
  if (ok) {
    console.log(`  ok    ${name}`);
    return;
  }
  failures++;
  console.error(`  FAIL  ${name}`);
  if (detail) console.error(`        ${String(detail).trim().split("\n").join("\n        ")}`);
}

const dir = await mkdtemp(join(tmpdir(), "moose-lint-smoke-"));
try {
  console.log(`smoke: ${CLI}`);

  const formats = await cli(["formats"]);
  check(
    "formats lists markdown as implemented",
    formats.code === 0 && /markdown.*implemented/s.test(formats.stdout),
    formats.stderr || formats.stdout,
  );

  // The packaging case: built-ins are YAML files copied into dist, read at
  // runtime. If the copy or the path is wrong, this is where it shows.
  const templates = await cli(["templates"]);
  check(
    "templates lists the built-in doctype templates",
    templates.code === 0 && templates.stdout.includes("tgdp:how-to:1.6"),
    templates.stderr || templates.stdout,
  );

  const upstream = await cli([
    "test/fixtures/tgdp/template_how-to.md",
    "-t",
    "tgdp:how-to:1.6",
  ]);
  check(
    "a built-in loads and lints its own upstream template clean (exit 0)",
    upstream.code === 0 && upstream.stdout.includes("1 passed"),
    upstream.stderr || upstream.stdout,
  );

  const typed = join(dir, "typed.md");
  await writeFile(
    typed,
    "---\ntype: how-to\n---\n\n# Do it\n\n## Overview\n\nWhy.\n\n## Step\n\nHow.\n\n## See also\n",
  );
  const routed = await cli([typed]);
  check(
    "a page routes by its type with no --template (exit 0)",
    routed.code === 0 && routed.stdout.includes("1 passed"),
    routed.stderr || routed.stdout,
  );

  const untyped = join(dir, "untyped.md");
  await writeFile(untyped, "# No type here\n");
  const skipped = await cli([untyped, typed]);
  check(
    "an untyped page beside a typed one is skipped, not failed (exit 0)",
    skipped.code === 0 && skipped.stdout.includes("skipped"),
    skipped.stderr || skipped.stdout,
  );

  // The other half of the same contract: a run that finds files and checks none
  // of them must not exit 0, or a repo adopting the tool before backfilling
  // `type:` keys gets a permanently green CI job over an unchecked docset.
  const nothingChecked = await cli([untyped]);
  check(
    "a run that checks nothing fails loudly (exit 2)",
    nothingChecked.code === 2 &&
      nothingChecked.stderr.includes("Nothing was checked"),
    nothingChecked.stdout || nothingChecked.stderr,
  );

  const mistyped = join(dir, "mistyped.md");
  await writeFile(mistyped, "---\ntype: how-two\n---\n\n# Typo\n");
  const unknown = await cli([mistyped]);
  check(
    // "how-to" alone matched too loosely: it appears in the known-doctypes
    // list, in template ids, and in any number of future outputs, so the check
    // would have passed on a run that suggested nothing at all.
    "an unknown type fails with a suggestion (exit 1)",
    unknown.code === 1 &&
      unknown.stdout.includes("Did you mean") &&
      unknown.stdout.includes('"how-to"'),
    unknown.stderr || unknown.stdout,
  );

  // Every implemented format, through the built package, against one built-in.
  // The vitest suite proves parity from `src/`; this proves the parsers and
  // their dependencies survive bundling.
  const formatsList = await cli(["formats", "-f", "json"]);
  let implementedExts = [];
  try {
    implementedExts = JSON.parse(formatsList.stdout)
      .filter((f) => f.implemented)
      .map((f) => f.extensions[0]);
  } catch {
    implementedExts = [];
  }
  const fixtures = implementedExts.map((ext) => `test/fixtures/formats/how-to${ext}`);
  const everyFormat = await cli(fixtures);
  check(
    `one template lints all ${fixtures.length} implemented formats clean`,
    fixtures.length > 0 &&
      everyFormat.code === 0 &&
      everyFormat.stdout.includes(`${fixtures.length} passed`),
    everyFormat.stderr || everyFormat.stdout,
  );

  // SARIF is what a CI code-scanning upload consumes, so a malformed envelope
  // is only discovered by whoever configured the upload.
  const sarif = await cli([
    "test/fixtures/tgdp/template_how-to.md",
    "-t",
    "tgdp:how-to:1.6",
    "-f",
    "sarif",
  ]);
  let sarifOk = false;
  try {
    const doc = JSON.parse(sarif.stdout);
    sarifOk =
      doc.version === "2.1.0" &&
      Array.isArray(doc.runs) &&
      doc.runs[0]?.tool?.driver?.name === "moose-lint";
  } catch {
    sarifOk = false;
  }
  check("-f sarif emits a well-formed SARIF 2.1.0 document", sarifOk, sarif.stderr || sarif.stdout);

  // Config discovery walks up from the working directory, which only exercises
  // the real path when the CLI is run from somewhere other than the repo root.
  const configured = join(dir, "docs");
  await mkdir(configured, { recursive: true });
  await writeFile(
    join(dir, "moose.config.yaml"),
    [
      "meta:",
      '  schemas: ["google:okf:0.1"]',
      "",
      "lint:",
      '  paths: ["docs/**/*.md"]',
      "",
    ].join("\n"),
  );
  await writeFile(
    join(configured, "page.md"),
    [
      "---",
      "type: how-to",
      "title: Do it",
      "---",
      "",
      "## Overview",
      "",
      "Why.",
      "",
      "## Step",
      "",
      "How.",
      "",
      "## See also",
      "",
    ].join("\n"),
  );
  const fromConfig = await cli([], { cwd: dir });
  check(
    "a bare run takes its targets from moose.config.yaml, ignoring sibling keys",
    fromConfig.code === 0 && fromConfig.stdout.includes("1 passed"),
    fromConfig.stderr || fromConfig.stdout,
  );

  // `paths:` naming a directory rather than a glob, with an `exclude:`. The CLI
  // makes every config glob absolute (so a config means the same thing from any
  // working directory), while a directory input walks with a cwd-relative
  // pattern - so this is an absolute ignore filtering relative entries. If that
  // ever stops matching, `exclude:` silently covers nothing: the drafts get
  // linted, and because they are drafts the run starts failing on documents the
  // repo deliberately excluded.
  const excluded = join(dir, "excluded");
  await mkdir(join(excluded, "docs", "drafts"), { recursive: true });
  await writeFile(
    join(excluded, "moose.config.yaml"),
    ["lint:", '  paths: ["docs"]', '  exclude: ["**/drafts/**"]', ""].join("\n"),
  );
  await writeFile(
    join(excluded, "docs", "page.md"),
    "---\ntype: how-to\ntitle: Do it\n---\n\n## Overview\n\nWhy.\n\n## Step\n\nHow.\n\n## See also\n",
  );
  // Would fail the how-to template outright if the exclude stopped working.
  await writeFile(
    join(excluded, "docs", "drafts", "wip.md"),
    "---\ntype: how-to\ntitle: Half written\n---\n\n## Overview\n",
  );
  const withExclude = await cli([], { cwd: excluded });
  check(
    "a directory in paths: honors exclude: (exit 0, drafts not linted)",
    withExclude.code === 0 &&
      withExclude.stdout.includes("1 passed") &&
      !withExclude.stdout.includes("wip.md"),
    withExclude.stderr || withExclude.stdout,
  );

  const missing = await cli(["no-such-file.md", "-t", "tgdp:how-to:1.6"]);
  check(
    "an operational error exits 2",
    missing.code === 2,
    missing.stderr || missing.stdout,
  );
} finally {
  await rm(dir, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\nsmoke: ${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nsmoke: all checks passed");
