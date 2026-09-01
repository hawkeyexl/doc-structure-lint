# moose-lint

Validate the **structure** of a document against a doctype template. Deterministic,
built for CI.

> **Renamed from `doc-structure-lint`.** This package was published as
> `doc-structure-lint` up to v0.0.4 and is `moose-lint` from here. The CLI is not
> compatible: `--file-path` and `--template-path` are gone, targets are
> positional, and `instructions:` has been removed from the template format. See
> [Migrating](#migrating-from-doc-structure-lint).

`moose-lint` checks that a page has the shape it claims to have: the sections a
doctype calls for, in order, holding the paragraphs, code blocks, and lists that
doctype requires. It reads the document as a syntax tree — it does not pattern-match
source text — and it does not judge prose. Every run is a function of the document
and the template, so the same inputs always produce the same findings.

It is one of a family of documentation tools, and it deliberately does one job:

| tool | question it answers |
| --- | --- |
| [`moose-meta`](https://github.com/hawkeyexl/docmeta) | Is the frontmatter present and well-formed? |
| **`moose-lint`** | **Does the body have the shape its doctype calls for?** |
| [`moose-docevals`](https://github.com/hawkeyexl/moose-docevals) | Is the prose any good? |
| [`moose-kg`](https://github.com/hawkeyexl/moose-kg) | How do these pages relate to each other? |
| [Doc Detective](https://doc-detective.com) | Do the documented steps actually work? |

Judgment about writing quality belongs to `moose-docevals`, which has the provider
abstraction, cost ceilings, and ensemble judging for it. `moose-lint` has no
language model and makes no network calls except to fetch a template you point it at.

## Install

```bash
npm install -g moose-lint
```

Requires Node.js 24 or later.

## Quick start

Point it at files, directories (walked recursively), or globs. Each page is
checked against the template for the doctype it declares, so there is no
template flag to pass.

```bash
moose-lint docs/
```

```text
✗ docs/api-keys.md
    1:1  unknown_type  No template serves type "refernce". Did you mean "reference"? Declare it on a template with "types:", then pass that file with --templates.
✗ docs/configure.md
    7:1  heading_const_error  Prerequisites: Expected title "Overview", but found "Prerequisites"
✓ docs/install.md
- docs/notes.md  skipped: no type in frontmatter and no template resolved

3 files checked, 1 passed, 2 failed, 1 skipped
```

A clean run exits `0`, findings exit `1`, and an operational error — no inputs, an
unreadable template, an invalid template — exits `2`.

## Routing by `type`

A page declares what it is in its frontmatter, and its template follows from
that:

```markdown
---
type: how-to
---

# Install the widget
```

`type` is the same key `moose-meta`'s OKF, Diataxis, and TGDP schemas already
validate, so a repo that types its pages gets routing for free — and one run can
lint a tree of mixed doctypes, each page checked against the doctype it claims.
The seven [built-in templates](#built-in-doctype-templates) cover the common
ones out of the box.

### The resolution chain

Highest precedence first:

| | source | what it says |
| --- | --- | --- |
| 1 | `--template <ref>` | an operator overriding everything, for one run |
| 2 | `$template` in the page's frontmatter | this page, specifically, is an exception |
| 3 | a configured `overrides` glob | repo policy: "everything under `docs/api` is a reference" |
| 4 | the page's `type` | what the page says it is |
| 5 | a configured default | what to assume when a page says nothing |

Steps 3 and 5 are repo policy, written in
[`moose.config.yaml`](#configuration).

Two of these come out of the document, and the difference between them is what
`$template` is restricted for. A page's `type` is document-controlled, but it
only *selects* from the routing table the operator assembled — a page cannot
introduce a template that way, only ask for one already on offer. `$template`
names a reference directly, which is the one place a document says where a
template comes from rather than which one it wants.

So `$template` cannot name a URL. A relative path or a built-in id is fine —
`$template: ./house.yaml#house` resolves beside the page that wrote it, not
beside wherever you ran the command — but `$template: https://…` is refused with
a `template_error`. Otherwise one line of frontmatter would make the machine
doing the linting fetch whatever that docset asked for, from inside whatever
network the CI job runs in. An operator who does want a remote template still
has steps 1, 3, 4, and 5.

### A missing `type` and an unknown one are different

A page with **no `type`** that resolves to nothing is **skipped**. It is counted
apart, it does not fail the run, and its neighbours are still checked.

```text
- docs/notes.md  skipped: no type in frontmatter and no template resolved
```

An untyped page is `moose-meta`'s complaint, not this tool's — its OKF schema
already requires `type`. Skipping is what lets you point `moose-lint` at a whole
tree on day one, when three pages out of two hundred are typed.

**Unless nothing at all was checked.** A run that finds files and checks none of
them exits `2`, because a linter that looked at nothing is indistinguishable
from a clean docset once it exits `0` — and a repo that adopts `moose-lint` in
CI before backfilling `type:` keys would get a permanently green job over an
unchecked tree.

```text
moose-lint: Nothing was checked: all 12 file(s) were skipped. Give a page a
"type:" that a template serves, pass -t/--template <ref>, or set
"lint.template" as a default. Run "moose-lint <paths> --explain" to see how
each file resolved.
```

One checked file is enough to make the rest ordinary skips. `--explain` is
exempt: showing why nothing routed is exactly its job.

A page whose `type` **resolves to no template** is an **error**: exit `1`, with
near misses named.

```text
✗ docs/api-keys.md
    1:1  unknown_type  No template serves type "refernce". Did you mean "reference"? Declare it on a template with "types:", then pass that file with --templates.
```

A typo has to fail, because the alternative is a page that silently stops being
checked and nobody finding out.

### `--explain`

`--explain` prints how each file's template was chosen, and lints nothing. Every
stage is listed, including the ones that had nothing to say: "why was this page
linted with *that*?" is usually asked because the answer was surprising, and the
surprising part is almost always a stage you forgot applies.

```bash
moose-lint docs/ --explain
```

```text
- docs/api-keys.md
    · cli                  --template not given
    · frontmatter-template no $template in frontmatter
    · config-override      no overrides configured
    · type                 type: refernce matches no template
    ✗ no template serves type "refernce"; did you mean reference?

▸ docs/configure.md
    · cli                  --template not given
    · frontmatter-template no $template in frontmatter
    · config-override      no overrides configured
    → type                 tgdp:how-to:1.6  type: how-to -> builtin template

▸ docs/install.md
    · cli                  --template not given
    · frontmatter-template no $template in frontmatter
    · config-override      no overrides configured
    → type                 tgdp:how-to:1.6  type: how-to -> builtin template

- docs/notes.md
    · cli                  --template not given
    · frontmatter-template no $template in frontmatter
    · config-override      no overrides configured
    · type                 no type in frontmatter
    · config-default       no default configured
    skipped: the page declares no type

4 files, 2 routed, 2 unrouted
```

`▸` means the page was routed and `-` that it was not. Neither is a verdict on
the document — `docs/configure.md` is routed and still fails the lint above — and
`--explain` exits `0` however the docs look. It answers a question about
configuration, not about the documents.

That includes pages it could not route at all: a `type` no template serves
prints a `✗` line and still exits `0`, because "nothing serves this type" is an
answer. So do not gate CI on `--explain`'s exit code — it will pass over a
docset whose every page is unrouted. The ordinary run is what reports that, and
exits `1`.

## Commands

```text
moose-lint [paths...]   Lint, routing each page by its `type`. -t/--template <ref>,
                        --templates <path...>, -c/--config <path>, --explain,
                        --as <format>, --exclude <glob...>,
                        -f/--format <pretty|json|github|sarif>, --no-color
moose-lint templates    List resolvable templates and the doctypes they serve
moose-lint formats      List input formats, implemented and planned
```

`-t/--template <ref>` is optional. Given, it applies one template to every file
in the run and overrides routing entirely — which is what you want for a single
page, and what you do not want for a tree.

`--templates <path>` adds a template file to the run: its templates' `types:`
join the routing table, and win over the built-ins for the doctypes they claim.

`-` as a path reads the document from stdin, and needs `--as` to pick a parser.

## Input formats

Structure comes from a real parse, behind a per-format registry: adding a format
does not touch matching, rules, or reporting.

```bash
moose-lint formats
```

| format | extensions | metadata read from |
| --- | --- | --- |
| Markdown | `.md`, `.markdown` | fenced frontmatter |
| MDX | `.mdx` | fenced frontmatter |
| HTML | `.html`, `.htm` | `<meta>` and `<title>`, or fenced frontmatter |
| AsciiDoc | `.adoc`, `.asciidoc` | the `:key: value` document header, or fenced frontmatter |
| reStructuredText | `.rst` | the docinfo field list, or fenced frontmatter |
| XML | `.dita` in directory walks; `.xml` and `.dita` when named | root-element attributes |

One template checks all of them. The same `tgdp:how-to:1.6` lints a Markdown
page, an AsciiDoc page, and a DITA topic, and reports **the same findings** —
`test/integration/cross-format.test.ts` holds a fixture pair per format and
asserts exactly that. If a template ever needed per-format special-casing, the
content model would be wrong.

Each parser maps its own vocabulary onto three generic content kinds —
`paragraph`, `code`, `list`. Anything a doctype template cannot describe
(blockquotes, tables, admonitions, figures) is **skipped rather than
approximated**: counting a table as a list would make `lists: {max: 1}` fail
documents that satisfy it.

XML is the one format with no universal notion of a section, because that comes
from the schema rather than the syntax. It ships declarative vocabulary mappings
for **DITA** and **DocBook**, selected by scoring the document's root element,
namespace, and element names; a bespoke schema is one more entry in the same
table. See the header of [`src/parsers/xml.ts`](src/parsers/xml.ts).

## Template format

Templates are YAML or JSON. A file holds one or more named templates; each
describes a document as nested sections.

```yaml
templates:
  how-to:
    types: [how-to] # doctypes this template serves
    sections:
      title: # matches the H1
        paragraphs:
          min: 1
        sections: # H2s beneath it, in order
          overview:
            heading:
              const: Overview
            paragraphs:
              min: 1
          before you start:
            heading:
              const: Before you start
            required: false
          task:
            repeat: true # a run of sections; no heading rule, so any title
            additionalSections: true
          see also:
            heading:
              const: See also
```

`types:` is what makes a template you wrote first-class rather than a fallback.
Built-ins are loaded first and user templates overwrite them, so overriding the
how-to doctype for a repo is one file with `types: [how-to]` in it — no config
entry, no flag beyond `--templates`. A doctype your file does not claim stays on
its built-in.

```bash
moose-lint docs/ --templates ./templates.yaml
```

This repository's own [`templates.yaml`](templates.yaml) carries a worked
example: `api-operation-guide` declares `types: [api-operation]` and nothing
else, and every page with `type: api-operation` routes to it. If two templates in
the file claim the same doctype, the later one wins.

### Section rules

```yaml
description: What this section is for. Not validated against.
heading:
  const: Exact heading text # or:
  pattern: ^Regex against the heading$
required: true # default true
repeat: false # default false; true claims a run of sections, not just one
additionalSections: false # allow subsections this template does not describe
sections: {} # nested section rules, in document order
```

A section rule that constrains no heading text is a **slot**: it matches whatever
heading is in that position. That is how you describe a section whose title varies
by page.

`repeat` is what a rule sets to claim more than one section, and it applies to
both kinds of rule:

- On an **anchored** rule — one with `heading.const` or `heading.pattern` — it
  claims the run of consecutive sections whose headings satisfy it. That is how
  a doctype says "one or more sections named `Symptom N`" without giving up
  checking the heading text.
- On a **slot** it claims every section up to the next anchored rule that could
  claim one.

Without it either kind claims exactly one section, so two adjacent slots each get
their own. That default is deliberate: adjacent unconstrained sections are
ordinary in hand-written templates, and a greedy first slot would swallow the
second one's section and then report it missing.

### Content rules

```yaml
paragraphs:
  min: 0
  max: 10
  patterns: # regexes applied to paragraphs in order
    - ^Start with.*
code_blocks:
  min: 0
  max: 5
lists:
  min: 0
  max: 5
  items:
    min: 1
    max: 10
    paragraphs: { min: 0, max: 2 } # rules inside each list item
    code_blocks: { max: 1 }
    lists: { max: 2 }
sequence: # a strict order of content, before any subsection
  - paragraphs: { min: 1 }
  - code_blocks: { max: 1 }
  - lists: { min: 1 }
```

### Reuse

`$ref` shares a definition within a file:

```yaml
templates:
  api-operation:
    sections:
      request-parameters:
        $ref: "#/components/parameters"
```

`extends` inherits another template — a built-in id, a path, or a URL. The merge
recurses through `sections` by key, so tightening or relaxing one nested rule
keeps its siblings; every other key the child sets replaces the parent's
outright.

That is how you keep a built-in and disagree with one part of it.
`tgdp:how-to:1.6` requires a `See also` section, because upstream ships one and
does not mark it optional the way it marks `Before you start`. Plenty of real
how-tos have none. To keep the rest of the doctype and drop that one
requirement — this is `house-how-to` in [`templates.yaml`](templates.yaml):

```yaml
templates:
  house-how-to:
    types: [how-to] # claim the doctype, so pages route here instead
    extends: tgdp:how-to:1.6
    sections:
      title:
        sections:
          see also:
            required: false
```

The same page, against the built-in and then against the house version:

```text
$ moose-lint page.md
✗ page.md
    5:1  missing_section  Do it: Missing section "See also"

1 file checked, 0 passed, 1 failed, 0 skipped

$ moose-lint page.md --templates templates.yaml
✓ page.md

1 file checked, 1 passed, 0 failed, 0 skipped
```

`Overview`, `Before you start`, and the repeating task sections are all still
checked. Only `See also` became optional.

### Templates are trusted input

A template is executable configuration, at the same trust level as the linter
itself or an ESLint config. `heading.pattern` and the `patterns:` under
`paragraphs` are full JavaScript regular expressions, compiled and run as
written. Review a template you did not write, including one `extends` fetches
from a URL, the way you would any other executable configuration.

## Built-in doctype templates

Seven templates ship with the tool, derived by hand from
[The Good Docs Project](https://gitlab.com/tgdp/templates) templates pinned at
**v1.6.0 ("Iron")**. No flag turns them on: a page declaring one of these
doctypes routes to them.

| id | serves `type:` | derived from |
| --- | --- | --- |
| `tgdp:how-to:1.6` | `how-to` | How-to guide |
| `tgdp:tutorial:1.6` | `tutorial` | Tutorial |
| `tgdp:reference:1.6` | `reference` | Reference |
| `tgdp:concept:1.6` | `concept`, `explanation` | Concept |
| `tgdp:troubleshooting:1.6` | `troubleshooting` | Troubleshooting |
| `tgdp:release-notes:1.6` | `release-notes` | Release notes |
| `tgdp:readme:1.6` | `readme` | README |

`tgdp:concept:1.6` serves Diataxis's `explanation` as well as TGDP's `concept`:
they are the same shape under two names.

```bash
moose-lint templates
```

Each built-in is round-trip tested. `test/integration/tgdp.test.ts` lints TGDP's
own published `template_<slug>.md` — vendored verbatim under
`test/fixtures/tgdp/` — against the template derived from it, and requires zero
findings. Where the two disagree, upstream is right. That is what makes
"publicly vetted" checkable rather than a claim.

The version in an id is a promise about which upstream revision the template
mirrors, so `npm run check:tgdp-pin` asks GitLab whether upstream has moved past
the pin and reports what moving it would involve. It is a report, not a gate:
upstream moving does not make the pinned templates wrong, it makes them old.

### The H1, and pages that have none

Every built-in models upstream's H1 as its top-level section, because that is
how the published templates are written. Docusaurus, Hugo, and Starlight all
render the page title from frontmatter, so their pages legitimately start at
`##` and have no H1 to match.

Those pages work. When a page carries a frontmatter `title` and its body has no
H1, that title *is* the document's H1 — findings about it are anchored on the
frontmatter, where the title actually lives:

```markdown
---
type: how-to
title: Install the widget
---

## Overview
```

```text
✓ install.md

1 file checked, 1 passed, 0 failed, 0 skipped
```

A page with neither an H1 nor a frontmatter `title` has no top-level section for
a doctype template to match, and will report one. That is a page a reader would
also struggle to name.

### One thing that will bite you

**`tgdp:how-to:1.6` requires `See also`.** Upstream includes it unconditionally
and never marks it optional, so the derived template requires it — and plenty of
real how-tos have none. Rather than substitute our judgment for TGDP's, relaxing
it is the worked [`extends` example](#reuse): one file, four lines.

## Configuration

Optional. A repo whose pages all declare their `type` needs none.

Settings live in **`moose.config.yaml`**, one file shared by the whole moose
family, with one top-level key per tool. `moose-lint` reads `lint:` and neither
reads nor validates anything else, so the file grows as you adopt more of the
family without any tool needing to know about the others.

```yaml
# moose.config.yaml
meta:                                # moose-meta's section; moose-lint ignores it
  schemas: ["google:okf:0.1"]

lint:
  paths: ["docs/**/*.md"]            # targets when none are given on the command line
  exclude: ["**/drafts/**"]          # added to the built-in node_modules/.git defaults
  templates: ["./templates.yaml"]    # your templates; their `types:` join the routing table
  template: tgdp:how-to:1.6          # what to assume when a page declares no type
  types:                             # an explicit doctype -> template mapping
    api-operation: ./templates.yaml#api-operation
  overrides:                         # repo policy; first matching glob wins
    - files: "docs/api/**"
      template: tgdp:reference:1.6
```

With that in place, CI runs a bare `moose-lint`.

Discovery walks up from the working directory to the repository root, so it
works from a subdirectory. `-c/--config <path>` names a file directly and skips
discovery.

Command-line flags win over the file, with one exception: `--exclude`
**accumulates** with the configured excludes rather than replacing them, because
narrowing a run should not quietly discard the repo's standing exclusions.

### What fails loudly

Validation inside `lint:` is strict — unknown keys are an error, not a silent
default. Beyond that, four shapes are rejected rather than defaulted through,
because each one silently discards a whole configuration:

| shape | why it is not just "no config" |
| --- | --- |
| keys at the top level with no `lint:` | the un-nested file: your settings are present and unread |
| a `Lint:` wrapper differing only in case | the keys are nested, so the check above cannot see them |
| a `doc-structure-lint.config.yaml` and no `moose.config.yaml` | the un-renamed file, left behind by the rename |
| a `moose.config.yaml` that exists but cannot be read | a directory by that name, a permissions problem |

A file that is absent, empty, or that carries only other tools' sections is not
an error. That is what keeps a shared file usable by a project that has not
adopted this tool yet.

## Using it as a library

```javascript
import { runLint } from "moose-lint";

// Routes each page by its `type`, exactly as the CLI does.
const run = await runLint({ inputs: ["docs/"] });
```

`template` and `templates` are optional and mirror `--template` and
`--templates`. `runLint` reads no configuration file — it is a function of the
options you hand it, so a library caller is never surprised by a file on disk.
Call `loadConfig()` yourself if you want the file.

## Output formats

| `-f` | for |
| --- | --- |
| `pretty` | reading. The default. |
| `json` | tool adapters: `[{ file, success, errors: [{ type, heading, message, position }] }]` |
| `github` | GitHub workflow commands (`::error file=…,line=…,col=…::`), inline on a pull request |
| `sarif` | code-scanning uploads — SARIF 2.1.0, one rule descriptor per finding type |

The SARIF output declares every finding type in `tool.driver.rules` and
references it by both `ruleId` and `ruleIndex`, so alerts group and filter
properly rather than arriving as a flat list. Paths are relative and
forward-slashed against a declared `SRCROOT`, on Windows as well as Linux.
Skipped files become `note`-level notifications rather than results: a skip is a
statement about the tool, which declined to look, not about the document — as
results they would open alerts on files nothing examined.

```bash
moose-lint docs/ -f sarif > moose-lint.sarif
```

## Migrating from `doc-structure-lint`

| before | now |
| --- | --- |
| `--file-path docs/` | positional: `moose-lint docs/` |
| `--template-path t.yaml --template how-to` | `--template t.yaml#how-to` |
| one template per run, always named | `--template` is optional; pages route by their own `type` |
| `--json` | `-f json` |
| `DOC_STRUCTURE_LINT_PRELOAD=1` | gone; there is no model to preload |
| `doc-structure-lint: 0.0.1` in a template file | remove it |
| `instructions:` in a section | move to a `moose-docevals` assertion eval |

`instructions:` used a bundled 2 GB local language model to judge prose, which made
runs non-deterministic and duplicated `moose-docevals`. Loading a template that
still uses it fails with a message containing the replacement config to paste. See
[ADR 01003](adrs/01003-remove-the-language-model-and-be-deterministic.md).

Section matching also changed. It used to pair template rules to document sections
by array index, so a single absent optional section misaligned every comparison
after it. It is now one ordered pass over heading identity — see
[ADR 01002](adrs/01002-match-sections-in-order-not-by-index.md). Templates that
worked before still work once `instructions:` and the `doc-structure-lint:`
version key are gone; templates with optional sections now work *correctly*.

`--template` still applies one template to every file, so an existing invocation
keeps working unchanged. Adding `types:` to your templates and dropping the flag
is what turns a per-doctype run into one run over the whole tree — see
[ADR 01004](adrs/01004-route-templates-by-the-type-frontmatter-key.md) and
[ADR 01005](adrs/01005-ship-tgdp-structure-templates-without-demoting-user-templates.md).

## Development

```bash
npm install
npm test
npm run typecheck
npm run smoke            # build, then exercise the real dist/cli.js
npm run check:tgdp-pin   # has upstream moved past the built-ins' pin?
```

`npm run smoke` exists because the suite runs against `src/`, where the built-in
templates sit one directory deeper than they do in the bundled `dist/`. A path
that is right in the repo and wrong in the package passes every test — which is
how it happened once.

Decisions are recorded in [`adrs/`](adrs/), and the conventions this rewrite
settled on are in [`CLAUDE.md`](CLAUDE.md).

## License

MIT — see [LICENSE](LICENSE).
