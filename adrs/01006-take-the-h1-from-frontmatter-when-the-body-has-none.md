---
status: "accepted"
date: 2026-08-29
decision-makers: [hawkeyexl]
---

# Take the H1 from frontmatter when the body has none

## Context and Problem Statement

Every built-in doctype template models the page title as its outermost rule,
because that is how the published templates are written. TGDP's how-to opens
`# Title`, with its sections hanging beneath.

Docusaurus, Hugo, and Starlight all render the page title from frontmatter. On
those sites a page carries `title:` in its front matter and its body starts at
`##`. Read literally, such a page has **no top-level section at all**. The `##`
headings become roots and the template's outermost rule matches the first of
them. Every rule beneath it then looks for sections that are actually its
siblings. One page produced five findings, none of which named a real problem:

```text
✗ headless.md
    6:1  missing_section     Overview: Missing section "Overview"
    6:1  missing_section     Overview: Missing section "task"
    6:1  missing_section     Overview: Missing section "See also"
   10:1  unexpected_section  Install it: Unexpected section "Install it". …
   14:1  unexpected_section  See also: Unexpected section "See also". …
```

This is not a rare shape. It is the default for three of the most widely used
documentation site generators. The README's first draft had to tell those users
the built-in templates "are not for you as shipped". That would have made the
tool's headline feature inapplicable to a large fraction of the docsets it is
meant to check.

The page is not malformed. Its title is simply not written where a naive reading
looks for it.

## Decision Drivers

- The built-in templates are the point of routing by `type`; they have to work
  on the docsets people actually have.
- The tool should read a document the way its readers see it rendered, not the
  way its raw source happens to be arranged.
- A misalignment cascade is the worst possible output: many findings, none true,
  and the real defects buried among them.
- Whatever is done must not alter documents that *do* have an H1.

## Considered Options

- **Synthesize an H1 from frontmatter `title` when the body has none**
- Tell users to write their own templates, or `extends` and replace the top rule
- Make the built-ins' top-level rule optional
- Match a template's top-level rule against the document root rather than a section

## Decision Outcome

The chosen option is to **synthesize an H1 from the frontmatter `title`.**

The parser prepends a synthetic heading block before sectionizing when two
things hold:

- The page carries a non-empty string `title` in its front matter.
- Its body contains no level-1 heading. Everything downstream, including matching, rules, and
reporting, sees the document the way a reader sees it rendered. None of it needs
any knowledge of this.

The synthetic heading is **positioned on the front matter block**. A finding
about the title points at the lines that carry it. It does not point at an
invented location, or at line 1 by default.

Three conditions are all required, and each excludes a case where synthesizing
would be wrong:

- **A string `title`, non-empty.** A list or a number is not a title.
- **No level-1 heading in the body.** Prepending one where a real H1 exists would
  nest the real title inside a synthetic parent, which is a different document.
- **Front matter actually present**, so there is a position to anchor on.

A page with neither an H1 nor a frontmatter `title` keeps the existing behavior.
Its content before the first heading becomes the implicit lead section at level
0. That page has no top-level section for a doctype template to match, and will
report as much. That is correct, because a reader would also struggle to name
such a page.

### Consequences

- Good, because the built-in templates work unchanged on Docusaurus, Hugo, and
  Starlight docsets. The five-finding cascade above becomes a clean pass.
- Good, because it is contained: one function in the Markdown parser, and the
  rest of the tool is unaware. It applies to MDX for free, since both formats
  share the same parse path.
- Good, because findings about the title land on the front matter, which is
  where the author would go to fix them.
- Bad, because the section tree no longer corresponds one-to-one with headings
  in the source. A `SectionNode` may exist that nothing in the body wrote, and
  anyone reading the tree, such as a future `moose-kg` integration, has to know
  that. `headingPosition` pointing into the front matter is the signal.
- Bad, because `title` is now load-bearing in a tool that otherwise only reads
  `type` and `$template`. It is a de facto standard rather than one the family's
  schemas mandate; a site using a different key gets no synthesis.
- Neutral, because nothing changes for documents with an H1, which is every
  document the test suite had before this.

### Confirmation

`test/unit/parsers.test.ts` pins all five branches. The title becomes the
top-level section, anchored at line 1, offset 0 (the front matter). A real H1 is
not displaced. Nothing is synthesized without a title, and a non-string or empty
title is ignored. Content before the first heading is carried into the
synthesized section rather than stranded.

`test/integration/repo-templates.test.ts` runs it against
`artifacts/sample_markdown_headless.md`, which is exactly this shape, and
separately pins that a document with no title anywhere still uses the level-0
lead section.

## Pros and Cons of the Options

### Synthesize an H1 from frontmatter `title`

- Good, because it fixes the whole class at the source, once.
- Good, because it needs no change to any template, built-in or user-written.
- Bad, because it introduces a node with no corresponding source text.

### Tell users to write their own templates, or `extends` and replace the top rule

- Good, because it costs no code and the escape hatch genuinely exists.
- Bad, because it asks every user of three popular generators to rewrite the
  templates whose value proposition is that they are published and vetted.

### Make the built-ins' top-level rule optional

- Good, because it is a one-word change in seven files.
- Bad, because it does not work. An optional rule that does not match is
  skipped, so the `##` sections are then matched against the *title rule's
  siblings*. That is a different misalignment rather than none.
- Bad, because it weakens the templates for every document that does have an H1.

### Match a template's top-level rule against the document root

- Good, because it removes the special case entirely. The outermost rule would
  describe "the document" rather than "the H1 section".
- Bad, because it makes the template DSL mean something different at the top
  level than at every level below it. That is exactly the kind of positional
  special-casing [ADR 01002](01002-match-sections-in-order-not-by-index.md)
  removed from the matcher.
- Bad, because it breaks templates that legitimately describe several top-level
  sections, which `templates.yaml`'s own `api-operation` does.
