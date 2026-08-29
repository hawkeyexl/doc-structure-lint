---
status: "accepted"
date: 2026-08-29
decision-makers: [hawkeyexl]
---

# Remove the bundled language model; structure linting is deterministic

## Context and Problem Statement

The `instructions:` key let a template attach natural-language requirements to a
section — "Must mention the intent of the document" — and `instructionValidator`
evaluated them by running **Llama 3.2 3B locally**, through `node-llama-cpp`,
against a JSON-schema grammar that forced a pass/fail verdict.

The cost was not subtle. A `postinstall` script downloaded roughly 2 GB of model
weights into a temp directory on every install, gated by a
`DOC_STRUCTURE_LINT_PRELOAD` environment variable that CI had to set. A model
context and chat session were created, and the model reloaded from disk, **once
per section per run**. And the answer was a sample from a 3B model: the same
document and the same template could pass and then fail, so the tool could not be
a gate.

It was also the wrong tool in the wrong repository. This is one of a family —
`moose-meta` validates frontmatter against JSON Schema, `moose-kg` derives graphs,
`moose-docevals` judges prose with an LLM behind a provider abstraction and a
consensus/confidence layer, `moose-tracevals` does the same for agent traces.
`moose-docevals` already treats this tool as a deterministic *grader* it invokes
(`tool:doc-structure-lint`). Two tools in one family both making AI judgments,
one of them with a bundled 3B model and no confidence gating, is a duplicated and
strictly worse capability.

## Decision Drivers

- A linter that is used as a CI gate must be a total function of its inputs.
- Judgment about prose already has an owner in the family, with the provider
  abstraction, cost ceilings, and ensemble judging this tool does not have.
- A 2 GB `postinstall` download is a serious cost for a structure checker, and it
  is paid by everyone, including users with no `instructions:` in any template.
- Templates in the wild carry `instructions:`, and those authors must be told
  where the capability went, not left to discover silence.

## Considered Options

- **Remove it; make `instructions:` a hard template error naming the replacement**
- Remove it silently, ignoring the key
- Keep it, behind an opt-in flag, on `@hawkeyexl/inference` instead of a bundle
- Keep it as is

## Decision Outcome

Chosen option: **remove it, and reject `instructions:` loudly.**

Deleted: `src/rules/instructionValidator.js`, `src/util/preloadModel.js`,
`src/util/tempDir.js`, the `node-llama-cpp` dependency, the `postinstall` and
`clean` scripts, and `DOC_STRUCTURE_LINT_PRELOAD` from the package and from CI.

`instructions:` is rejected by `src/schemas/template.json` rather than ignored,
and the loader turns that rejection into a message that names the offending
template path and prints the equivalent `moose-docevals` eval, with the author's
own instruction text carried across:

```
templates.yaml: "templates.how-to.sections.title" uses `instructions`, which
moose-lint no longer evaluates — structure checking is deterministic. Move it to
a moose-docevals assertion eval in moose.config.yaml:

  docevals:
    evals:
      how-to-title:
        assertion: Must mention the intent of the document
        grader: ai
```

Removing the model also made the whole validator **synchronous**. `validateSection`
was `async` only to await the model; with it gone, matching and every rule are
ordinary function calls, and the recursion through subsections loses its
`await`-in-a-loop.

Three other dependencies went with it, all replaced by the platform or by the
family: `axios` (Node 24 has `fetch`, which `docmeta`'s registry already uses),
`crypto` (an npm shim of a Node builtin), and `uuid` (the parser now identifies
sections by slug, as `moose-kg` does). Together with `node-llama-cpp`, that is the
entire native-code and network surface of the install.

### Consequences

- Good, because the same document and template now always produce the same
  findings, which is what a CI gate requires.
- Good, because install is a plain JavaScript dependency tree: no native build,
  no model download, no `postinstall`.
- Good, because the family's boundary is now stated rather than implied —
  moose-lint answers "does this page have the shape it claims", moose-docevals
  answers "is the prose any good".
- Good, because a run costs milliseconds instead of a model load per section.
- Bad, because a real capability is gone from this tool, and templates using it
  break at load time rather than degrading. That is deliberate: silence would
  mean a rule the author believes is enforced, is not.
- Bad, because the migration is manual. The error prints the eval to paste, but
  nothing writes it to `moose.config.yaml`. An `eject-instructions` command was
  considered and deferred; it can be added if real templates make it worth it.
- Neutral, because `moose-docevals`' `tool:doc-structure-lint` adapter is
  unaffected by this change specifically — it parses the JSON reporter, whose
  shape is unchanged. It does need updating for the rename, separately.

### Confirmation

`grep -ri "llama|preloadModel|tempDir|DOC_STRUCTURE_LINT_PRELOAD"` over `src/`,
`package.json`, and the workflow returns nothing.

The `instructions:` rejection is pinned in `test/unit/template-registry.test.ts`,
and was exercised end to end against this repository's own `templates.yaml`,
which carried two `instructions:` blocks: the CLI exited 2 with the migration
message before the blocks were removed, and exits 0 after.

## Pros and Cons of the Options

### Remove it; make `instructions:` a hard template error naming the replacement

- Good, because no author silently loses a check they wrote.
- Good, because the error is actionable: it contains the replacement config.
- Bad, because it is a breaking change for any template using the key.

### Remove it silently, ignoring the key

- Good, because no template stops loading.
- Bad, because a rule the author believes is enforced quietly is not — the worst
  outcome available for a tool whose job is enforcement.

### Keep it behind an opt-in flag, on `@hawkeyexl/inference`

- Good, because it preserves the capability without the bundled model, and
  reuses the family's provider layer.
- Bad, because the tool is then only conditionally deterministic, and "was the
  flag on?" becomes part of reading any result.
- Bad, because it rebuilds a worse `moose-docevals` inside a linter: no
  ensemble, no confidence gating, no cost ceiling.

### Keep it as is

- Good, because it costs nothing to decide.
- Bad, because every objection above stands, and each release makes the 2 GB
  install and the nondeterminism harder to walk back.
