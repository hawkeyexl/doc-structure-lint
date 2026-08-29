/**
 * Resolve a mix of explicit files, directories, and globs into a concrete,
 * de-duplicated, sorted list of file paths (posix-style, relative to cwd).
 *
 * Directory and glob expansion is restricted to the extensions the parser
 * registry claims, never a hardcoded list. The pre-rewrite walker only ever
 * collected `.md`/`.markdown`, so registering a parser for a new format did
 * nothing at all for anyone who pointed the tool at a directory - the format
 * was supported in theory and invisible in practice.
 *
 * An explicitly named file is kept whatever its extension. The user asked
 * about that file, so an unreadable format has to come back as a reported skip
 * rather than as silence.
 */
import { stat } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";
import fg from "fast-glob";
import { MooseLintError } from "../types.js";
import { supportedExtensions } from "../parsers/index.js";

/**
 * Never walked into. Dotdirs are already excluded by fast-glob's `dot: false`;
 * `.git` is listed anyway because a user-supplied glob can name it outright.
 */
const DEFAULT_IGNORE = ["**/node_modules/**", "**/.git/**"];

/** Positional argument meaning "read the document from stdin". */
export const STDIN_TOKEN = "-";

function toPosix(p: string): string {
  return p.replace(/\\/g, "/");
}

/**
 * Display path: relative to cwd when the file is under it, absolute otherwise.
 * A file outside the working directory renders as a chain of `../` segments
 * that is longer and harder to read than the absolute path it stands for.
 */
function displayPath(cwd: string, abs: string): string {
  const rel = toPosix(relative(cwd, abs));
  return rel.startsWith("../") ? toPosix(abs) : rel;
}

/** Lowercase, with a leading dot, so `md` and `.MD` both compare equal. */
function normalizeExt(ext: string): string {
  const lower = ext.toLowerCase();
  return lower.startsWith(".") ? lower : `.${lower}`;
}

async function statOrNull(p: string) {
  try {
    return await stat(p);
  } catch {
    return null;
  }
}

/**
 * Walk a directory recursively, honoring the ignore globs.
 *
 * fast-glob patterns are resolved against `cwd`, so a directory argument has
 * to be relativized first - and a directory *outside* cwd relativizes to a
 * `../` chain. That form quietly breaks every ignore glob: a leading wildcard
 * will not cross a path segment beginning with a dot, and `..` is such a
 * segment, so the node_modules and .git defaults - and every user `--exclude` -
 * stop matching the returned entries. So the walk is anchored at the directory
 * itself whenever the cwd-relative pattern would escape cwd, which keeps the
 * entries, and therefore the ignores, well formed. A directory under cwd keeps
 * the cwd-relative pattern, so a cwd-relative `--exclude` still works there.
 *
 * Returns absolute paths; the caller decides how to display them.
 */
async function walkDirectory(
  cwd: string,
  abs: string,
  ignore: string[],
): Promise<string[]> {
  const base = toPosix(relative(cwd, abs));
  const anchorAtDir = base === "" || base.startsWith("..");
  const found = await fg(anchorAtDir ? "**/*" : `${base}/**/*`, {
    cwd: anchorAtDir ? abs : cwd,
    ignore,
    onlyFiles: true,
    dot: false,
  });
  return found.map((file) => resolve(anchorAtDir ? abs : cwd, file));
}

export interface ResolveOptions {
  /** Positional inputs: files, directories, or globs. `-` is skipped here. */
  inputs: string[];
  /** Extensions kept during dir/glob expansion (default: every supported one). */
  exts?: string[];
  /** Extra exclude globs, added to the node_modules/.git defaults. */
  exclude?: string[];
  cwd?: string;
}

/**
 * Expand `opts.inputs`. Throws when there are none: a linter that is handed
 * nothing and prints nothing looks exactly like a linter that found nothing
 * wrong, which is the worst possible way for a CI job to pass.
 */
export async function resolveTargets(opts: ResolveOptions): Promise<string[]> {
  if (opts.inputs.length === 0) {
    throw new MooseLintError(
      "No inputs. Pass one or more files, directories, or globs to lint (or - to read from stdin).",
    );
  }

  const cwd = opts.cwd ?? process.cwd();
  const exts = (opts.exts ?? supportedExtensions()).map(normalizeExt);
  const ignore = [...DEFAULT_IGNORE, ...(opts.exclude ?? [])];
  const out = new Set<string>();

  const keepByExt = (file: string): boolean =>
    exts.includes(extname(file).toLowerCase());

  for (const input of opts.inputs) {
    if (input === STDIN_TOKEN) continue;

    const abs = resolve(cwd, input);
    const st = await statOrNull(abs);

    if (st?.isFile()) {
      out.add(displayPath(cwd, abs));
      continue;
    }

    if (st?.isDirectory()) {
      for (const file of await walkDirectory(cwd, abs, ignore)) {
        if (keepByExt(file)) out.add(displayPath(cwd, file));
      }
      continue;
    }

    // Anything else is a glob pattern, which is cwd-relative by nature.
    const found = await fg(toPosix(input), {
      cwd,
      ignore,
      onlyFiles: true,
      dot: false,
    });
    for (const file of found) {
      if (keepByExt(file)) out.add(displayPath(cwd, resolve(cwd, file)));
    }
  }

  return [...out].sort();
}
