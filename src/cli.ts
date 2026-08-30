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
import { dirname, isAbsolute, resolve as resolvePath } from "node:path";
import { loadConfig, type LintConfig } from "./core/config.js";
import { refRelativeTo } from "./core/template-registry.js";
import { runFormats } from "./commands/formats.js";
import {
  render,
  renderFormats,
  renderTemplates,
  type ListFormat,
  type ReportFormat,
} from "./reporters/index.js";
import { shouldColor } from "./reporters/color.js";

// `explain` is reachable through `--explain`, not `-f`: it reports on
// configuration rather than on documents, and offering it as a format would
// invite `-f explain` alongside a lint that then never happens.
const REPORT_FORMATS = new Set<string>(["pretty", "json", "github", "sarif"]);
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
      `Unknown --format "${format}". Use pretty, json, github, or sarif.`,
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

/**
 * Re-base everything a config declares against the config file's own directory.
 *
 * `loadConfig` returns the file's `path` precisely so this can happen, and
 * discarding it made the same config mean different things depending on where
 * the tool was invoked from. Running from a subdirectory turned `templates:`
 * into "file not found" and `paths:` into "nothing to lint" - and turned
 * `overrides:` into nothing at all, silently: the glob stopped matching, every
 * page fell through to its own `type`, and the run exited 0 having applied none
 * of the repo's policy.
 *
 * Refs go through `refRelativeTo`, which leaves built-in ids, URLs, and
 * absolute paths alone. Globs become absolute, which is what `runLint` matches
 * them against.
 */
function rebaseConfig(
  found: { config: LintConfig; path: string } | null,
): LintConfig {
  if (!found) return {};
  const dir = dirname(resolvePath(found.path));
  const config = found.config;

  const ref = (value: string): string => refRelativeTo(found.path, value);
  // Every non-absolute glob is relative to the config, `**/*.md` included.
  // Exempting a leading `**` left the original bug half-open: from a
  // subdirectory that pattern expanded against the working directory, so a run
  // checked a subset of the configured docset and still exited 0.
  const glob = (value: string): string =>
    isAbsolute(value) ? value : resolvePath(dir, value).replace(/\\/g, "/");

  return {
    ...config,
    ...(config.paths ? { paths: config.paths.map(glob) } : {}),
    ...(config.exclude ? { exclude: config.exclude.map(glob) } : {}),
    ...(config.templates ? { templates: config.templates.map(ref) } : {}),
    ...(config.template ? { template: ref(config.template) } : {}),
    ...(config.types
      ? {
          types: Object.fromEntries(
            Object.entries(config.types).map(([type, value]) => [
              type,
              ref(value),
            ]),
          ),
        }
      : {}),
    ...(config.overrides
      ? {
          overrides: config.overrides.map((o) => ({
            files: glob(o.files),
            template: ref(o.template),
          })),
        }
      : {}),
  };
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
    .description(
      "Lint the given files/dirs/globs, routing each page by its `type` frontmatter",
    )
    .argument(
      "[paths...]",
      "files, directories, or globs to lint (use - for stdin)",
    )
    .option(
      "-t, --template <ref>",
      "apply this template to every file, overriding type routing",
    )
    .option(
      "--templates <path...>",
      "template files to route by: their `types:` win over built-ins; repeatable",
    )
    .option("-c, --config <path>", "path to moose.config.yaml")
    .option(
      "--explain",
      "print how each file's template was chosen, and lint nothing (always exits 0)",
    )
    .option("--as <format>", "force an input format (e.g. markdown, mdx)")
    .option(
      "--exclude <glob...>",
      "globs to exclude from directory/glob expansion; repeatable",
    )
    .option(
      "-f, --format <format>",
      "output: pretty | json | github | sarif",
      "pretty",
    )
    .addHelpText(
      "after",
      [
        "",
        "Examples:",
        "  moose-lint docs/                               # route each page by its `type`",
        "  moose-lint docs/ --templates ./templates.yaml  # add your own templates",
        "  moose-lint                                     # targets from moose.config.yaml",
        "  moose-lint docs/ --explain                     # show why each page routed where",
        "  moose-lint page.md -t tgdp:how-to:1.6          # force one template",
        '  moose-lint "**/*.md" -f github                 # CI annotations',
        "  moose-lint docs/ --exclude '**/drafts/**'",
        "  cat page.md | moose-lint - -t tgdp:how-to:1.6 --as markdown",
      ].join("\n"),
    )
    .action(async (paths: string[], options, command: Command) => {
      try {
        const format = reportFormat(options.format);
        const stdinContent = paths.includes("-")
          ? await readStdin()
          : undefined;

        const explain = options.explain === true;
        // Config is read here rather than inside the command core, so that
        // `runLint` stays a pure function of the options it is handed and a
        // library caller is never surprised by a file on disk.
        const found = await loadConfig(options.config);
        const config = rebaseConfig(found);

        const run = await runLint({
          // Positional paths win; `paths:` is the fallback that lets CI run a
          // bare `moose-lint`.
          inputs: paths.length > 0 ? paths : (config.paths ?? []),
          template: options.template,
          templates: options.templates ?? config.templates,
          as: options.as,
          // Excludes accumulate rather than replace: a flag narrows a run
          // further, it does not discard the repo's standing exclusions.
          exclude: [...(config.exclude ?? []), ...(options.exclude ?? [])],
          types: config.types,
          overrides: config.overrides,
          // `template:` in config is the default for a page that declares no
          // type - the bottom of the chain, not the top. `--template` is the top.
          defaultTemplate: config.template,
          explain,
          stdinContent,
        });

        const color = resolveColor(command.parent ?? command);
        const text = render(run, explain ? "explain" : format, { color });
        if (text.length > 0) process.stdout.write(`${text}\n`);
        // `--explain` answers a question about configuration, so its exit code
        // reports whether it could answer it - not whether the docs are clean.
        process.exitCode = explain ? 0 : run.summary.failed > 0 ? 1 : 0;
      } catch (err) {
        fail(err);
      }
    });

  program
    .command("templates")
    .description("List the templates that can be applied, and the types they serve")
    .option("--templates <path...>", "also list the templates in these files")
    .option("-c, --config <path>", "path to moose.config.yaml")
    .option("-f, --format <format>", "output: pretty | json", "pretty")
    .action(async (options, command: Command) => {
      try {
        const format = listFormat(options.format);
        // The listing answers "what could route a page?", so it has to see the
        // same template files a lint would.
        const found = await loadConfig(options.config);
        const info = await runTemplates({
          // Rebased for the same reason the lint path is: this command answers
          // "what could route a page?", so it must resolve the config's
          // template paths exactly as a lint would.
          templates: options.templates ?? rebaseConfig(found).templates,
        });
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
