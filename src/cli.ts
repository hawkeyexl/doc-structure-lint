/**
 * moose-lint CLI. Thin commander wrapper over the command cores. Follows
 * clig.dev: primary output to stdout, diagnostics to stderr, color only on a
 * TTY (and never under NO_COLOR/--no-color), meaningful exit codes.
 *
 * Exit codes are the contract CI reads:
 *   0  every file linted clean
 *   1  the run produced findings
 *   2  the tool could not do its job - bad usage, missing template, unreadable
 *      input. A MooseLintError is always this, never a lint failure.
 *
 * The 1/2 split is what lets a workflow tell "the docs are wrong" apart from
 * "the linter is misconfigured", which a single non-zero exit cannot.
 */
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import pkg from "../package.json" with { type: "json" };
import { MooseLintError } from "./types.js";
import { runLint } from "./commands/lint.js";
import { runTemplates } from "./commands/templates.js";
import { runFormats } from "./commands/formats.js";
import {
  render,
  renderFormats,
  renderTemplates,
  type ListFormat,
  type ReportFormat,
} from "./reporters/index.js";
import { shouldColor } from "./reporters/color.js";

const REPORT_FORMATS = new Set<string>(["pretty", "json", "github"]);
const LIST_FORMATS = new Set<string>(["pretty", "json"]);

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function fail(err: unknown): never {
  const msg =
    err instanceof MooseLintError
      ? err.message
      : `Unexpected error: ${(err as Error).message}`;
  process.stderr.write(`moose-lint: ${msg}\n`);
  process.exit(2);
}

function resolveColor(program: Command): boolean {
  // commander maps --no-color to opts.color === false.
  const noColor = program.opts().color === false;
  return shouldColor({ noColor, isTTY: Boolean(process.stdout.isTTY) });
}

function reportFormat(value: unknown): ReportFormat {
  const format = String(value);
  if (!REPORT_FORMATS.has(format)) {
    throw new MooseLintError(
      `Unknown --format "${format}". Use pretty, json, or github.`,
    );
  }
  return format as ReportFormat;
}

function listFormat(value: unknown): ListFormat {
  const format = String(value);
  if (!LIST_FORMATS.has(format)) {
    throw new MooseLintError(
      `Unknown --format "${format}". Use pretty or json.`,
    );
  }
  return format as ListFormat;
}

export function buildProgram(): Command {
  const program = new Command();
  program
    .name("moose-lint")
    .description(
      "Validate document structure against doctype templates. Deterministic, CI-friendly.",
    )
    .version(pkg.version, "-V, --version")
    .option("--no-color", "disable colored output")
    .showHelpAfterError()
    // Exit code 1 is reserved for "the docs are wrong". Commander exits 1 on a
    // usage error by default, which would make a typo'd flag look exactly like
    // a failing lint to a workflow; usage errors are remapped to 2, help and
    // --version stay 0. Commander has already written its own message. This has
    // to precede .command(), which copies the callback into each subcommand.
    .exitOverride((err) => {
      process.exit(err.exitCode === 0 ? 0 : 2);
    });

  program
    .command("lint", { isDefault: true })
    .description("Lint the given files/dirs/globs against a template")
    .argument(
      "[paths...]",
      "files, directories, or globs to lint (use - for stdin)",
    )
    .option(
      "-t, --template <ref>",
      "template to apply: a built-in id, a path, or a name inside --templates",
    )
    .option("--templates <path>", "template file to resolve --template within")
    .option("--as <format>", "force an input format (e.g. markdown, mdx)")
    .option(
      "--exclude <glob...>",
      "globs to exclude from directory/glob expansion; repeatable",
    )
    .option("-f, --format <format>", "output: pretty | json | github", "pretty")
    .addHelpText(
      "after",
      [
        "",
        "Examples:",
        "  moose-lint docs/ -t how-to                     # walk a directory",
        '  moose-lint "**/*.md" -t how-to -f github       # CI annotations',
        "  moose-lint page.md -t how-to --templates ./templates.yaml",
        "  moose-lint docs/ -t how-to --exclude '**/drafts/**'",
        "  cat page.md | moose-lint - -t how-to --as markdown",
      ].join("\n"),
    )
    .action(async (paths: string[], options, command: Command) => {
      try {
        const format = reportFormat(options.format);
        const stdinContent = paths.includes("-")
          ? await readStdin()
          : undefined;

        const run = await runLint({
          inputs: paths,
          template: options.template,
          templates: options.templates,
          as: options.as,
          exclude: options.exclude,
          stdinContent,
        });

        const color = resolveColor(command.parent ?? command);
        const text = render(run, format, { color });
        if (text.length > 0) process.stdout.write(`${text}\n`);
        process.exitCode = run.summary.failed > 0 ? 1 : 0;
      } catch (err) {
        fail(err);
      }
    });

  program
    .command("templates")
    .description("List the templates that can be applied, and the types they serve")
    .option("--templates <path>", "also list the templates in this file")
    .option("-f, --format <format>", "output: pretty | json", "pretty")
    .action(async (options, command: Command) => {
      try {
        const format = listFormat(options.format);
        const info = await runTemplates({ templates: options.templates });
        const color = resolveColor(command.parent ?? command);
        process.stdout.write(`${renderTemplates(info, format, { color })}\n`);
      } catch (err) {
        fail(err);
      }
    });

  program
    .command("formats")
    .description("List the registered input formats, implemented or planned")
    .option("-f, --format <format>", "output: pretty | json", "pretty")
    .action((options, command: Command) => {
      try {
        const format = listFormat(options.format);
        const color = resolveColor(command.parent ?? command);
        process.stdout.write(
          `${renderFormats(runFormats(), format, { color })}\n`,
        );
      } catch (err) {
        fail(err);
      }
    });

  return program;
}

export async function main(argv: string[] = process.argv): Promise<void> {
  const program = buildProgram();
  await program.parseAsync(argv);
}

/**
 * Run only when executed directly, not when imported by tests.
 *
 * Comparing resolved real paths, rather than matching the tail of
 * `process.argv[1]` against a list of spellings of the package name, is what
 * survives symlinked bins, `npx`, Windows separators, and a rename.
 */
function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isMainModule()) {
  main().catch(fail);
}
