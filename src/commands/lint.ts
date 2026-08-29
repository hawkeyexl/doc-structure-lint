/**
 * `lint` command core. Resolves targets, picks a parser per file, runs one
 * template over each parsed tree, and returns structured results. Free of
 * CLI/IO plumbing so it can be driven directly from tests and from the
 * programmatic API.
 *
 * Template selection is deliberately blunt here: a single `--template` applies
 * to every file. Routing by a page's frontmatter `type` is the point of the
 * tool and lands next; `FileResult.template` already carries the ref that was
 * applied, so the reporters need no change when it does.
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
import type { Template } from "../core/template.js";
import {
  loadTemplate,
  loadTemplateFile,
  resolveExtends,
} from "../core/template-registry.js";
import { validateDocument } from "../core/validator.js";
import { resolveTargets, STDIN_TOKEN } from "../core/load-files.js";

/** File label used for a document read from stdin. */
export const STDIN_LABEL = "<stdin>";

export interface LintOptions {
  /** Positional inputs: files, directories, or globs. `-` reads stdin. */
  inputs: string[];
  /** `--template`: a built-in id, a path, or a name inside `templates`. */
  template?: string;
  /** `--templates`: a template file to resolve `template` as a name within. */
  templates?: string;
  /** `--as`: force an input format, by parser name. */
  as?: string;
  /** `--exclude`: globs removed from directory/glob expansion. */
  exclude?: string[];
  cwd?: string;
  /** Content for the `-` input, injected by the CLI and by tests. */
  stdinContent?: string;
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

function skip(file: string, reason: string): LintFileResult {
  return {
    file,
    // `success` means "linted and produced no findings". A file that was never
    // linted is neither passing nor failing, and calling it a pass would hide
    // the gap from anyone reading CI output.
    success: false,
    findings: [],
    template: null,
    skipped: "unsupported-format",
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
 * Resolve the template every file in this run is checked against.
 *
 * With `--templates`, `--template` names an entry inside that file - the
 * pairing moose-docevals adapter already invokes. Without it the ref goes to
 * the registry, which knows built-in ids and paths.
 *
 * The registry deliberately leaves `extends` unresolved, so the merge happens
 * here. Skipping it would make inheritance silently inert: a template that
 * inherits every one of its sections would check nothing and report a clean
 * pass. `resolveExtends` is a no-op on a template without `extends`.
 */
async function resolveTemplate(
  ref: string,
  templatesPath: string | undefined,
): Promise<Template> {
  if (templatesPath == null) return resolveExtends(await loadTemplate(ref));

  const file = await loadTemplateFile(templatesPath);
  const template = file.templates?.[ref];
  if (!template) {
    const names = Object.keys(file.templates ?? {});
    const available = names.length > 0 ? ` Available: ${names.join(", ")}.` : "";
    throw new MooseLintError(
      `Template "${ref}" is not defined in ${templatesPath}.${available}`,
    );
  }
  return resolveExtends(template);
}

function lintOne(
  label: string,
  content: string,
  parser: DocumentParser,
  template: Template,
  templateRef: string,
): LintFileResult {
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
    // A file that will not parse is that file problem, not the run: it is
    // reported and the run continues, so one broken page cannot hide the
    // findings in the other 199.
    return {
      file: label,
      success: false,
      findings: [parseFinding((err as Error).message)],
      template: templateRef,
    };
  }

  const findings = validateDocument(tree, template);
  return {
    file: label,
    success: findings.length === 0,
    findings,
    template: templateRef,
  };
}

export async function runLint(opts: LintOptions): Promise<LintRun> {
  const cwd = opts.cwd ?? process.cwd();

  if (opts.template == null || opts.template === "") {
    throw new MooseLintError(
      `No template. Pass -t/--template <ref>, for example --template how-to. Run "moose-lint templates" to see what is available.`,
    );
  }

  // Resolve `--as` before anything is read: a typo should fail immediately,
  // not after walking a tree of files it was going to mis-parse anyway.
  const forcedParser = opts.as != null ? parserByName(opts.as) : undefined;
  if (opts.as != null && !forcedParser) {
    throw new MooseLintError(
      `Unknown format "${opts.as}". Run "moose-lint formats" to see the registered formats.`,
    );
  }

  // One template, loaded once, applied to everything. Frontmatter `type`
  // routing replaces this call, not the shape of what it returns.
  const template = await resolveTemplate(opts.template, opts.templates);

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
      lintOne(
        STDIN_LABEL,
        opts.stdinContent ?? "",
        forcedParser,
        template,
        opts.template,
      ),
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
    results.push(lintOne(file, content, parser, template, opts.template));
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

  return {
    results,
    summary: { checked, passed: checked - failed, failed, skipped },
  };
}
