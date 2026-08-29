/**
 * The `lint:` section of `moose.config.yaml`.
 *
 * The file is shared across the moose family - moose-docevals, moose-meta and
 * this tool all read one file per repo, each taking its own top-level key. So
 * the root is a mapping of tool name to that tool's settings, and moose-lint
 * reads `lint:` and nothing else: sibling keys are neither read nor validated,
 * which is what keeps the family decoupled - no registry of known tools, no
 * coordination, no version coupling. See agentevals ADR 01009.
 *
 * That leaves the root unvalidatable by any single tool, so the two ways an
 * author can lose a whole config to this convention are caught by shape
 * instead: keys left at the top level, and a wrapper differing only in case. A
 * wrapper misspelled any other way (`lnt:`) is indistinguishable from another
 * tool's section and still yields defaults - the accepted cost of having no
 * registry.
 *
 * Inside the section, `config.json` is the authority and `additionalProperties`
 * is false at every level, so a typo'd key is a loud failure rather than a
 * silent default. Defaults themselves live with the consumers, not here: this
 * returns exactly what the author wrote.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import * as AjvNs from "ajv";
import type { ErrorObject, SchemaObject, ValidateFunction } from "ajv";
import configSchema from "../schemas/config.json" with { type: "json" };
import { MooseLintError } from "../types.js";
import type { TemplateOverride } from "./resolve-template.js";

// ajv is CommonJS with a default export; under NodeNext the constructable
// value is on `.default`, which the namespace import reaches without the
// esModuleInterop-only call signature TypeScript otherwise complains about.
type AjvCtor = typeof import("ajv").default;
const Ajv = AjvNs.default as unknown as AjvCtor;

/**
 * Everything the `lint:` section can carry. Every key is optional, and an
 * absent one means "the consumer's default", never a value written in here.
 *
 * `overrides[].template` and the `types` values are template refs, left as the
 * strings they were written as: `resolve-template.ts` owns what a ref means.
 */
export interface LintConfig {
  /** Targets used when the command line names no positional paths. */
  paths?: string[];
  /** Globs added to the built-in `node_modules`/`.git` excludes. */
  exclude?: string[];
  /** Template files to load; their `types:` join the routing table. */
  templates?: string[];
  /** Template for a page that declares no doctype. */
  template?: string;
  /** Explicit doctype -> template ref map. */
  types?: Record<string, string>;
  /** Repo policy, first matching glob wins. */
  overrides?: TemplateOverride[];
}

export type { TemplateOverride };

/** The top-level key moose-lint owns inside the shared moose config. */
export const SECTION_KEY = "lint";

/** The filename the family shares. */
const CONFIG_FILENAME = "moose.config.yaml";

/** Filenames discovery accepts, in the order it tries them in each directory. */
export const CONFIG_FILENAMES: readonly string[] = [
  CONFIG_FILENAME,
  "moose.config.yml",
];

/**
 * Pre-rename filenames. Never read - detected only to raise the migration
 * error, because a stale one left in place would otherwise mean a run on pure
 * defaults that silently ignores every setting in it.
 */
const LEGACY_CONFIG_FILENAMES: readonly string[] = [
  "doc-structure-lint.config.yaml",
  "doc-structure-lint.config.yml",
];

/**
 * The keys this tool owns, read off the schema rather than restated here.
 *
 * Finding any of them at the root of a moose config means the file was never
 * nested under `lint:`. Deriving the list from `config.json` is what stops it
 * drifting from the real key set the next time a key is added - a restated
 * list that fell behind would let exactly the un-nested config it exists to
 * catch fall through to defaults instead.
 */
const SECTION_KEYS: readonly string[] = Object.keys(configSchema.properties);

// No `useDefaults`: the schema declares no defaults, deliberately. A default
// written into the parsed object is indistinguishable from a value the author
// wrote, which is the trap `template.json` documents on its `required` key.
const ajv = new Ajv({ allErrors: true });

let compiled: ValidateFunction | null = null;

function sectionValidator(): ValidateFunction {
  compiled ??= ajv.compile(configSchema as SchemaObject);
  return compiled;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * One Ajv error, as a path an author can find in their file.
 *
 * Ajv's `instancePath` is relative to the section, so it is prefixed back to
 * `lint`: a bare `/overrides/0/files` names a path that is not in the file.
 */
function describeError(error: ErrorObject): string {
  const params = error.params as { additionalProperty?: unknown };
  const extra =
    typeof params.additionalProperty === "string"
      ? ` ("${params.additionalProperty}")`
      : "";
  return `${SECTION_KEY}${error.instancePath} ${error.message ?? "is invalid"}${extra}`;
}

/** The un-nested config: our own keys at the root, with no `lint:` wrapper. */
function rejectUnNested(root: Record<string, unknown>, source: string): void {
  const stray = SECTION_KEYS.filter((key) => key in root);
  if (stray.length === 0) return;
  throw new MooseLintError(
    `${source}: found ${stray.map((key) => `"${key}:"`).join(", ")} at the top level, ` +
      `but no "${SECTION_KEY}:" key. ${CONFIG_FILENAME} is shared across the moose family, ` +
      `so every moose-lint setting belongs under a top-level "${SECTION_KEY}:" key. ` +
      `Indent the file's contents one level and add that key.`,
  );
}

/**
 * The miscased wrapper: `Lint:`, which the stray-key check cannot see, because
 * the keys under it are nested rather than at the top level.
 */
function rejectMiscasedWrapper(
  root: Record<string, unknown>,
  source: string,
): void {
  const miscased = Object.keys(root).find(
    (key) => key !== SECTION_KEY && key.toLowerCase() === SECTION_KEY,
  );
  if (miscased === undefined) return;
  throw new MooseLintError(
    `${source}: found "${miscased}:" at the top level, but the key is case-sensitive ` +
      `and moose-lint reads "${SECTION_KEY}:" exactly. Rename "${miscased}:" to "${SECTION_KEY}:".`,
  );
}

/**
 * Parse a whole `moose.config.yaml` and return its `lint:` section.
 *
 * `source` names the file in every message. A file that is empty, or that
 * carries only other tools' sections, returns `{}` rather than throwing - that
 * is the case that keeps one shared file usable by a project which has not
 * adopted this tool yet.
 */
export function parseConfig(text: string, source: string): LintConfig {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (err) {
    throw new MooseLintError(
      `${source}: invalid YAML: ${(err as Error).message}`,
    );
  }

  // An empty file configures nothing; it is not a broken one.
  if (raw == null) return {};
  if (!isRecord(raw)) {
    throw new MooseLintError(
      `${source}: top level must be a mapping of tool name to that tool's settings, ` +
        `with moose-lint's under "${SECTION_KEY}:".`,
    );
  }

  if (!(SECTION_KEY in raw)) {
    rejectUnNested(raw, source);
    rejectMiscasedWrapper(raw, source);
    // Every remaining root key belongs to a sibling tool. Reading none of them
    // is the whole point of the convention.
    return {};
  }

  const section = raw[SECTION_KEY];
  // `lint:` with nothing under it parses to null. An author who wrote the key
  // and no settings meant defaults, so say so rather than "must be object".
  if (section == null) return {};

  const validate = sectionValidator();
  if (!validate(section)) {
    const detail =
      (validate.errors ?? []).map(describeError).join("; ") ||
      `does not match the ${SECTION_KEY} config schema`;
    throw new MooseLintError(
      `${source}: invalid "${SECTION_KEY}" section: ${detail}.`,
    );
  }
  return section as LintConfig;
}

/** ENOENT/ENOTDIR is a file that is not there. Nothing else is. */
function isAbsent(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | null)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}

function unreadable(path: string, err: unknown): string {
  return (
    `Cannot read config file ${path}: ${(err as Error).message}. ` +
    `Check that it is a readable file and not a directory.`
  );
}

/**
 * `cwd` and each ancestor up to the repository root, nearest first.
 *
 * The walk stops at the directory holding `.git`, and at the filesystem root
 * when there is none. Without that boundary it reaches the home directory and
 * beyond, where it would adopt an unrelated project's config - a failure that
 * looks like the tool misreading your settings rather than reading someone
 * else's. See docevals ADR 01012.
 */
function ancestorsOf(cwd: string): string[] {
  const dirs: string[] = [];
  let dir = resolve(cwd);
  for (;;) {
    dirs.push(dir);
    // A worktree's `.git` is a file, not a directory; both are the boundary.
    if (existsSync(join(dir, ".git"))) break;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return dirs;
}

/**
 * Load the config from an explicit path, or by walking up from `cwd`.
 *
 * An explicit path skips discovery entirely and errors if it is missing. It
 * also gets no filename sniffing: someone who passes `--config` may call the
 * file whatever they like, so blaming a pre-rename name there would be a guess.
 *
 * Returns null when discovery finds no config, which is not an error - a repo
 * whose pages all declare their `type` needs no config at all.
 */
export async function loadConfig(
  explicitPath?: string,
  cwd: string = process.cwd(),
): Promise<{ config: LintConfig; path: string } | null> {
  if (explicitPath) {
    const abs = isAbsolute(explicitPath)
      ? explicitPath
      : resolve(cwd, explicitPath);
    let text: string;
    try {
      text = await readFile(abs, "utf8");
    } catch (err) {
      if (isAbsent(err)) {
        throw new MooseLintError(`Config file not found: "${explicitPath}".`);
      }
      throw new MooseLintError(unreadable(abs, err));
    }
    // Echo the path as it was given: that is the string the author typed.
    return { config: parseConfig(text, explicitPath), path: abs };
  }

  for (const dir of ancestorsOf(cwd)) {
    for (const name of CONFIG_FILENAMES) {
      const candidate = join(dir, name);
      let text: string;
      try {
        text = await readFile(candidate, "utf8");
      } catch (err) {
        if (isAbsent(err)) continue;
        // A file that exists but will not open is reported, not defaulted
        // through - and reported here, before the legacy check below, which
        // would otherwise blame a missing file for a permissions problem.
        throw new MooseLintError(unreadable(candidate, err));
      }
      return { config: parseConfig(text, candidate), path: candidate };
    }

    // Checked at every level, not just in cwd: a stale config two directories
    // up is exactly as misleading as one here, and rather harder to find.
    for (const legacy of LEGACY_CONFIG_FILENAMES) {
      if (existsSync(join(dir, legacy))) {
        throw new MooseLintError(
          `Found ${legacy} but no ${CONFIG_FILENAME} in ${dir}. moose-lint now reads the ` +
            `shared moose config: rename the file to ${CONFIG_FILENAME} and indent its ` +
            `contents under a top-level "${SECTION_KEY}:" key.`,
        );
      }
    }
  }

  return null;
}
