/**
 * AsciiDoc parser.
 *
 * Asciidoctor already hands back a nested block tree, so the work here is the
 * same as `mdast.ts`'s: flatten it into ordered `Block`s and let `sectionize`
 * rebuild the nesting. Contexts outside `section`/`paragraph`/`listing`/
 * `literal`/`ulist`/`olist` are skipped rather than mapped to a nearest
 * neighbour, for the reason the Markdown parser skips blockquotes and tables -
 * an admonition is not a paragraph, and counting one as such would make
 * `paragraphs: {max: 3}` fail a document a reader would say satisfies it.
 *
 * Two things about Asciidoctor shape this file:
 *
 *  - **Positions come from line numbers, and only line numbers.** `load()` is
 *    given `sourcemap: true` so every block carries `getLineNumber()`; nothing
 *    reports where a block *ends*, and there are no columns or offsets at all.
 *    Those are derived from a line-start index built once over the content.
 *    The pre-rewrite `parsers/asciidoc.js` instead reconstructed a `=== Title`
 *    marker and ran `content.indexOf()` on it, which mismatches on attribute
 *    lines, duplicate titles, and any non-canonical heading syntax.
 *  - **Metadata arrives two ways.** AsciiDoc's own is the document header -
 *    `= Title` plus `:key: value` entries - and that is how a real page says
 *    `:type: how-to`. Some toolchains prepend a Markdown-style `---` fence
 *    instead, which is a thematic break to Asciidoctor, so `skip-front-matter`
 *    consumes it rather than letting it parse as body content; line numbering
 *    is unaffected, so the body still indexes the original file. Both readings
 *    run, and the results merge.
 */
import asciidoctorModule from "asciidoctor";
import { extractFrontmatter, extractorForExtension } from "docmeta";
import type {
  ContentNode,
  DocumentParser,
  DocumentTree,
  ListItemNode,
  Point,
  Position,
} from "../types.js";
import { MooseLintError } from "../types.js";
import type { Block } from "./sectionize.js";
import { sectionize } from "./sectionize.js";
import { fencedPosition, withMetadataTitle as withFrontmatterTitle } from "./metadata.js";

/**
 * `asciidoctor` is CommonJS whose `module.exports` *is* the factory function,
 * while its type definitions describe that function as a default export. Under
 * NodeNext a default import from CJS is `module.exports`, so the imported value
 * is already the factory and only its type is wrong - there is no `.default` on
 * it at runtime to reach for instead.
 */
const asciidoctor = asciidoctorModule as unknown as typeof asciidoctorModule.default;

const processor = asciidoctor();

/**
 * Minimal structural view of an Asciidoctor node.
 *
 * `getBlocks()` is typed `any[]` upstream and is not even homogeneous - a
 * description list returns `[[terms], description]` tuples rather than nodes -
 * so everything is read back through `asNode`, which checks for the one method
 * every real block has.
 */
interface AdocNode {
  getContext(): string;
  getLineNumber?(): number | undefined;
  getBlocks?(): unknown[];
  getLevel?(): number;
  getTitle?(): string | undefined;
  getSource?(): string;
  getContent?(): string;
  getAttribute?(name: string): unknown;
  getItems?(): unknown[];
}

/** A list item. Its principal text is not among its blocks. */
interface AdocItem {
  getLineNumber?(): number | undefined;
  getText(): string;
  getBlocks(): unknown[];
}

interface AdocDocument extends AdocNode {
  hasHeader(): boolean;
  getHeader(): unknown;
}

function asNode(value: unknown): AdocNode | null {
  const node = value as AdocNode | null;
  return node && typeof node.getContext === "function" ? node : null;
}

function asItem(value: unknown): AdocItem | null {
  const item = value as AdocItem | null;
  return item && typeof item.getText === "function" ? item : null;
}

/** Blocks of a container, filtered down to the ones that really are nodes. */
function childrenOf(node: AdocNode): AdocNode[] {
  const blocks = node.getBlocks?.() ?? [];
  return blocks.map(asNode).filter((n): n is AdocNode => n !== null);
}

function lineOf(node: { getLineNumber?(): number | undefined }): number {
  return node.getLineNumber?.() ?? 1;
}

// ---------------------------------------------------------------------------
// Positions
// ---------------------------------------------------------------------------

/**
 * Line numbers to `Point`s.
 *
 * The offsets a reporter prints, and the offsets `validateDocument` sorts
 * findings by, do not exist anywhere in Asciidoctor's output. They are all
 * recovered from one pass over the content that records where each line
 * starts, so a lookup is an array index rather than a search through the text.
 */
interface LineIndex {
  /** Column 1 of `line`. */
  start(line: number): Point;
  /** Just past the last character of `line`, before its line break. */
  endOfLine(line: number): Point;
  /** End of the document, for closing the final sections. */
  documentEnd(): Point;
}

function lineIndex(content: string): LineIndex {
  const starts: number[] = [0];
  for (let i = 0; i < content.length; i++) {
    if (content[i] === "\n") starts.push(i + 1);
  }

  /** Line numbers come from a third-party tree; keep them inside the file. */
  const clamp = (line: number): number =>
    Math.min(Math.max(Math.trunc(line) || 1, 1), starts.length);

  return {
    start(line) {
      const n = clamp(line);
      return { line: n, column: 1, offset: starts[n - 1]! };
    },
    endOfLine(line) {
      const n = clamp(line);
      const from = starts[n - 1]!;
      const next = starts[n];
      let stop = next === undefined ? content.length : next - 1;
      if (stop > from && content[stop - 1] === "\r") stop -= 1;
      return { line: n, column: stop - from + 1, offset: stop };
    },
    documentEnd() {
      return {
        line: starts.length,
        column: content.length - starts[starts.length - 1]! + 1,
        offset: content.length,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Inline text
// ---------------------------------------------------------------------------

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/**
 * Asciidoctor's plain-text rendering, flattened.
 *
 * `getTitle()`, `getContent()`, and `ListItem#getText()` all return inline
 * *HTML*: a heading written with backtick-quoted `lint` comes back as
 * `Use the <code>lint</code> command`. Stripping the tags and decoding the
 * entities is this format's equivalent of `mdast-util-to-string`, and it is
 * what makes `heading: {const: "Overview"}` mean the same thing here as it does
 * in Markdown.
 *
 * The one place it is lossy is Asciidoctor's `replacements` substitution, which
 * fires before we ever see the string: a straight apostrophe arrives as
 * `&#8217;` and flattens to a curly one, where Markdown would leave it alone.
 * That is Asciidoctor's conversion, not ours, and it exposes no way to ask for
 * a title with quotes substituted but replacements skipped.
 */
function flattenInline(html: string | undefined): string {
  if (!html) return "";
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(
      /&([a-z]+);/gi,
      (whole: string, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? whole,
    );
}

// ---------------------------------------------------------------------------
// Asciidoctor's tree -> drafts
// ---------------------------------------------------------------------------

/**
 * A block with a start line but no span yet.
 *
 * The walk cannot assign spans as it goes, because a block's end is the start
 * of whatever comes after it - which is only known once the whole document is
 * flat. So the walk emits drafts and `place` closes them.
 */
type Draft =
  | { kind: "heading"; line: number; level: number; title: string }
  | { kind: "paragraph"; line: number; text: string }
  | { kind: "code"; line: number; text: string; lang?: string }
  | { kind: "list"; line: number; ordered: boolean; items: DraftItem[] };

/** Every draft but a heading, which is the only kind that is not content. */
type ContentDraft = Exclude<Draft, { kind: "heading" }>;

interface DraftItem {
  line: number;
  text: string;
  children: Draft[];
}

function stringAttribute(node: AdocNode, name: string): string | undefined {
  const value = node.getAttribute?.(name);
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function draftList(node: AdocNode, ordered: boolean): Draft {
  const items: DraftItem[] = [];

  for (const raw of node.getItems?.() ?? []) {
    const item = asItem(raw);
    if (!item) continue;

    const line = lineOf(item);
    const text = flattenInline(item.getText());
    const children: Draft[] = [];

    // An item's principal text is not one of its blocks, but mdast puts it in
    // a paragraph child - so `lists: {items: {paragraphs: {min: 1}}}` counts
    // the same thing in both formats only if we put it there too.
    if (text.length > 0) children.push({ kind: "paragraph", line, text });
    collect(
      item.getBlocks().map(asNode).filter((n): n is AdocNode => n !== null),
      children,
    );

    items.push({ line, text, children });
  }

  return { kind: "list", line: lineOf(node), ordered, items };
}

/** One block, or null when the content model has no kind for it. */
function draftOf(node: AdocNode): Draft | null {
  switch (node.getContext()) {
    case "paragraph":
      return {
        kind: "paragraph",
        line: lineOf(node),
        text: flattenInline(node.getContent?.()),
      };
    case "listing":
    case "literal": {
      const lang = stringAttribute(node, "language");
      return {
        kind: "code",
        line: lineOf(node),
        // Raw, not converted: a code block's text is its source, and
        // `getContent()` would escape every `<` in it.
        text: node.getSource?.() ?? "",
        ...(lang ? { lang } : {}),
      };
    }
    case "ulist":
      return draftList(node, false);
    case "olist":
      return draftList(node, true);
    default:
      // Admonitions, tables, sidebars, images, description lists, quotes.
      // Skipped whole: their children are not the section's content either.
      return null;
  }
}

/**
 * Flatten a container's children into drafts, in document order.
 *
 * `section` contributes a heading and then its own children as siblings, which
 * is what turns Asciidoctor's nesting back into the flat stream `sectionize`
 * folds.
 *
 * Two containers are transparent - recursed through, contributing nothing of
 * their own - because neither is a construct the author meant as content:
 *
 *  - `preamble`, a wrapper Asciidoctor inserts between a document title and the
 *    first section. Skipping it would swallow the lead prose.
 *  - `open` (`--`). That is how an author attaches several blocks to one list
 *    item, so skipping it would make a numbered step's whole body invisible to
 *    a template. The constructs a `--` block can be *turned into* do not arrive
 *    here at all: `[NOTE]` becomes an `admonition`, `[quote]` a `quote`,
 *    `[sidebar]` a `sidebar`, each with its own context and each skipped by the
 *    default branch, which is the line mdast draws around a blockquote. So a
 *    node still reporting `open` is the bare attach-blocks form by elimination.
 */
function collect(nodes: AdocNode[], out: Draft[]): void {
  for (const node of nodes) {
    const context = node.getContext();

    if (context === "section") {
      out.push({
        kind: "heading",
        line: lineOf(node),
        // Asciidoctor's `=` title is level 0, so every level is one shallower
        // than the heading level the rest of the tool speaks in.
        level: (node.getLevel?.() ?? 0) + 1,
        title: flattenInline(node.getTitle?.()),
      });
      collect(childrenOf(node), out);
      continue;
    }

    if (context === "preamble" || context === "open") {
      collect(childrenOf(node), out);
      continue;
    }

    const draft = draftOf(node);
    if (draft) out.push(draft);
  }
}

// ---------------------------------------------------------------------------
// Drafts -> blocks
// ---------------------------------------------------------------------------

/**
 * Give every draft a span.
 *
 * A heading spans its own title line, the way an mdast heading spans its `#`
 * line. Everything else ends where the next block begins, and the last block at
 * `end` - the convention `sectionize` already uses for sections, applied one
 * level down because Asciidoctor reports where a block starts and nothing at
 * all about where it stops.
 */
function place(drafts: Draft[], end: Point, index: LineIndex): Block[] {
  return drafts.map((draft, i): Block => {
    const next = drafts[i + 1];
    const boundary = next ? index.start(next.line) : end;

    if (draft.kind === "heading") {
      return {
        type: "heading",
        level: draft.level,
        title: draft.title,
        position: {
          start: index.start(draft.line),
          end: index.endOfLine(draft.line),
        },
      };
    }

    return {
      type: "content",
      node: contentNode(
        draft,
        { start: index.start(draft.line), end: boundary },
        index,
      ),
    };
  });
}

/** `place`, for content that cannot contain a heading. */
function placeContent(drafts: Draft[], end: Point, index: LineIndex): ContentNode[] {
  return place(drafts, end, index).flatMap((block) =>
    block.type === "content" ? [block.node] : [],
  );
}

function placeItems(items: DraftItem[], end: Point, index: LineIndex): ListItemNode[] {
  return items.map((item, i) => {
    const next = items[i + 1];
    const boundary = next ? index.start(next.line) : end;
    return {
      position: { start: index.start(item.line), end: boundary },
      text: item.text,
      children: placeContent(item.children, boundary, index),
    };
  });
}

function contentNode(
  draft: ContentDraft,
  position: Position,
  index: LineIndex,
): ContentNode {
  switch (draft.kind) {
    case "paragraph":
      return { kind: "paragraph", position, text: draft.text };
    case "code":
      return {
        kind: "code",
        position,
        text: draft.text,
        ...(draft.lang ? { lang: draft.lang } : {}),
      };
    case "list":
      return {
        kind: "list",
        position,
        // Informational only - no rule reads a list's own text - so the items
        // are joined one per line rather than run together the way
        // `mdast-util-to-string` concatenates them.
        text: draft.items.map((item) => item.text).join("\n"),
        ordered: draft.ordered,
        items: placeItems(draft.items, position.end, index),
      };
  }
}

// ---------------------------------------------------------------------------
// Document metadata
// ---------------------------------------------------------------------------

/**
 * The AsciiDoc-aware reader, which the plain `extractFrontmatter` is not.
 *
 * `extractFrontmatter(content, "asciidoc")` reads only the fenced `--- ... ---`
 * block some toolchains prepend - its format argument is a label copied onto
 * the result, not a parser selector. AsciiDoc's own metadata is the document
 * header: the `= Title` line plus `:key: value` attribute entries, up to the
 * first blank line. That is how a real page declares `:type: how-to`, and
 * reading it is what makes type routing work for `.adoc` at all.
 */
const nativeExtractor = extractorForExtension(".adoc");

interface Metadata {
  data: Record<string, unknown> | null;
  position: Position | null;
}

/**
 * Span of the native header: the run of lines before the first blank one,
 * which is exactly the range docmeta's extractor reads attributes from.
 */
function headerPosition(content: string, index: LineIndex): Position | null {
  let last = 0;
  for (const [i, line] of content.split(/\r?\n/).entries()) {
    if (line.trim() === "") break;
    last = i + 1;
  }
  if (last === 0) return null;
  return { start: index.start(1), end: index.endOfLine(last) };
}

/**
 * Both metadata styles, merged, with the fenced block winning a key collision:
 * a file carrying a fence has chosen it as its metadata of record. `present` is
 * the OR of the two, so a page with only `:type: how-to` still reports
 * frontmatter and still routes.
 */
function metadata(content: string, filePath: string, index: LineIndex): Metadata {
  const fenced = extractFrontmatter(content, "asciidoc");
  const native = nativeExtractor?.extract(content, filePath);

  if (!fenced.present && !native?.present) return { data: null, position: null };

  return {
    data: { ...(native?.data ?? {}), ...(fenced.present ? fenced.data : {}) },
    position:
      (fenced.present ? fencedPosition(content) : null) ??
      headerPosition(content, index),
  };
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

function load(content: string, filePath: string): AdocDocument {
  try {
    return processor.load(content, {
      // Without this every block's `getLineNumber()` is undefined and there are
      // no positions to derive at all.
      sourcemap: true,
      // A leading `---` fence is a thematic break in AsciiDoc; this consumes it
      // as metadata instead, without disturbing line numbering.
      attributes: { "skip-front-matter": true },
    }) as unknown as AdocDocument;
  } catch (err) {
    // Asciidoctor recovers from malformed *documents* - it warns about an
    // unterminated block and carries on - so this fires when the loader itself
    // refuses the input. Either way it is the file's problem, not a crash.
    throw new MooseLintError(
      `${filePath}: could not parse as asciidoc: ${(err as Error).message}`,
    );
  }
}

/**
 * The document title, as a heading block.
 *
 * `= Title` is not a block: Asciidoctor keeps it as the document header, and
 * `getDocumentTitle()` lies about it - with no header at all it falls back to
 * the first section's title - so this goes through `hasHeader()`. A header made
 * only of attribute entries has no title to contribute, and emitting an empty
 * heading for it would both invent a section and block the frontmatter title
 * those attributes may be carrying.
 */
function headerDraft(doc: AdocDocument): Draft | null {
  if (!doc.hasHeader()) return null;
  const header = asNode(doc.getHeader());
  if (!header) return null;
  const title = flattenInline(header.getTitle?.());
  if (title.length === 0) return null;
  return {
    kind: "heading",
    line: lineOf(header),
    level: (header.getLevel?.() ?? 0) + 1,
    title,
  };
}

function parse(content: string, filePath: string): DocumentTree {
  const doc = load(content, filePath);
  const index = lineIndex(content);

  const drafts: Draft[] = [];
  const header = headerDraft(doc);
  if (header) drafts.push(header);
  collect(childrenOf(doc), drafts);

  const meta = metadata(content, filePath, index);
  const end = index.documentEnd();

  return {
    format: "asciidoc",
    filePath,
    frontmatter: meta.data,
    frontmatterPosition: meta.position,
    sections: sectionize(
      withFrontmatterTitle(place(drafts, end, index), meta.data, meta.position),
      end,
    ),
  };
}

export const asciidocParser: DocumentParser = {
  name: "asciidoc",
  label: "AsciiDoc",
  extensions: [".adoc", ".asciidoc"],
  implemented: true,
  parse,
};
