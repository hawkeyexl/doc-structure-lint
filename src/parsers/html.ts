/**
 * HTML parser: parse5's DOM -> generic blocks -> the shared `sectionize` fold.
 *
 * The job is the same one `mdast.ts` does for Markdown - flatten a format's own
 * tree into ordered `Block`s - and the same skipping discipline applies. A
 * `<blockquote>` is not a paragraph and a `<table>` is not a list; counting
 * either as one would make `paragraphs: {max: 3}` fail pages a reader would say
 * satisfy it.
 *
 * `parse` rather than `parseFragment`. Real documentation HTML is a document:
 * `<!DOCTYPE html><html><head>…</head><body>…`, and an HTML page's metadata
 * lives in `<head>`, which `parseFragment` (which parses in a `<body>` context)
 * drops on the floor - `<head>` is an ignored start tag in the "in body"
 * insertion mode. `parse` also handles a bare fragment, because HTML5 tree
 * construction synthesizes the missing `<html>`/`<head>`/`<body>` around it; the
 * only cost is that those synthesized elements carry no `sourceCodeLocation`,
 * which `positionOf` already has to tolerate.
 *
 * parse5 never throws on malformed input - HTML5 defines recovery for every
 * error - so unlike the MDX path there is no parse-failure branch here. A
 * document with unclosed tags parses into whatever a browser would build from
 * it, and lints against that.
 */
import { defaultTreeAdapter, parse } from "parse5";
import type { DefaultTreeAdapterTypes } from "parse5";
import { extractFrontmatter, extractorForExtension } from "docmeta";
import type {
  CodeNode,
  ContentNode,
  DocumentParser,
  DocumentTree,
  ListItemNode,
  Position,
} from "../types.js";
import type { Block } from "./sectionize.js";
import { sectionize } from "./sectionize.js";
import { fencedPosition, withMetadataTitle } from "./metadata.js";

type Node = DefaultTreeAdapterTypes.Node;
type Element = DefaultTreeAdapterTypes.Element;
type ParentNode = DefaultTreeAdapterTypes.ParentNode;

/**
 * What a walk does when it meets an element.
 *
 *  - `heading`/`content`: the element *is* a block. It is emitted and never
 *    descended into, because its whole subtree has already been folded into the
 *    emitted node's text. Descending would emit the same prose twice.
 *  - `container`: the element is not content but its children may be. Descend
 *    without emitting. This is the case that matters: real HTML wraps
 *    everything in `<html><body><main><article><div>`, and a heading inside a
 *    `<div>` is still a heading.
 *  - `opaque`: neither content nor a container. Skip the subtree entirely.
 *
 * `container` is the default, so an unknown element - a web component, a
 * `<my-callout>` - still yields the headings and paragraphs inside it. `opaque`
 * is a short, explicit list, and every entry earns its place the same way: the
 * block content inside it belongs to *that construct*, not to the document.
 * This is exactly mdast's shape, where a blockquote's paragraph is a child of
 * the blockquote and so never reaches `toBlocks`; keeping the two aligned is
 * what lets one template produce the same findings on a page and its Markdown
 * twin.
 */
type Role = "heading" | "content" | "container" | "opaque";

const HEADING_LEVELS = new Map<string, number>([
  ["h1", 1],
  ["h2", 2],
  ["h3", 3],
  ["h4", 4],
  ["h5", 5],
  ["h6", 6],
]);

const CONTENT_TAGS = new Set(["p", "pre", "ul", "ol"]);

const OPAQUE_TAGS = new Set([
  // Metadata and machinery, not prose.
  "head",
  "script",
  "style",
  "template",
  "noscript",
  "svg",
  "math",
  // Constructs that own their block content. A `<blockquote><p>` is the
  // quotation's paragraph, a `<figcaption>` is the figure's caption, and a
  // `<dd>` is a description-list body - none of them are the document's own
  // paragraphs, and the generic content model has no kind for any of them.
  "blockquote",
  "table",
  "figure",
  "dl",
]);

/** Elements whose text is not document text, for the flattening helpers. */
const NON_TEXT_TAGS = new Set(["script", "style", "template"]);

const ZERO: Position = {
  start: { line: 1, column: 1, offset: 0 },
  end: { line: 1, column: 1, offset: 0 },
};

function tagOf(el: Element): string {
  return el.tagName.toLowerCase();
}

function roleOf(tag: string): Role {
  if (HEADING_LEVELS.has(tag)) return "heading";
  if (CONTENT_TAGS.has(tag)) return "content";
  if (OPAQUE_TAGS.has(tag)) return "opaque";
  return "container";
}

/**
 * parse5's `sourceCodeLocation` maps onto `Position` one field at a time: its
 * lines and columns are 1-based, its offsets 0-based, and its `end*` is one
 * past the last character - the same half-open span `Position` documents. A
 * `<p>foo</p>` starting at column 1 reports `endCol` 12 for an 11-character
 * element, and `endOffset - startOffset` is its length.
 *
 * A node can carry no location at all: parse5 synthesizes `<html>`, `<head>`,
 * and `<body>` around a fragment, and those have none. Nothing synthesized is
 * ever emitted as a block, but the fallback keeps a missing location from
 * becoming `NaN` in a reporter.
 */
interface Located {
  sourceCodeLocation?: {
    startLine: number;
    startCol: number;
    startOffset: number;
    endLine: number;
    endCol: number;
    endOffset: number;
  } | null;
}

function positionOf(node: Located): Position {
  const loc = node.sourceCodeLocation;
  if (!loc) return { start: { ...ZERO.start }, end: { ...ZERO.end } };
  return {
    start: { line: loc.startLine, column: loc.startCol, offset: loc.startOffset },
    end: { line: loc.endLine, column: loc.endCol, offset: loc.endOffset },
  };
}

/** Concatenated text of a subtree, markup and all, verbatim. */
function rawText(node: Node): string {
  if (defaultTreeAdapter.isTextNode(node)) return node.value;
  if (!defaultTreeAdapter.isElementNode(node)) return "";
  if (NON_TEXT_TAGS.has(tagOf(node))) return "";
  let out = "";
  for (const child of node.childNodes) out += rawText(child);
  return out;
}

/**
 * Text as a browser renders it: nested `<code>`, `<em>`, and `<a>` contribute
 * their text, and HTML's insignificant whitespace collapses, so a heading
 * written across three indented lines still equals `"Overview"` - which is what
 * a template's `heading: {const: Overview}` compares against.
 *
 * This is the HTML side of the bug the Markdown parser had before the rewrite,
 * where a title was built from `children.map(c => c.value)` and every inline
 * element vanished.
 */
function flatText(node: Node): string {
  return rawText(node).replace(/\s+/g, " ").trim();
}

/** `language-x` from a `class`, per the HTML5 convention for code blocks. */
function langOf(el: Element): string | undefined {
  const className = el.attrs.find((a) => a.name === "class")?.value;
  if (!className) return undefined;
  for (const token of className.split(/\s+/)) {
    if (token.startsWith("language-") && token.length > "language-".length) {
      return token.slice("language-".length);
    }
  }
  return undefined;
}

function firstElementChild(el: Element, tag: string): Element | undefined {
  for (const child of el.childNodes) {
    if (defaultTreeAdapter.isElementNode(child) && tagOf(child) === tag) return child;
  }
  return undefined;
}

/**
 * `<pre>` (usually `<pre><code>`) as a code node.
 *
 * Whitespace is significant here, so this is the one place `rawText` is used
 * unnormalized. Two trims are deliberate: a newline directly after `<code>` is
 * an artifact of writing the block over several lines (the HTML parser already
 * drops one directly after `<pre>`, but not one after a nested `<code>`), and
 * dropping trailing whitespace matches mdast's `code.value`, which carries no
 * closing newline.
 */
function codeNode(pre: Element): CodeNode {
  const inner = firstElementChild(pre, "code");
  const lang = langOf(pre) ?? (inner ? langOf(inner) : undefined);
  const text = rawText(pre).replace(/^\r?\n/, "").replace(/\s+$/, "");
  return {
    kind: "code",
    position: positionOf(pre),
    text,
    ...(lang ? { lang } : {}),
  };
}

/**
 * `<li>` children of a list, with their own content mapped recursively.
 *
 * An item whose text is not wrapped in a block element gets a synthesized
 * paragraph, because mdast puts a list item's principal text in a paragraph
 * child and `lists: {items: {paragraphs: {min: 1}}}` has to count the same
 * thing in every format. Without it `<li>text</li>` had no children at all
 * while its Markdown, AsciiDoc, and reStructuredText twins had one - and
 * `<li><p>text</p></li>` in the same document had one too, so the rule did not
 * even mean one thing within HTML.
 */
function listItems(list: Element): ListItemNode[] {
  const items: ListItemNode[] = [];
  for (const child of list.childNodes) {
    if (!defaultTreeAdapter.isElementNode(child)) continue;
    if (tagOf(child) !== "li") continue;

    const text = flatText(child);
    const children = contentIn(child);
    if (children.length === 0 && text.length > 0) {
      children.push({ kind: "paragraph", position: positionOf(child), text });
    }
    items.push({ position: positionOf(child), text, children });
  }
  return items;
}

function toContentNode(el: Element, tag: string): ContentNode | null {
  switch (tag) {
    case "p":
      return { kind: "paragraph", position: positionOf(el), text: flatText(el) };
    case "pre":
      return codeNode(el);
    case "ul":
    case "ol":
      return {
        kind: "list",
        position: positionOf(el),
        text: flatText(el),
        ordered: tag === "ol",
        items: listItems(el),
      };
    default:
      return null;
  }
}

/**
 * Content nodes inside a container that is not itself a block - a list item,
 * or a wrapper within one. Same descend/skip rule as the document walk, minus
 * headings: a heading inside a list item does not open a section, and mdast
 * drops it the same way.
 */
function contentIn(parent: ParentNode): ContentNode[] {
  const out: ContentNode[] = [];
  for (const child of parent.childNodes) {
    if (!defaultTreeAdapter.isElementNode(child)) continue;
    const tag = tagOf(child);
    const role = roleOf(tag);
    if (role === "heading" || role === "opaque") continue;
    if (role === "content") {
      const node = toContentNode(child, tag);
      if (node) out.push(node);
      continue;
    }
    out.push(...contentIn(child));
  }
  return out;
}

/**
 * Walk the document into ordered blocks.
 *
 * Structure comes from heading *levels* only. Explicit `<section>` nesting is
 * deliberately ignored, and `<section>` is just another container:
 *
 *  - `sectionize` already derives nesting from heading level for every format.
 *    Honoring `<section>` would mean a second nesting mechanism living in this
 *    file, plus a rule for reconciling the two whenever a page's element
 *    nesting and its heading levels disagree - which they routinely do, because
 *    `<section>` is optional and is as often a layout wrapper
 *    (`<section class="hero">`) as a semantic one.
 *  - The cross-format promise is that one template produces the same findings
 *    on a page and its Markdown, AsciiDoc, or reST twin. Those formats have
 *    nothing but heading level, so deriving HTML's structure from anything else
 *    would let identical headings nest differently per format.
 *  - Where `<section>` nesting agrees with the headings - which is the whole
 *    point of writing it - honoring it changes nothing. It could only ever
 *    matter when it disagrees, and there the headings are what the reader sees.
 */
function walk(parent: ParentNode, out: Block[]): void {
  for (const child of parent.childNodes) {
    if (!defaultTreeAdapter.isElementNode(child)) continue;
    const tag = tagOf(child);
    const role = roleOf(tag);

    if (role === "heading") {
      out.push({
        type: "heading",
        level: HEADING_LEVELS.get(tag) ?? 1,
        title: flatText(child),
        position: positionOf(child),
      });
      continue;
    }

    if (role === "content") {
      const node = toContentNode(child, tag);
      if (node) out.push({ type: "content", node });
      continue;
    }

    if (role === "opaque") continue;

    walk(child, out);
  }
}

/** End of the document, for closing the final sections. */
function documentEnd(content: string): Position["end"] {
  const lines = content.split("\n");
  const last = lines[lines.length - 1] ?? "";
  return { line: lines.length, column: last.length + 1, offset: content.length };
}

/**
 * An HTML page's metadata, from both places it can be.
 *
 * `extractFrontmatter(content, "html")` - the call the Markdown parser makes -
 * turns out to read *only* a fenced `---`/`+++`/`;;;` block; the `format`
 * argument is a label on the result, not a dispatch key. On an ordinary HTML
 * page it returns `{present: false, data: {}}`, which would leave
 * `type: how-to` in a `<meta>` tag invisible and every `.html` file unrouted.
 *
 * The `<meta>` reading lives in docmeta's *extractor* registry instead, reached
 * by extension. So both are asked, and the results merged. That keeps docmeta
 * the single source of truth for metadata - including its `<title>` lift and
 * its YAML-scalar coercion of attribute values, so `content="[a, b]"` is a list
 * here exactly as it would be in frontmatter - rather than growing a second
 * `<meta>` convention in this repository.
 *
 * A fenced block wins on a key collision: it is authored at the top of the
 * source file, and it is what every sibling format reads. The two coexist
 * rarely enough that the tie-break is a formality.
 *
 * The cost is that docmeta parses the document a second time. Re-reading
 * `<meta>` off the tree already in hand would avoid it and duplicate the
 * convention; the ADR's "docmeta is the single source of truth for frontmatter"
 * is worth one extra parse of a file we are already reading from disk.
 */
function metadataOf(
  content: string,
  filePath: string,
  doc: DefaultTreeAdapterTypes.Document,
): { frontmatter: Record<string, unknown> | null; position: Position | null } {
  const fenced = extractFrontmatter(content, "html");
  const extractor = extractorForExtension(".html");
  const headMeta = extractor?.implemented
    ? extractor.extract(content, filePath)
    : { present: false, data: {} as Record<string, unknown> };

  if (!fenced.present && !headMeta.present) return { frontmatter: null, position: null };

  const frontmatter = { ...headMeta.data, ...fenced.data };

  // Anchor on whichever block the values actually came from. `<head>` is an
  // HTML document's frontmatter: it is where `<title>` and every `<meta>` sit,
  // and a finding about the page's metadata belongs there.
  if (fenced.present) return { frontmatter, position: fencedPosition(content) };

  // A `<head>` parse5 synthesized carries no source location. That happens
  // whenever anything precedes `<html>` - a BOM is the common case - and it
  // used to yield a null position, which silently switched off the synthetic
  // frontmatter title: `withMetadataTitle` bails when the position is null, so
  // the document lost its top-level section and every doctype template
  // misaligned against it. The metadata is real either way, so fall back to the
  // top of the file rather than disowning it.
  const head = findHead(doc);
  return {
    frontmatter,
    position: head?.sourceCodeLocation ? positionOf(head) : origin(),
  };
}

/** Zero-width span at the top of the file, for metadata with no located block. */
function origin(): Position {
  return {
    start: { line: 1, column: 1, offset: 0 },
    end: { line: 1, column: 1, offset: 0 },
  };
}

/** The document's `<head>`, when the source actually wrote one. */
function findHead(doc: DefaultTreeAdapterTypes.Document): Element | undefined {
  for (const child of doc.childNodes) {
    if (!defaultTreeAdapter.isElementNode(child)) continue;
    if (tagOf(child) === "html") return firstElementChild(child, "head");
  }
  return undefined;
}

function parseHtml(content: string, filePath: string): DocumentTree {
  const doc = parse(content, { sourceCodeLocationInfo: true });
  const blocks: Block[] = [];
  walk(doc, blocks);

  const { frontmatter, position } = metadataOf(content, filePath, doc);

  return {
    format: "html",
    filePath,
    frontmatter,
    frontmatterPosition: position,
    sections: sectionize(
      withMetadataTitle(blocks, frontmatter, position),
      documentEnd(content),
    ),
  };
}

export const htmlParser: DocumentParser = {
  name: "html",
  label: "HTML",
  extensions: [".html", ".htm"],
  implemented: true,
  parse: parseHtml,
};
