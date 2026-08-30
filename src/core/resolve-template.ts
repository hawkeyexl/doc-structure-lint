/**
 * Decide which template describes a given page.
 *
 * The headline case is the last one: a page declares what it is in its
 * frontmatter (`type: how-to`), and the template follows from that. It is the
 * same key `moose-meta`'s OKF, Diataxis, and TGDP schemas validate, so a repo
 * that already types its pages gets routing for free, and one run can lint a
 * whole tree with each page checked against the doctype it claims.
 *
 * The precedence chain mirrors docmeta's `resolveSchemaSet`: an explicit
 * instruction beats a per-page declaration, which beats repo policy, which
 * beats the page's own vocabulary, which beats a blanket default.
 *
 *   1. `--template`      an operator overriding everything, for one run
 *   2. `$template`       this page, specifically, is an exception
 *   3. config override   repo policy: "everything under docs/api is a reference"
 *   4. `type`            what the page says it is
 *   5. config default    what to assume when a page says nothing
 *
 * Every step is recorded, because "why was this page linted with that
 * template?" is otherwise a question only the source can answer. `--explain`
 * prints the record.
 */
import picomatch from "picomatch";
import type { Template, TemplateFile } from "./template.js";

/** Where a resolution came from, in precedence order. */
export type ResolutionStage =
  | "cli"
  | "frontmatter-template"
  | "config-override"
  | "type"
  | "config-default";

export type SkipCause = "no-type" | "unknown-type";

export interface ResolutionStep {
  stage: ResolutionStage;
  /** What the stage found, or null when it had nothing to say. */
  ref: string | null;
  /** Human-readable account of what the stage saw. */
  detail: string;
}

export interface Resolution {
  /** The template ref to lint with, or null when the page is not linted. */
  ref: string | null;
  /** Which stage decided, when one did. */
  stage: ResolutionStage | null;
  /** Why no template was found. Only set when `ref` is null. */
  cause?: SkipCause;
  /**
   * The `type` the page declared but that resolved to nothing. Set only for
   * `unknown-type`, so the caller can name it and suggest near misses.
   */
  unknownType?: string;
  /** Near-miss doctypes, for an unknown-type message. */
  suggestions?: string[];
  /**
   * Every doctype something serves, for an unknown-type message with no near
   * miss to offer. Carried on the resolution rather than looked up by each
   * reporter, because the type index does not reach them - which is how the
   * pretty reporter came to print the list and `--explain` came to print
   * nothing, for the same page.
   */
  knownTypes?: string[];
  /** The full chain, for `--explain`. */
  steps: ResolutionStep[];
}

/** Per-glob repo policy, from `moose.config.yaml`'s `lint.overrides`. */
export interface TemplateOverride {
  files: string;
  template: string;
}

export interface TypeIndexEntry {
  /** Ref that `loadTemplate` understands. */
  ref: string;
  /** Where the mapping came from; later sources outrank earlier ones. */
  source: "builtin" | "user" | "config";
}

/** The frontmatter key a page uses to override its doctype's template. */
export const FILE_TEMPLATE_KEY = "$template";
/** The frontmatter key a page uses to declare its doctype. */
export const TYPE_KEY = "type";

/**
 * Build the doctype -> template map.
 *
 * Built-ins go in first and user templates overwrite them, so overriding
 * `how-to` for a repo is one file with `types: [how-to]` in it - no config, no
 * flag. Within each source, a later entry wins, which makes the last
 * `--templates` file the one that decides.
 */
export function buildTypeIndex(params: {
  builtins?: { id: string; types: string[] }[];
  /** User template files, in the order they were supplied. */
  userFiles?: { ref: string; file: TemplateFile }[];
  /**
   * The config's explicit `types:` map. Highest precedence of the three, because
   * it is the only one where someone wrote down this exact pairing on purpose -
   * `types:` on a template says what that template is for, while this says what
   * this repo does about a doctype.
   */
  explicitTypes?: Record<string, string>;
}): Map<string, TypeIndexEntry> {
  const index = new Map<string, TypeIndexEntry>();

  for (const builtin of params.builtins ?? []) {
    for (const type of builtin.types) {
      index.set(type, { ref: builtin.id, source: "builtin" });
    }
  }

  for (const { ref, file } of params.userFiles ?? []) {
    for (const [name, template] of Object.entries(file.templates ?? {})) {
      for (const type of template.types ?? []) {
        index.set(type, { ref: `${ref}#${name}`, source: "user" });
      }
    }
  }

  for (const [type, ref] of Object.entries(params.explicitTypes ?? {})) {
    index.set(type, { ref, source: "config" });
  }

  return index;
}

const matcherCache = new Map<string, (p: string) => boolean>();
function matchesGlob(glob: string, filePath: string): boolean {
  let m = matcherCache.get(glob);
  if (!m) {
    m = picomatch(glob, { dot: true });
    matcherCache.set(glob, m);
  }
  // Globs are written with forward slashes whatever the platform uses.
  return m(filePath.replace(/\\/g, "/"));
}

/**
 * Doctypes close enough to a typo to be worth naming. Edit distance of one or
 * two on short strings, or a shared prefix - enough to catch `how-two` and
 * `refernce` without listing the whole vocabulary at someone.
 */
function suggestTypes(unknown: string, known: Iterable<string>): string[] {
  const target = unknown.toLowerCase();
  const scored: { type: string; distance: number }[] = [];

  for (const type of known) {
    const distance = editDistance(target, type.toLowerCase());
    const threshold = target.length <= 4 ? 1 : 3;
    if (distance <= threshold) scored.push({ type, distance });
  }

  return scored
    .sort((a, b) => a.distance - b.distance || a.type.localeCompare(b.type))
    .slice(0, 3)
    .map((s) => s.type);
}

/** Levenshtein, two rows. Inputs here are doctype slugs, so size is not a concern. */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost);
    }
    prev = row;
  }
  return prev[b.length]!;
}

/** A frontmatter value that should be a template ref. Non-strings are ignored. */
function refFromFrontmatter(
  frontmatter: Record<string, unknown> | null,
  key: string,
): string | null {
  const value = frontmatter?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export interface ResolveParams {
  /** Path used for override glob matching. */
  filePath: string;
  /**
   * Absolute path of the same file, matched as a fallback.
   *
   * `overrides[].files` globs are written relative to the config file, while
   * `filePath` is relative to the working directory. Those agree only when the
   * tool is run from the config's own directory; anywhere else the glob matched
   * nothing, the page fell through to its own `type`, and the run exited 0 with
   * the repo's policy silently unapplied. The CLI now rebases the globs to
   * absolute, so matching the absolute path too is what makes them land.
   */
  absolutePath?: string;
  /** The page's frontmatter, or null when it carries none. */
  frontmatter: Record<string, unknown> | null;
  /** `--template`: applies to every file in the run. */
  cliTemplate?: string;
  /** Repo policy, first match wins. */
  overrides?: TemplateOverride[];
  /** Doctype -> template, from `buildTypeIndex`. */
  typeIndex?: Map<string, TypeIndexEntry>;
  /** Applied when a page declares no doctype and nothing else matches. */
  defaultTemplate?: string;
}

export function resolveTemplateRef(params: ResolveParams): Resolution {
  const steps: ResolutionStep[] = [];
  const typeIndex = params.typeIndex ?? new Map<string, TypeIndexEntry>();

  const decide = (stage: ResolutionStage, ref: string): Resolution => ({
    ref,
    stage,
    steps,
  });

  if (params.cliTemplate) {
    steps.push({ stage: "cli", ref: params.cliTemplate, detail: "--template" });
    return decide("cli", params.cliTemplate);
  }
  steps.push({ stage: "cli", ref: null, detail: "--template not given" });

  const fileTemplate = refFromFrontmatter(params.frontmatter, FILE_TEMPLATE_KEY);
  if (fileTemplate) {
    steps.push({
      stage: "frontmatter-template",
      ref: fileTemplate,
      detail: `${FILE_TEMPLATE_KEY} in frontmatter`,
    });
    return decide("frontmatter-template", fileTemplate);
  }
  steps.push({
    stage: "frontmatter-template",
    ref: null,
    detail: `no ${FILE_TEMPLATE_KEY} in frontmatter`,
  });

  for (const override of params.overrides ?? []) {
    if (
      matchesGlob(override.files, params.filePath) ||
      (params.absolutePath !== undefined &&
        matchesGlob(override.files, params.absolutePath))
    ) {
      steps.push({
        stage: "config-override",
        ref: override.template,
        detail: `matched override "${override.files}"`,
      });
      return decide("config-override", override.template);
    }
  }
  steps.push({
    stage: "config-override",
    ref: null,
    detail: (params.overrides ?? []).length
      ? "no override glob matched"
      : "no overrides configured",
  });

  const type = refFromFrontmatter(params.frontmatter, TYPE_KEY);
  if (type) {
    const entry = typeIndex.get(type);
    if (entry) {
      steps.push({
        stage: "type",
        ref: entry.ref,
        detail: `type: ${type} -> ${entry.source} template`,
      });
      return decide("type", entry.ref);
    }

    // A declared type that resolves to nothing is a typo or a gap, and either
    // way silently not checking the page is the wrong answer.
    steps.push({
      stage: "type",
      ref: null,
      detail: `type: ${type} matches no template`,
    });
    return {
      ref: null,
      stage: null,
      cause: "unknown-type",
      unknownType: type,
      suggestions: suggestTypes(type, typeIndex.keys()),
      knownTypes: knownTypes(typeIndex),
      steps,
    };
  }
  steps.push({ stage: "type", ref: null, detail: "no type in frontmatter" });

  if (params.defaultTemplate) {
    steps.push({
      stage: "config-default",
      ref: params.defaultTemplate,
      detail: "config default",
    });
    return decide("config-default", params.defaultTemplate);
  }
  steps.push({ stage: "config-default", ref: null, detail: "no default configured" });

  // An untyped page is moose-meta's complaint, not this tool's: its OKF schema
  // already requires `type`. Skipping rather than failing is what lets you
  // point moose-lint at a whole tree on day one.
  return { ref: null, stage: null, cause: "no-type", steps };
}

/** The doctypes a resolved index can serve, sorted, for error messages. */
export function knownTypes(index: Map<string, TypeIndexEntry>): string[] {
  return [...index.keys()].sort();
}

export type { Template };
