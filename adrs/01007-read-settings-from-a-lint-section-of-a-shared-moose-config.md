---
status: "accepted"
date: 2026-08-29
decision-makers: [hawkeyexl]
---

# Read settings from a `lint:` section of a shared `moose.config.yaml`

## Context and Problem Statement

`moose-lint` had no configuration at all. Every run restated its targets, its
excludes, and its template files on the command line. That is workable for one
invocation and not for CI. There the same twelve flags get copied into a
workflow file, and drift from what developers run locally.

The obvious fix is to give the tool its own dotfile, and the family has already
rejected it. `moose-lint` is one of several tools routinely used in the same
repository. `moose-meta` validates the frontmatter, `moose-docevals` judges the
prose, and `moose-kg` builds the graph. A project wiring up all of them would
accumulate a dotfile per tool that nobody could see the relationship between.
The settings they share would have to be restated and kept in sync in each.

`moose-tracevals` settled this in
[its ADR 01009](https://github.com/hawkeyexl/agentevals), and `moose-docevals`
and `moose-meta` follow it. The question here is not what to decide but whether
to follow, and what following costs a tool whose config arrives after its CLI.

## Decision Drivers

- One file per project, not one per tool, so shared settings are stated once.
- A tool must never fail, warn, or otherwise care because a sibling tool's keys
  are in the file.
- Validation must stay strict for the keys this tool owns. Setting
  `additionalProperties: false` at every level turns a typo into a loud failure
  rather than a silent default.
- The ways an author can lose a whole config must be reported, not defaulted
  through. A config that is silently ignored is worse than no config, because the
  author believes their settings are in force.
- The command core must stay a pure function of its options, so a library caller
  is never surprised by a file on disk.

## Considered Options

- **A single `moose.config.yaml`, this tool reading its own `lint:` key**
- A dedicated `moose-lint.config.yaml`
- Per-tool files plus an optional shared file merged under a per-tool key
- No configuration; flags only

## Decision Outcome

The chosen option is **a single `moose.config.yaml`, read under `lint:`.**

The file root is a mapping of tool name to that tool's settings. `loadConfig()`
reads the file, takes the `lint` value, and hands that to `parseConfig()`.
Sibling keys are neither read nor validated. There is no registry of known
tools, no coordination, and no version coupling between the tools. `src/schemas/config.json`
describes **the section**, so its strictness applies at every level below `lint:`
and nowhere above it.

Discovery walks up from the working directory to the repository root, so the tool
behaves the same from a subdirectory as from the top. `-c/--config` names a file
directly and skips discovery. It gets no filename sniffing, because users may
name an explicitly-passed file anything.

**Config is loaded in the CLI, not in `runLint`.** The command core keeps taking
everything it needs as options. A library caller gets exactly the run they asked
for, and a test constructing `LintOptions` cannot accidentally pick up a file
from the working directory.

Flags beat the file, with one deliberate exception: `--exclude` **accumulates**
with the configured excludes rather than replacing them. Narrowing a run should
not quietly discard the repo's standing exclusions. The alternative is a flag
that silently re-includes `node_modules`, which is a trap.

Four shapes are rejected rather than defaulted through, each because it silently
discards an entire configuration:

- **The un-nested config.** Keys this tool owns sit at the top level with no
  `lint:`. The stray keys are named, and the list is derived from the schema's
  own `properties` so it cannot drift from the real key set.
- **The miscased wrapper.** A top-level key matches `lint` case-insensitively
  but not exactly. The stray-key check cannot see this one, because its keys are
  nested rather than at the top level.
- **The un-renamed config.** There is a `doc-structure-lint.config.yaml` and no
  `moose.config.yaml`. The error names the new filename and the required key.
- **An unreadable `moose.config.yaml`.** A directory carries that name, or a
  permissions error blocks it. Only `ENOENT`/`ENOTDIR` counts as absent, and anything else is reported
  rather than defaulted through. It must not reach the legacy check, which would
  otherwise blame a missing file for a permissions problem.

A file that is absent, empty, or that carries only other tools' sections is not
an error, and all defaults apply. That case keeps a shared file usable by a
project that has not adopted this tool yet. It is also the common case here,
since a repo whose pages all declare their `type` needs no config at all.

### Consequences

- Good, because a project configures the whole family in one reviewable file, and
  CI runs a bare `moose-lint`.
- Good, because the strictness that catches typos is unchanged for our own keys,
  while sibling keys cost nothing.
- Good, because the migration mistakes fail loudly with an actionable message
  instead of quietly running on defaults.
- Good, because `runLint` is unchanged in kind: config supplies values for
  options it already had, so nothing downstream knows config exists.
- Bad, because the file root is unvalidated by construction. A top-level key that
  is a genuine misspelling of `lint`, such as `lnt:` or `linting:`, is
  indistinguishable from another tool's section and still yields defaults. The
  two likeliest shapes are covered. A wrapper misspelled any other way is not,
  and cannot be without a registry of known tool names, which is exactly the
  coupling this avoids.
- Bad, because configuration now has two homes, flags and a file, so "why is
  this value not taking effect?" has two places to look. `--explain` answers it
  for template resolution, which is where it matters most.
- Neutral, because nothing reads `doc-structure-lint.config.yaml`; it is detected
  only to produce the migration error. Nothing ever wrote one, because the
  pre-rename tool had no config, so this is a courtesy for a file that may not
  exist.

### Confirmation

`test/unit/config.test.ts` pins the behavior against real files in a temp
directory rather than a mocked filesystem. The section is read and sibling
sections are ignored. An absent file and an other-tools-only file both yield
defaults. Each of the four rejected shapes raises a `MooseLintError`, with the
unreadable case asserting specifically that the legacy file is not blamed for
it. Discovery from a subdirectory and `-c` on a missing path are covered too.

## Pros and Cons of the Options

### A single `moose.config.yaml`, each tool reading its own top-level key

- Good, because one file is the whole story: no precedence rules between files,
  no second place to look.
- Good, because tools stay decoupled. A tool needs to know its own key and
  nothing else.
- Bad, because the file root cannot be strictly validated by any single tool.

### A dedicated `moose-lint.config.yaml`

- Good, because the file could be validated root to leaf, closing the misspelled-
  wrapper hole entirely.
- Bad, because it scales linearly in dotfiles across the family and forces shared
  settings to be restated per tool, which is where they drift.
- Bad, because it diverges from three sibling tools for no gain the user sees.

### Per-tool files plus an optional shared file merged under a per-tool key

- Good, because it is backward compatible, which would matter if anything had
  ever written a config for this tool.
- Bad, because two sources for one value need precedence rules. Every "why is
  this not taking effect?" then has two files to check rather than one.

### No configuration; flags only

- Good, because it is the status quo and costs nothing.
- Bad, because CI and local runs drift, which is the failure this exists to
  prevent.
- Bad, because `overrides` and a default template have nowhere to live, so two
  stages of the resolution chain stay permanently theoretical.
