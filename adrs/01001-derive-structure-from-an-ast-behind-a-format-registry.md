---
status: "accepted"
date: 2026-08-29
decision-makers: [hawkeyexl]
---

# Derive document structure from an AST, behind a per-format parser registry

## Context and Problem Statement

`doc-structure-lint` called remark and then discarded the tree. `parseMarkdown`
walked the mdast with a mutable `currentSection` cursor, and from there:

- It re-derived parentage by linear `findParent` scans over the whole result, on
  every node.
- It re-serialized nodes back into strings with `getNodeRawContent`.
- It maintained section end offsets by hand through `updateParentPositions`.
- It recorded every piece of content **twice**, once into
  `paragraphs`/`codeBlocks`/`lists` buckets and again into a parallel `content`
  array of run-grouped objects for the `sequence` rule.

Two costs followed. The first was fidelity. Heading titles were built with
`children.map(c => c.value).join("")`, and `value` is undefined on anything but
a text node. So `# Use the \`lint\` command` yielded `Use the  command`.
Frontmatter was parsed by splitting lines on `:`, so a list or a nested mapping
became a string. Section spans ended at their own last child rather than where
the next section begins.

The larger cost was structural. A second format had been attempted, and
`parsers/asciidoc.js` existed. But it emitted a completely different shape
(`startIndex`/`endIndex`/`subsections`, with paragraphs and code blocks as
integer *counts*) than the Markdown parser's (`position`/arrays/`sections`).
Nothing downstream could consume both, so the AsciiDoc path was never wired in.
`inferFileType` had its AsciiDoc branch commented out, and defaulted every
unrecognized extension to Markdown, `.rst` and `.html` and `.adoc` alike, and
`getSupportedFiles` hardcoded `[".md", ".markdown"]`.

The tool needs to reach the formats `docmeta` already extracts metadata from
(Markdown, MDX, AsciiDoc, reStructuredText, HTML, XML). It cannot get there by
adding parsers that each invent their own output shape.

## Decision Drivers

- Structure derivation should be a transform over a parsed tree, not a
  hand-maintained walk, so positions and parentage come from the parser.
- A new input format must not require touching matching, rules, or reporting.
- Rules must not be able to reach for format-specific node types, or the
  registry is a fiction and every rule silently becomes Markdown-only.
- The family already solves this problem in `docmeta`; a second solution in a
  sibling repository is a cost with no return.
- Formats we cannot parse yet should be visible, not silently mis-parsed.

## Considered Options

- **A `DocumentParser` registry producing one generic `DocumentTree`**
- Keep per-format output shapes and adapt them at each call site
- Normalize every format to mdast and keep rules mdast-aware
- Stay Markdown-only

## Decision Outcome

The chosen option is **a `DocumentParser` registry producing one generic
`DocumentTree`**. It mirrors `docmeta`'s extractor registry file for file
(`parserForExtension`, `parserByName` for `--as`, `supportedExtensions()` for
directory walks, `listFormats()`). That was chosen over an interface shaped like
its `MetadataExtractor`.

The pipeline runs a format-specific parse, then a format-specific flattening
into ordered `Block`s, then **one shared `sectionize` fold**, and out comes a
`SectionNode` tree. Only the first two steps are per-format. Nesting, slugging,
ordering, and span computation are written once. For Markdown and MDX the
flattening is a walk over mdast. A future AsciiDoc parser walks Asciidoctor's
block tree and an HTML parser walks parse5's DOM, and neither touches the fold.

**The content model is deliberately format-neutral.** A `SectionNode` exposes its
content as ordered nodes of kind `paragraph`, `code`, or `list`, rather than as
mdast node types. Each parser maps its own vocabulary on (mdast
`paragraph`/`code`/`list`, Asciidoctor `paragraph`/`listing`/`ulist`, HTML
`<p>`/`<pre>`/`<ul>`). This is what lets one `tgdp:how-to` template check a
Markdown page and an AsciiDoc page and produce the same findings. Block types
the DSL does not describe, such as blockquotes, tables, and thematic breaks, are
skipped rather than mapped to a nearest neighbour. Counting a table as a list
would make `lists: {max: 1}` fail documents that satisfy it.

**Unimplemented formats are registered as stubs**, again following `docmeta`.
A stub carries `implemented: false` and throws a named error. That is what turns
`.rst` from a file quietly parsed as Markdown into a reported gap. It also lets
`moose-lint formats` state the roadmap rather than leaving users to discover it.

MDX gets its own registered parser rather than a flag on the Markdown one.
`remark-mdx` reads `{` as an expression delimiter, so ordinary Markdown prose
containing a brace is a syntax error under it. One processor for both formats
breaks either MDX or Markdown, and `moose-kg` reached the same conclusion.

### Consequences

- Good, because roughly the whole middle of the old parser is deleted:
  `getNodeRawContent`, `addToSequence`, `findParent`, `updateParentPositions`,
  `createDefaultSection`, and the generated `uuid` identities. On a tree those
  are queries, not state.
- Good, because the fidelity bugs go away as a side effect rather than as fixes.
  Titles come from `mdast-util-to-string`, slugs from `github-slugger`,
  frontmatter from `docmeta`'s extractor (nested mappings and lists included),
  and positions from unist.
- Good, because a section now ends where the next section at its level begins.
  Findings span what a reader would call the section, and adjacent sections tile
  the document with no gaps.
- Good, because `inferFileType` and the hardcoded extension list are gone;
  file walking asks the registry.
- Bad, because there are two hops from source to rules (parse, then flatten)
  rather than one. Take a format whose native tree is far from
  heading-plus-content, such as an XML vocabulary like DITA. It will need a
  mapping the interface does not describe for it.
- Bad, because the generic content model cannot express anything the three kinds
  do not cover. Admonitions, tables, and includes are invisible to templates
  until the model grows a kind, and growing it touches every parser.
- Neutral, because `docmeta` is now a runtime dependency for frontmatter.
  `moose-kg` already depends on it for the same reason, and calls it the single
  source of truth with `dockg validate`. A second frontmatter parser in the
  family would be the worse outcome.

### Confirmation

`test/unit/parsers.test.ts` pins:

- The tree (nesting, `order`, `parentSlug`, slug disambiguation).
- The fidelity cases the old parser failed (inline markup in a heading, nested
  frontmatter, list-item children).
- The span rule (a section ends at the next sibling heading, the last section
  ends at EOF).
- The implicit lead section for headless documents.
- The skipping of undescribed block types, and the MDX/Markdown brace split.
- The registry, including that `.rst` reports as not implemented and that
  `supportedExtensions()` excludes it.

`test/integration/repo-templates.test.ts` parses this repository's own sample
documents, so the fold is exercised against real prose rather than fixtures
written to suit it.
