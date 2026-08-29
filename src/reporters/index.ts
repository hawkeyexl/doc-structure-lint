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

export type ReportFormat = "pretty" | "json" | "github";

/** Listing commands have nothing to annotate, so they offer no `github`. */
export type ListFormat = "pretty" | "json";

export interface ReportOptions {
  color?: boolean;
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
 * GitHub workflow commands. Newlines are collapsed because an annotation is
 * one line by definition - a wrapped message would be silently truncated at
 * the first line break.
 */
export function renderGithub(run: LintRun): string {
  const lines: string[] = [];
  for (const result of run.results) {
    for (const finding of result.findings) {
      const params = [
        `file=${result.file}`,
        `line=${finding.position.start.line}`,
        `col=${finding.position.start.column}`,
      ];
      const message = `[${finding.type}] ${describeFinding(finding)}`.replace(
        /\r?\n/g,
        " ",
      );
      lines.push(`::error ${params.join(",")}::${message}`);
    }
  }
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
