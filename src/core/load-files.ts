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
 * The recursive glob for a directory input, expressed relative to `cwd`.
 *
 * fast-glob patterns are resolved against `cwd`, so an absolute directory
 * argument - or a Windows path with backslashes - has to be relativized first
 * or the pattern matches nothing at all.
 */
function dirPattern(cwd: string, abs: string): string {
  const base = toPosix(relative(cwd, abs));
  return base === "" || base === "." ? "**/*" : `${base}/**/*`;
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

    // A directory walks recursively; anything else is treated as a glob.
    const pattern = st?.isDirectory() ? dirPattern(cwd, abs) : toPosix(input);
    const found = await fg(pattern, {
      cwd,
      ignore,
      onlyFiles: true,
      dot: false,
    });
    // fast-glob returns paths relative to `cwd`, which escape it as `../`
    // chains when the target is elsewhere on disk.
    for (const file of found) {
      if (keepByExt(file)) out.add(displayPath(cwd, resolve(cwd, file)));
    }
  }

  return [...out].sort();
}
