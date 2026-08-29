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

Point it at files, directories (walked recursively), or globs.

```bash
moose-lint docs/ --template ./templates.yaml#how-to
```

```text
✓ docs/install.md
✗ docs/configure.md
    12:1  heading_const_error   Prerequisites: Expected title "Overview", but found "Prerequisites"
    41:1  missing_section       Configure: Missing section "See also"

2 files checked, 1 passed, 1 failed, 0 skipped
```

A clean run exits `0`, findings exit `1`, and an operational error — no inputs, an
unreadable template, an invalid template — exits `2`.

### Commands

```
moose-lint [paths...]   Lint. -t/--template <ref>, --templates <path>, --as <format>,
                        --exclude <glob...>, -f/--format <pretty|json|github>, --no-color
moose-lint templates    List resolvable templates and the doctypes they serve
moose-lint formats      List input formats, implemented and planned
```

`-` as a path reads the document from stdin, and needs `--as` to pick a parser.

## Input formats

Structure comes from a real parse, behind a per-format registry: adding a format
does not touch matching, rules, or reporting. A format that is registered but not
yet implemented says so rather than being quietly parsed as Markdown.

```bash
moose-lint formats
```

| format | extensions | status |
| --- | --- | --- |
| Markdown | `.md`, `.markdown` | implemented |
| MDX | `.mdx` | implemented |
| AsciiDoc | `.adoc`, `.asciidoc` | planned |
| reStructuredText | `.rst` | planned |
| HTML | `.html`, `.htm` | planned |
| XML | `.xml` | planned |

Directory walks pick up implemented formats only. Naming an unimplemented file
explicitly reports it as skipped, with the format named.

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
            repeat: true # one or more sections, headings unconstrained
            additionalSections: true
          see also:
            heading:
              const: See also
```

### Section rules

```yaml
description: What this section is for. Not validated against.
heading:
  const: Exact heading text # or:
  pattern: ^Regex against the heading$
required: true # default true
repeat: false # a heading-less section may claim more than one section
additionalSections: false # allow subsections this template does not describe
sections: {} # nested section rules, in document order
```

A section rule that constrains no heading text is a **slot**: it matches whatever
heading is in that position. That is how you describe a section whose title varies
by page. A slot claims exactly one section unless it sets `repeat: true`.

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

`$ref` shares a definition within a file, and `extends` inherits another template
wholesale:

```yaml
templates:
  api-operation:
    sections:
      request-parameters:
        $ref: "#/components/parameters"
  strict-how-to:
    extends: ./templates.yaml#how-to
    sections:
      see also:
        required: true
```

## Using it as a library

```javascript
import { runLint } from "moose-lint";

const run = await runLint({
  inputs: ["docs/"],
  template: "./templates.yaml#how-to",
});
```

`-f json` emits `[{ file, success, errors: [{ type, heading, message, position }] }]`,
which is what tool adapters parse.

## Migrating from `doc-structure-lint`

| before | now |
| --- | --- |
| `--file-path docs/` | positional: `moose-lint docs/` |
| `--template-path t.yaml --template how-to` | `--template t.yaml#how-to` |
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
worked before still work; templates with optional sections now work *correctly*.

## Development

```bash
npm install
npm test
npm run typecheck
```

Decisions are recorded in [`adrs/`](adrs/).

## License

MIT — see [LICENSE](LICENSE).
