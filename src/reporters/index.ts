/**
 * Reporters render a run to a string. The CLI writes the result to stdout;
 * diagnostics go to stderr separately, so a report is never interleaved with
 * anything a consumer has to parse around.
 */
import type { Finding } from "../types.js";
import type { LintRun } from "../commands/lint.js";
import type { FormatInfo } from "../commands/formats.js";
import type { TemplateInfo, TemplatesInfo } from "../commands/templates.js";
import { palette, type Colors } from "./color.js";
import { renderSarif } from "./sarif.js";

export type ReportFormat = "pretty" | "json" | "github" | "explain" | "sarif";

/** Listing commands have nothing to annotate, so they offer no `github`. */
export type ListFormat = "pretty" | "json";

export interface ReportOptions {
  color?: boolean;
  /**
   * Directory the run's relative paths are relative to, forwarded to the SARIF
   * reporter and ignored by the others. Defaults to the process cwd, which is
   * right for the CLI because `runLint` defaults its `cwd` the same way.
   *
   * It is here rather than only on `renderSarif` because `render` is the entry
   * point a library caller reaches for, and without it that caller was pinned
   * to the process cwd with no way out short of bypassing `render` entirely -
   * for the one reporter whose whole output is paths.
   */
  root?: string;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** `line:column` of a finding, the anchor an editor can jump to. */
function locate(finding: Finding): string {
  return `${finding.position.start.line}:${finding.position.start.column}`;
}

/** A finding as prose: the heading it is about, then what is wrong with it. */
function describeFinding(finding: Finding): string {
  return finding.heading != null
    ? `${finding.heading}: ${finding.message}`
    : finding.message;
}

export function renderPretty(run: LintRun, opts: ReportOptions = {}): string {
  const c = palette(opts.color ?? false);
  const lines: string[] = [];

  for (const result of run.results) {
    // A skip is reported, never silently dropped: an unreadable format that
    // leaves no trace is indistinguishable from a file that passed.
    if (result.skipped != null) {
      const why = result.reason ?? result.skipped;
      lines.push(`${c.yellow("-")} ${result.file}  ${c.dim(`skipped: ${why}`)}`);
      continue;
    }
    if (result.success) {
      lines.push(`${c.green("✓")} ${result.file}`);
      continue;
    }
    lines.push(`${c.red("✗")} ${result.file}`);
    for (const finding of result.findings) {
      lines.push(
        `    ${c.dim(locate(finding))}  ${c.cyan(finding.type)}  ${describeFinding(finding)}`,
      );
    }
  }

  const { checked, passed, failed, skipped } = run.summary;
  const summary = `${plural(checked, "file")} checked, ${passed} passed, ${failed} failed, ${skipped} skipped`;
  if (lines.length > 0) lines.push("");
  lines.push(failed > 0 ? c.red(summary) : c.green(summary));
  return lines.join("\n");
}

/**
 * The published JSON shape, and the reason this builds objects by hand rather
 * than stringifying `run.results` directly.
 *
 * moose-docevals reads `[{ file, success, errors: [{ type, heading, message,
 * position: { start: { line, column } } }] }]` off stdout, and it parses
 * rather than validates - a renamed key produces zero findings, not an error.
 * So: a bare array at the top level, and `errors`, even though the internal
 * field is `findings`. Adding keys is safe; renaming or nesting is not.
 */
export function renderJson(run: LintRun): string {
  const results = run.results.map((result) => ({
    file: result.file,
    success: result.success,
    errors: result.findings.map((finding) => ({
      type: finding.type,
      heading: finding.heading,
      message: finding.message,
      position: finding.position,
    })),
  }));
  return JSON.stringify(results, null, 2);
}

/**
 * Escape the data half of a workflow command - everything after the `::`.
 *
 * `%` is the format's escape character, so a message quoting a literal
 * percentage makes GitHub read the two characters after it as a hex code and
 * swallow them. A raw line break ends the command outright, spilling the rest
 * of the message into the log as plain text that no annotation carries.
 *
 * `%` has to be replaced first. Replacing it last would rewrite the `%` of a
 * `%0A` this function had just introduced, and the reader would see a literal
 * `%250A` where the line break belonged.
 */
function escapeData(value: string): string {
  return value.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

/**
 * Escape a property value - the `file=...` half, which is stricter than data.
 *
 * Properties are comma-separated and the list ends at the next `::`, so a raw
 * `,` or `:` inside a value redraws those boundaries. That is not a corner
 * case: every absolute path on Windows carries a drive-letter colon, and
 * `file=C:\docs\a.md` is enough for GitHub to mis-parse the command and drop
 * the annotation - the entire report silently empty on a Windows runner, with
 * the run still exiting 1 as if it had been posted.
 */
function escapeProperty(value: string): string {
  return escapeData(value).replace(/:/g, "%3A").replace(/,/g, "%2C");
}

/**
 * GitHub workflow commands: one `::error` annotation per finding.
 *
 * Line breaks are escaped rather than collapsed to spaces, as this once did.
 * `%0A` is the format's own answer and GitHub renders it as a multi-line
 * annotation, so the message arrives whole; collapsing threw away the author's
 * line breaks to solve a problem the escape already solves, and its `\r?\n`
 * pattern let a bare carriage return through into the command untouched.
 */
export function renderGithub(run: LintRun): string {
  const lines: string[] = [];
  for (const result of run.results) {
    for (const finding of result.findings) {
      const params = [
        `file=${escapeProperty(result.file)}`,
        `line=${finding.position.start.line}`,
        `col=${finding.position.start.column}`,
      ];
      const message = escapeData(
        `[${finding.type}] ${describeFinding(finding)}`,
      );
      lines.push(`::error ${params.join(",")}::${message}`);
    }
  }
  return lines.join("\n");
}

/**
 * `--explain`: the resolution chain per file, rather than findings.
 *
 * Printing every stage, including the ones that had nothing to say, is the
 * point. "Which template linted this page?" is usually asked because the answer
 * was surprising, and the surprising part is almost always a stage the reader
 * forgot applies - a stray `$template`, an override glob matching more than
 * intended. A report that showed only the winning stage would hide exactly the
 * thing being looked for.
 */
export function renderExplain(run: LintRun, opts: ReportOptions = {}): string {
  const c = palette(opts.color ?? false);
  const lines: string[] = [];

  for (const result of run.results) {
    // Not the pass/fail glyphs: `--explain` reports whether a page was routed,
    // and a routed page may still be full of findings. Reusing the tick would
    // read as a clean bill of health for a document nothing has looked at yet.
    const chosen = result.template;
    lines.push(`${chosen ? c.cyan("▸") : c.dim("-")} ${c.bold(result.file)}`);

    const steps = result.resolution?.steps ?? [];
    if (steps.length === 0) {
      lines.push(`    ${c.dim("(no resolution recorded)")}`);
    }
    for (const step of steps) {
      const mark = step.ref ? c.green("→") : c.dim("·");
      const label = step.ref ? c.bold(step.ref) : c.dim(step.detail);
      const suffix = step.ref ? `  ${c.dim(step.detail)}` : "";
      lines.push(`    ${mark} ${step.stage.padEnd(20)} ${label}${suffix}`);
    }

    const cause = result.resolution?.cause;
    if (cause === "unknown-type") {
      const type = result.resolution?.unknownType;
      const near = result.resolution?.suggestions ?? [];
      lines.push(
        `    ${c.red("✗")} no template serves type "${type}"` +
          (near.length ? `; did you mean ${near.join(", ")}?` : ""),
      );
    } else if (cause === "no-type") {
      lines.push(`    ${c.dim("skipped: the page declares no type")}`);
    }
    lines.push("");
  }

  const routed = run.results.filter((r) => r.template != null).length;
  lines.push(
    `${run.results.length} file${run.results.length === 1 ? "" : "s"}, ` +
      `${routed} routed, ${run.results.length - routed} unrouted`,
  );
  return lines.join("\n");
}

export function render(
  run: LintRun,
  format: ReportFormat,
  opts: ReportOptions = {},
): string {
  switch (format) {
    case "json":
      return renderJson(run);
    case "github":
      return renderGithub(run);
    case "sarif":
      return renderSarif(run, opts.root === undefined ? {} : { root: opts.root });
    case "explain":
      return renderExplain(run, opts);
    case "pretty":
    default:
      return renderPretty(run, opts);
  }
}

/** One template per line: the ref to pass, its title, and the types it serves. */
function templateLine(c: Colors, entry: TemplateInfo): string {
  const title = entry.title !== "" ? `  ${c.dim("—")}  ${entry.title}` : "";
  const types =
    entry.types.length > 0 ? entry.types.join(", ") : "(no types declared)";
  return `  ${c.cyan(entry.id)}${title}  ${c.dim(`types: ${types}`)}  ${c.dim(`[${entry.source}]`)}`;
}

export function renderTemplates(
  info: TemplatesInfo,
  format: ListFormat,
  opts: ReportOptions = {},
): string {
  if (format === "json") return JSON.stringify(info, null, 2);

  const c = palette(opts.color ?? false);
  const lines: string[] = [c.bold("Templates:")];
  if (info.templates.length === 0) {
    lines.push(c.dim("  (none)"));
  } else {
    for (const entry of info.templates) lines.push(templateLine(c, entry));
  }
  return lines.join("\n");
}

export function renderFormats(
  formats: FormatInfo[],
  format: ListFormat,
  opts: ReportOptions = {},
): string {
  if (format === "json") return JSON.stringify(formats, null, 2);

  const c = palette(opts.color ?? false);
  const lines: string[] = [c.bold("Input formats:")];
  for (const entry of formats) {
    const state = entry.implemented ? c.green("implemented") : c.dim("planned");
    lines.push(
      `  ${c.cyan(entry.name)}  ${entry.label} (${entry.extensions.join(", ")})  [${state}]`,
    );
  }
  return lines.join("\n");
}
