/**
 * Is the TGDP pin still current?
 *
 * The built-in doctype templates are derived by hand from The Good Docs
 * Project's published templates at a specific release, and their ids carry that
 * release (`tgdp:how-to:1.6`). A version in an id is a promise about which
 * upstream revision the template mirrors, and a promise nobody checks decays
 * quietly — so this asks the registry what the latest release is and compares.
 *
 * It is a report, not a gate: upstream moving does not make the pinned
 * templates wrong, it makes them old. Run it in a scheduled job or by hand.
 *
 *   npm run check:tgdp-pin              report; exit 0 even when behind
 *   npm run check:tgdp-pin -- --strict  exit 1 when behind, for a nagging CI job
 *
 * Exit status is set via `process.exitCode`, never `process.exit()`: calling the
 * latter while `fetch`'s handles are still unwinding aborts the process on
 * Windows with a libuv assertion and reports 127, which reads as a failure of
 * the check rather than of the exit.
 */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const manifestPath = join(here, "..", "src", "templates", "tgdp", "manifest.json");
const strict = process.argv.includes("--strict");

/** `v1.6.0` -> `[1, 6, 0]`; unparseable segments sort as 0. */
function parts(tag) {
  return String(tag)
    .replace(/^v/, "")
    .split(".")
    .map((n) => Number.parseInt(n, 10) || 0);
}

function isNewer(candidate, current) {
  const a = parts(candidate);
  const b = parts(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

/** Latest release tag, or null with the reason already reported. */
async function latestRelease(upstream) {
  const project = encodeURIComponent("tgdp/templates");
  const api = `https://gitlab.com/api/v4/projects/${project}/releases?per_page=1`;
  try {
    const res = await fetch(api, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const tag = (await res.json())[0]?.tag_name;
    if (!tag) {
      console.error("check:tgdp-pin: upstream reported no releases.");
      return null;
    }
    return tag;
  } catch (err) {
    // A network problem is not a finding about the pin. Say so and stop.
    console.error(`check:tgdp-pin: could not reach ${upstream}: ${err.message}`);
    return null;
  }
}

function howToMoveThePin(manifest, latest) {
  return [
    "",
    `check:tgdp-pin: upstream has moved to ${latest}.`,
    "",
    "The pinned templates are not wrong, only older. To move the pin:",
    `  1. re-vendor each entry's \`source\` from ${manifest.upstream} at ${latest}`,
    "     into test/fixtures/tgdp/ (verbatim — it is the authority),",
    "  2. run the suite; test/integration/tgdp.test.ts fails wherever a",
    "     built-in no longer matches the template it was derived from,",
    "  3. update those templates, and bump both the `pin` and every id's",
    "     version in src/templates/tgdp/manifest.json.",
    "",
    "Bump the ids even when a template needs no change: the version in an id",
    "states which upstream revision it mirrors, and leaving it behind makes it a",
    "claim nobody can check.",
  ].join("\n");
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const latest = await latestRelease(manifest.upstream);

if (latest === null) {
  if (strict) process.exitCode = 1;
} else {
  console.log(`pinned:  ${manifest.pin}`);
  console.log(`latest:  ${latest}`);
  console.log(`derived: ${manifest.templates.length} built-in template(s)`);

  if (isNewer(latest, manifest.pin)) {
    console.log(howToMoveThePin(manifest, latest));
    if (strict) process.exitCode = 1;
  } else {
    console.log("\ncheck:tgdp-pin: up to date.");
  }
}
