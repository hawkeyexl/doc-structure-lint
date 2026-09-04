/**
 * Lint this repo's prose against the house voice, the way CI does.
 *
 * `vale` alone cannot back this check: its exit status is non-zero for
 * error-level alerts only, and the Moose package ships one warning-level rule
 * (`Voices.ColonReveal`). CI gates with reviewdog's `-fail-level=any`, so a
 * bare `vale .` would pass locally what the gate fails — the divergence a
 * single source of truth is supposed to prevent. This reads the JSON output
 * and fails on any alert at any severity.
 *
 *   npm run lint:prose          sync the package, then lint
 *   npm run lint:prose -- --no-sync   skip the fetch, for offline runs
 *
 * Exit status is set via `process.exitCode` rather than `process.exit()`, to
 * match the repo's other scripts and let stdout flush.
 */
import { spawnSync } from "node:child_process";

const sync = !process.argv.includes("--no-sync");

function vale(args) {
  const r = spawnSync("vale", args, { encoding: "utf8" });
  if (r.error?.code === "ENOENT") {
    console.error(
      "vale is not on your PATH. Install it from https://vale.sh/docs/install",
    );
    process.exitCode = 2;
    return null;
  }
  return r;
}

if (sync) {
  const r = vale(["sync"]);
  if (!r) process.exit();
  if (r.status !== 0) {
    console.error(r.stderr || r.stdout);
    console.error("vale sync failed; the rule set is not available.");
    process.exitCode = 2;
    process.exit();
  }
}

const run = vale(["--output=JSON", "."]);
if (!run) process.exit();

// Vale exits 2 on a configuration error and prints a message, not JSON.
let byFile;
try {
  byFile = JSON.parse(run.stdout);
} catch {
  console.error(run.stdout || run.stderr);
  process.exitCode = 2;
  process.exit();
}

const alerts = Object.entries(byFile).flatMap(([file, list]) =>
  list.map((a) => ({ file, ...a })),
);

if (alerts.length === 0) {
  console.log("✔ 0 alerts");
  process.exit();
}

for (const a of alerts) {
  console.log(
    `${a.file}:${a.Line}:${a.Span?.[0] ?? 1}  ${a.Severity}  ${a.Check}  ${a.Message}`,
  );
}
const files = new Set(alerts.map((a) => a.file)).size;
console.log(`\n✗ ${alerts.length} alert(s) in ${files} file(s)`);
process.exitCode = 1;
