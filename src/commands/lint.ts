/**
 * `lint` command core. Resolves targets, picks a parser per file, resolves a
 * template per file, and returns structured results. Free of CLI/IO plumbing so
 * it can be driven directly from tests and from the programmatic API.
 *
 * Template selection is per file, not per run: a page declares what it is
 * (`type: how-to`) and the template follows. `--template` still exists and
 * still overrides everything, but it is no longer required, which is what lets
 * one invocation lint a whole tree of mixed doctypes.
 */
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import {
  MooseLintError,
  type DocumentParser,
  type DocumentTree,
  type FileResult,
  type Finding,
  type Position,
} from "../types.js";
import {
  parserByName,
  parserForExtension,
  supportedExtensions,
} from "../parsers/index.js";
import type { Template, TemplateFile } from "../core/template.js";
import {
  classifyRef,
  listBuiltins,
  loadResolvedTemplate,
  loadTemplateFile,
} from "../core/template-registry.js";
import {
  buildTypeIndex,
  knownTypes,
  resolveTemplateRef,
  type Resolution,
  type TemplateOverride,
  type TypeIndexEntry,
} from "../core/resolve-template.js";
import { validateDocument } from "../core/validator.js";
import { resolveTargets, STDIN_TOKEN } from "../core/load-files.js";

/** File label used for a document read from stdin. */
export const STDIN_LABEL = "<stdin>";

export interface LintOptions {
  /** Positional inputs: files, directories, or globs. `-` reads stdin. */
  inputs: string[];
  /** `--template`: a built-in id, a path, or a name inside `templates`. */
  template?: string;
  /**
   * `--templates`: template files whose `types:` join the routing table. A bare
   * `--template <name>` is resolved as a name inside the first of them, which is
   * the pairing the moose-docevals adapter invokes.
   */
  templates?: string | string[];
  /** `--as`: force an input format, by parser name. */
  as?: string;
  /** `--exclude`: globs removed from directory/glob expansion. */
  exclude?: string[];
  cwd?: string;
  /** Content for the `-` input, injected by the CLI and by tests. */
  stdinContent?: string;
  /** `--explain`: record how each file's template was chosen. */
  explain?: boolean;
  /** Repo policy from config: first matching glob wins. */
  overrides?: TemplateOverride[];
  /** Config default, applied when a page declares no doctype. */
  defaultTemplate?: string;
  /** Config's explicit doctype -> template ref map. */
  types?: Record<string, string>;
}

/** `--templates` accepts one path or several; normalize to a list. */
function templateFiles(value: string | string[] | undefined): string[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

export interface LintSummary {
  /** Files actually linted. Always `passed + failed`; skips are counted apart. */
  checked: number;
  passed: number;
  failed: number;
  skipped: number;
}

/**
 * A `FileResult` plus the human-readable reason a file was skipped.
 *
 * `types.ts` pins the fields moose-docevals reads off the JSON reporter, so
 * this diagnostic lives here instead: it exists for pretty output, and the
 * JSON reporter never emits it.
 */
export interface LintFileResult extends FileResult {
  /** Why the file was skipped, in words. Set only alongside `skipped`. */
  reason?: string;
  /** How the template was chosen. Present when `--explain` asked for it. */
  resolution?: Resolution;
}

export interface LintRun {
  results: LintFileResult[];
  summary: LintSummary;
}

/** Zero-width span at the top of a file, for findings with nowhere better. */
function origin(): Position {
  return {
    start: { line: 1, column: 1, offset: 0 },
    end: { line: 1, column: 1, offset: 0 },
  };
}

function skip(
  file: string,
  reason: string,
  cause: FileResult["skipped"] = "unsupported-format",
): LintFileResult {
  return {
    file,
    // `success` means "linted and produced no findings". A file that was never
    // linted is neither passing nor failing, and calling it a pass would hide
    // the gap from anyone reading CI output.
    success: false,
    findings: [],
    template: null,
    skipped: cause,
    reason,
  };
}

function parseFinding(message: string): Finding {
  return {
    type: "parse_error",
    heading: null,
    message,
    position: origin(),
    severity: "error",
  };
}

/**
 * A template ref, loaded once per run however many pages route to it.
 *
 * The registry deliberately leaves `extends` unresolved, so the merge happens
 * here. Skipping it would make inheritance silently inert: a template that
 * inherits every one of its sections would check nothing and report a clean
 * pass. `resolveExtends` is a no-op on a template without `extends`.
 */
function templateLoader(): (ref: string) => Promise<Template> {
  const cache = new Map<string, Promise<Template>>();
  return (ref) => {
    let pending = cache.get(ref);
    if (!pending) {
      pending = loadResolvedTemplate(ref);
      cache.set(ref, pending);
    }
    return pending;
  };
}

/**
 * Normalize `--template` into a ref the registry understands.
 *
 * `--templates t.yaml --template how-to` is the pairing the moose-docevals
 * adapter invokes, and it means "the template named how-to inside t.yaml".
 * A ref that already names a file, a URL, or a built-in is passed through.
 */
function cliTemplateRef(
  template: string | undefined,
  templatePaths: string[],
): string | undefined {
  if (!template) return undefined;
  // A ref that names itself is passed through. Sniffing for `#`, `/` and `\`
  // missed built-in ids, which contain none of them, so `-t tgdp:how-to:1.6`
  // silently became a lookup for a template of that name inside the first
  // `--templates` file the moment one was given.
  if (template.includes("#")) return template;
  if (classifyRef(template).kind !== "file") return template;
  if (template.includes("/") || template.includes("\\")) return template;
  if (templatePaths.length === 0) return template;

  // A bare name is a name inside a `--templates` file. Search them last-first,
  // matching `buildTypeIndex`, so the file that wins routing also wins here.
  return `${templatePaths[templatePaths.length - 1]}#${template}`;
}

/** The finding a page gets when it declares a doctype nothing serves. */
function unknownTypeFinding(
  resolution: Resolution,
  typeIndex: Map<string, TypeIndexEntry>,
  position: Position,
): Finding {
  const suggestions = resolution.suggestions ?? [];
  const hint = suggestions.length
    ? ` Did you mean ${suggestions.map((s) => `"${s}"`).join(", ")}?`
    : ` Known doctypes: ${knownTypes(typeIndex).join(", ") || "(none)"}.`;
  return {
    type: "unknown_type",
    heading: null,
    message:
      `No template serves type "${resolution.unknownType}".${hint} ` +
      `Declare it on a template with "types:", then pass that file with --templates.`,
    position,
    severity: "error",
  };
}

interface LintContext {
  getTemplate: (ref: string) => Promise<Template>;
  /** Absolute, forward-slashed form of a display path, for override globs. */
  absoluteOf?: (file: string) => string;
  typeIndex: Map<string, TypeIndexEntry>;
  cliTemplate?: string;
  overrides?: TemplateOverride[];
  defaultTemplate?: string;
  explain: boolean;
}

async function lintOne(
  label: string,
  content: string,
  parser: DocumentParser,
  ctx: LintContext,
): Promise<LintFileResult> {
  if (!parser.implemented) {
    // Roadmap parsers are registered on purpose, and their `parse()` throws a
    // MooseLintError that already names the format. Harvesting that message
    // keeps the wording in one place instead of restating it here.
    let reason = `${parser.label} is not implemented yet.`;
    try {
      parser.parse(content, label);
    } catch (err) {
      // The parser prefixes its message with the file path. Every report names
      // the file already, and these paths are long, so drop the duplicate.
      const message = (err as Error).message;
      reason = message.startsWith(`${label}: `)
        ? message.slice(label.length + 2)
        : message;
    }
    return skip(label, reason);
  }

  let tree: DocumentTree;
  try {
    tree = parser.parse(content, label);
  } catch (err) {
    // A file that will not parse is that file's problem, not the run's: it is
    // reported and the run continues, so one broken page cannot hide the
    // findings in the other 199.
    return {
      file: label,
      success: false,
      findings: [parseFinding((err as Error).message)],
      template: null,
    };
  }

  // Routing needs the frontmatter, so it happens after the parse rather than
  // before the read - which is also what makes `--explain` able to say what the
  // page actually declared.
  const resolution = resolveTemplateRef({
    filePath: label,
    absolutePath: ctx.absoluteOf?.(label),
    frontmatter: tree.frontmatter,
    cliTemplate: ctx.cliTemplate,
    overrides: ctx.overrides,
    typeIndex: ctx.typeIndex,
    defaultTemplate: ctx.defaultTemplate,
  });
  const withResolution = <T extends LintFileResult>(result: T): T =>
    ctx.explain ? { ...result, resolution } : result;

  // Anchor anything said about the frontmatter at the frontmatter.
  const metaPosition = tree.frontmatterPosition ?? origin();

  if (resolution.ref === null) {
    if (resolution.cause === "unknown-type") {
      // A declared type that resolves to nothing is a typo or a gap. Skipping
      // would mean a page silently stops being checked, which is the one
      // outcome worse than a false positive.
      return withResolution({
        file: label,
        success: false,
        findings: [unknownTypeFinding(resolution, ctx.typeIndex, metaPosition)],
        template: null,
      });
    }
    // An untyped page is moose-meta's complaint, not this tool's - its OKF
    // schema already requires `type`. Skipping is what lets moose-lint be
    // pointed at a whole tree on day one.
    return withResolution(
      skip(
        label,
        "no type in frontmatter and no template resolved",
        "no-template",
      ),
    );
  }

  /** A broken template, reported against this page rather than thrown. */
  const brokenTemplate = (err: unknown): LintFileResult =>
    withResolution({
      file: label,
      success: false,
      findings: [
        {
          type: "template_error",
          heading: null,
          message: (err as Error).message,
          position: metaPosition,
          severity: "error",
        },
      ],
      template: resolution.ref,
    });

  let template: Template;
  try {
    template = await ctx.getTemplate(resolution.ref);
  } catch (err) {
    // One unloadable template must not abort a run over a whole tree; it is
    // reported against the pages that route to it.
    return brokenTemplate(err);
  }

  let findings: Finding[];
  try {
    findings = validateDocument(tree, template);
  } catch (err) {
    // Validation can raise for the same reason loading can: a template the
    // author got wrong - an uncompilable `heading.pattern` is the live case.
    // Without this the raise escapes `runLint` and kills the run, so one bad
    // pattern hides the findings in every other page, which is the outcome the
    // load path above exists to prevent.
    if (err instanceof MooseLintError) return brokenTemplate(err);
    throw err;
  }

  return withResolution({
    file: label,
    success: findings.length === 0,
    findings,
    template: resolution.ref,
  });
}

export async function runLint(opts: LintOptions): Promise<LintRun> {
  const cwd = opts.cwd ?? process.cwd();

  // Resolve `--as` before anything is read: a typo should fail immediately,
  // not after walking a tree of files it was going to mis-parse anyway.
  const forcedParser = opts.as != null ? parserByName(opts.as) : undefined;
  if (opts.as != null && !forcedParser) {
    throw new MooseLintError(
      `Unknown format "${opts.as}". Run "moose-lint formats" to see the registered formats.`,
    );
  }

  // The doctype -> template map. Built-ins go in first and user templates
  // overwrite them, so overriding `how-to` for a repo is one file with
  // `types: [how-to]` in it - no config entry, no flag.
  const templatePaths = templateFiles(opts.templates);
  const getTemplate = templateLoader();

  const userFiles: { ref: string; file: TemplateFile }[] = [];
  for (const ref of templatePaths) {
    const file = await loadTemplateFile(ref);
    // `extends` is resolved before `types` is read. A template that inherits
    // its doctypes declares none of its own, so reading the raw file routes
    // nothing to it - the override loads, merges, and is silently inert while
    // the page goes to the built-in it meant to replace. The loader is cached,
    // so this costs nothing the lint would not already pay.
    const templates: Record<string, Template> = {};
    for (const name of Object.keys(file.templates ?? {})) {
      templates[name] = await getTemplate(`${ref}#${name}`);
    }
    userFiles.push({ ref, file: { ...file, templates } });
  }

  const typeIndex = buildTypeIndex({
    builtins: listBuiltins(),
    userFiles,
    explicitTypes: opts.types,
  });

  const ctx: LintContext = {
    getTemplate,
    absoluteOf: (file) => resolve(cwd, file).replace(/\\/g, "/"),
    typeIndex,
    cliTemplate: cliTemplateRef(opts.template, templatePaths),
    overrides: opts.overrides,
    defaultTemplate: opts.defaultTemplate,
    explain: opts.explain === true,
  };

  // `--template` applies to every file, so a ref that will not load is bad
  // usage, not a property of any page. Resolved up front so it exits 2 with one
  // message, rather than becoming an identical `template_error` finding on all
  // 200 pages and exiting 1 - which reads to CI as "the docs are wrong".
  if (ctx.cliTemplate != null) await getTemplate(ctx.cliTemplate);

  const usingStdin = opts.inputs.includes(STDIN_TOKEN);
  const fileInputs = opts.inputs.filter((input) => input !== STDIN_TOKEN);

  // With stdin and nothing else there is nothing to expand; otherwise let
  // resolveTargets own the "you gave me nothing" error, so it is worded once.
  const files =
    usingStdin && fileInputs.length === 0
      ? []
      : await resolveTargets({
          inputs: fileInputs,
          exts: forcedParser?.extensions,
          exclude: opts.exclude,
          cwd,
        });

  const results: LintFileResult[] = [];

  if (usingStdin) {
    if (!forcedParser) {
      throw new MooseLintError(
        "Reading from stdin (-) requires --as <format> to choose a parser.",
      );
    }
    results.push(
      await lintOne(STDIN_LABEL, opts.stdinContent ?? "", forcedParser, ctx),
    );
  }

  for (const file of files) {
    const content = await readFile(resolve(cwd, file), "utf8");
    const ext = extname(file);
    const parser = forcedParser ?? parserForExtension(ext);
    if (!parser) {
      results.push(
        skip(
          file,
          `no parser is registered for "${ext || file}". Supported extensions: ${supportedExtensions().join(", ")}. Use --as to override.`,
        ),
      );
      continue;
    }
    results.push(await lintOne(file, content, parser, ctx));
  }

  // A glob that matched nothing is a typo far more often than it is an empty
  // directory, and an empty report reads as a clean bill of health.
  if (results.length === 0) {
    throw new MooseLintError(
      `Nothing to lint: ${fileInputs.join(", ")} matched no files. Check the paths, --exclude, and "moose-lint formats".`,
    );
  }

  const skipped = results.filter((r) => r.skipped != null).length;
  const failed = results.filter((r) => r.skipped == null && !r.success).length;
  const checked = results.length - skipped;

  // A run that found files and checked none of them is the worst thing this
  // tool can do quietly: it exits 0 and reads as a clean bill of health for a
  // docset nothing looked at. A repo that adopts moose-lint in CI before
  // backfilling `type:` keys would get a permanently green job.
  //
  // This replaces a guard that tested `typeIndex.size === 0` before any file
  // was read. That could never fire - the index is always seeded with the
  // built-ins - so it protected nothing. Counting the outcome does.
  //
  // `--explain` is exempt: showing why nothing routed is exactly its job.
  if (!ctx.explain && checked === 0 && skipped > 0) {
    throw new MooseLintError(
      `Nothing was checked: all ${skipped} file(s) were skipped. ` +
        `Give a page a "type:" that a template serves, pass -t/--template <ref>, ` +
        `or set "lint.template" as a default. Run "moose-lint <paths> --explain" ` +
        `to see how each file resolved.`,
    );
  }

  return {
    results,
    summary: { checked, passed: checked - failed, failed, skipped },
  };
}
