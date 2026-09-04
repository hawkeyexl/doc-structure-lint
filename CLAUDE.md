# CLAUDE.md

Guidance for agents working in this repository.

## What moose-lint is

A TypeScript CLI (published to npm) that validates the **structure** of a
document against a doctype template, routed by the page's own `type` frontmatter.
The pipeline resolves targets, parses each to a generic section tree, resolves a
template per file, matches sections to rules, runs content rules, and reports.

It is **deterministic**. There is no language model, and there are no network
calls except fetching a template you point it at. If you find yourself reaching
for inference, the answer belongs in `moose-docevals`, not here.

Key layers:

- `src/parsers/` holds per-format parsing behind the `DocumentParser` interface
  (`src/types.ts`). Each parser flattens its own AST into ordered `Block`s;
  `sectionize.ts` folds those into the `SectionNode` tree once, for every format.
  A new format is one file plus a line in `src/parsers/index.ts`.
- `src/core/match.ts` decides which rule describes which section. Read the file
  header before touching it; the decisions are subtle and each has a test.
- `src/core/resolve-template.ts` decides which template describes which page.
- `src/rules/` holds the content rules over the generic content model.
- `src/commands/` holds the command cores (`lint`, `templates`, `formats`), kept
  free of CLI/IO plumbing so they can be unit-tested directly.
- `src/cli.ts` is a thin commander wrapper over the command cores.
- `src/reporters/` formats output (pretty / json / github / sarif).
- `src/templates/` holds the built-in doctype templates and the manifest that
  registers them.

## Working agreements

Project preferences. Follow them unless the user says otherwise.

### The generic tree is the contract

Everything downstream of `parse()` operates on `SectionNode` and `ContentNode`.
**Rules must never reach for mdast node types**, or the parser registry is a
fiction and every rule silently becomes Markdown-only. If a rule needs something
the content model cannot express, grow the model rather than special-casing one
format. Growing it means touching every parser, deliberately.

### Red/green TDD

Develop test-first:

1. **Red**. Write or adjust tests for the new behavior and run them. Confirm
   they fail for the right reason.
2. **Green**. Implement the minimum to make them pass.
3. **Refactor**. Clean up with the tests as a safety net.

When a behavior change makes existing tests fail correctly, update those tests as
part of the red step rather than working around them.

### Unit tests pin rules; integration tests catch the rest

Both matter, and the second has repeatedly caught what the first could not:

- The greedy-slot error passed every unit test and was caught by linting this
  repo's own `templates.yaml`.
- The `dist/` template-path bug passed every test, because the suite runs against
  `src/`, where the templates sit one directory deeper. That is why
  `npm run smoke` exists and runs in CI.

So: when a change could behave differently in the built package than in the repo,
add a smoke check. When a change affects matching, lint a real document with it.

### Test fixtures per feature

When a feature needs sample input, add a **dedicated fixture** under
`test/fixtures/` rather than embedding large literals in tests or reusing an
unrelated one. Name it for what it exercises. Inline strings are fine for small
parse cases.

### Commands must have parallel behaviors

Every subcommand exposes a consistent surface. Targets are positional
`[paths...]`; `-` reads stdin (with `--as`); shared flags keep the same names and
semantics (`--as`, `--exclude`, `-c/--config`, `-f/--format`, `--no-color`). Do
not introduce per-command input conventions.

Exit codes follow clig.dev and are load-bearing for CI: **0** clean, **1** lint
findings, **2** operational or usage error. A `MooseLintError` always means 2.

### The JSON reporter's shape is an API

`moose-docevals` parses `[{ file, success, errors: [...] }]` off stdout, and it
*parses* rather than validates, so a renamed key yields zero findings instead of
an error. Adding keys is safe; renaming or nesting is not. `test/unit/reporters.test.ts`
pins it deliberately.

### Built-in templates are derived, not authored

The templates under `src/templates/tgdp/` mirror The Good Docs Project at a
pinned release. Upstream is the authority: `test/integration/tgdp.test.ts` lints
TGDP's own published template, vendored verbatim, against ours. **Never edit a
vendored fixture to make a template pass.** If they disagree, the template is
wrong. When moving the pin, bump the version in every id. A version in an id is
a claim about which upstream revision it mirrors.

### One config file, one key

Settings live in a shared `moose.config.yaml`, and this tool reads only the
`lint:` key. Sibling tools' keys are neither read nor validated. Within our
section, validation is strict (`additionalProperties: false` at every level).
That strictness turns a typo into a loud failure instead of a silent default.

Do not add JSON Schema `default`s to booleans in either schema. A written-in
default is indistinguishable from a value the author typed, and it beat inherited
values in `extends` merges once already.

### Record decisions

Non-obvious decisions go in `adrs/`, in the format the existing records use.
Name the options you rejected and what was good about them. Write the
Confirmation section naming the tests that would fail if the decision were
reversed. See [`adrs/README.md`](adrs/README.md).

## Commands

```bash
npm test                  # vitest
npm run typecheck         # tsc --noEmit
npm run build             # tsup -> dist/
npm run smoke             # build, then exercise the real dist/cli.js
npm run lint:prose        # the house voice, over this repo's own prose
npm run check:tgdp-pin    # has upstream moved past the pinned TGDP release?
```

The pre-commit hook runs `typecheck` and `test`.

### Prose is linted too

`npm run lint:prose` runs [Vale](https://vale.sh) against the house voice and
fails on any alert at any severity, exactly as CI does. It needs `vale` on your
PATH; the styles themselves are fetched by `vale sync` and are not committed.
Pass `-- --no-sync` to skip the fetch offline.

The script exists because `vale`'s own exit status covers error-level alerts
only, and one enabled rule is a warning. A bare `vale .` would pass locally
what the gate fails.

The scope is this repo's own prose: README, ADRs, and this file. Test fixtures
and `artifacts/` are exempt in `.vale.ini`, because `test/fixtures/tgdp/` is
vendored verbatim from upstream and the rest is input chosen for what it parses
to. Rewriting either to quiet an alert would break the test that reads it.

The rule package is pinned in `.vale.ini`, for the reason the TGDP templates
are. A gate whose rules arrive from `latest` can turn every open pull request
red on a day nobody chose. Move the pin deliberately, and expect prose work.
See [ADR 01008](adrs/01008-gate-on-prose-lint-against-a-pinned-rule-set.md).

## Pre-1.0

Breaking CLI and template-format changes are acceptable and do not need
deprecated aliases. Commits follow Conventional Commits; `semantic-release`
derives the version, so mark breaking changes with `!` and a `BREAKING CHANGE:`
footer.
