/**
 * The contract every other module is written against.
 *
 * Two shapes matter. `DocumentTree` is what a parser owes the rest of the tool:
 * a nested section tree with real source positions, in a vocabulary that has
 * nothing to do with Markdown. `Finding` is what the tool owes its caller.
 * Everything between the two - matching, rules, reporting - touches neither
 * mdast nor Asciidoctor nor parse5, which is what lets a new input format be
 * one file plus a line in the parser registry.
 */

/** Operational/usage failure. Exits 2; never used for lint findings. */
export class MooseLintError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MooseLintError";
  }
}

/** A point in a source file. Line and column are 1-based, offset 0-based. */
export interface Point {
  line: number;
  column: number;
  offset: number;
}

/** A half-open source span, `start` inclusive and `end` exclusive. */
export interface Position {
  start: Point;
  end: Point;
}

/**
 * Content kinds a section can hold, named generically so a rule written once
 * works on every format. Each parser maps its own AST onto these: mdast
 * `paragraph`/`code`/`list`, Asciidoctor `paragraph`/`listing`/`ulist`|`olist`,
 * HTML `<p>`/`<pre>`/`<ul>`.
 */
export type ContentKind = "paragraph" | "code" | "list";

export interface ContentNodeBase {
  kind: ContentKind;
  position: Position;
  /** Plain-text rendering, used by pattern rules. */
  text: string;
}

export interface ParagraphNode extends ContentNodeBase {
  kind: "paragraph";
}

export interface CodeNode extends ContentNodeBase {
  kind: "code";
  /** Info string / language, when the format carries one. */
  lang?: string;
}

export interface ListItemNode {
  position: Position;
  text: string;
  /** Nested content, so item-level paragraph/code/list rules can run. */
  children: ContentNode[];
}

export interface ListNode extends ContentNodeBase {
  kind: "list";
  ordered: boolean;
  items: ListItemNode[];
}

export type ContentNode = ParagraphNode | CodeNode | ListNode;

/**
 * One section of a document, demarcated by a heading.
 *
 * `slug`/`title`/`level`/`order`/`parentSlug` intentionally match moose-kg's
 * `Section` (dockg/src/types.ts), so its graph can be built from this tree.
 *
 * `content` is in document order and is the single source of truth: the
 * paragraph/code/list counts every rule needs are queries over it, not
 * separately maintained arrays.
 */
export interface SectionNode {
  /** Slug of the heading, disambiguated across the document (`install-1`). */
  slug: string;
  /** Heading text, with inline markup flattened. */
  title: string;
  /** Heading level, 1-6. 0 for the implicit lead section before any heading. */
  level: number;
  /** 1-based position among siblings under the same parent. */
  order: number;
  /** Slug of the enclosing section, or null at the top level. */
  parentSlug: string | null;
  /** Span of the heading itself. Null for the implicit lead section. */
  headingPosition: Position | null;
  /** Span of the whole section: its heading through the last node before the next sibling heading. */
  position: Position;
  /** Direct content, in document order, excluding anything owned by a subsection. */
  content: ContentNode[];
  /** Nested sections, in document order. */
  sections: SectionNode[];
}

/** What a parser returns for one file. */
export interface DocumentTree {
  /** Name of the parser that produced this (`markdown`, `asciidoc`, ...). */
  format: string;
  /** Path the content came from, for error messages. */
  filePath: string;
  /** Raw frontmatter/metadata values, or null when the file carries none. */
  frontmatter: Record<string, unknown> | null;
  /** Span of the frontmatter block, for anchoring findings about it. */
  frontmatterPosition: Position | null;
  /** Top-level sections, in document order. */
  sections: SectionNode[];
}

/**
 * A parser for one input format.
 *
 * Shaped after docmeta's `MetadataExtractor` so the two registries read the
 * same way. Unimplemented formats are still registered, so `moose-lint formats`
 * can report them and an `.rst` file gets "not implemented yet" rather than
 * being silently parsed as Markdown.
 */
export interface DocumentParser {
  /** Stable name, also used as `DocumentTree.format`. */
  name: string;
  /** Human-readable label for `moose-lint formats`. */
  label: string;
  /** Lowercase file extensions this parser handles, incl. dot (e.g. ".md"). */
  extensions: string[];
  /**
   * Extensions safe to collect from a directory walk. Defaults to
   * `extensions`.
   *
   * The two differ when an extension is a generic container rather than a
   * documentation format. `.xml` is the case: this parser can read a DocBook
   * or DITA document named explicitly, but a docs tree also contains
   * `pom.xml`, `sitemap.xml`, and `.csproj`, and sweeping those in turns a
   * clean run into a failure about files the user never asked to lint.
   */
  walkExtensions?: string[];
  /** Whether this parser is wired up (false for roadmap stubs). */
  implemented: boolean;
  /** Parse raw file content into the generic tree. */
  parse(content: string, filePath: string): DocumentTree;
}

/** Severity of a finding. Reserved for future rule-level configuration. */
export type Severity = "error" | "warning";

/**
 * One structural violation.
 *
 * The field set is pinned by moose-docevals' tool adapter, which reads
 * `{ type, heading, message, position }` off the JSON reporter. Additions are
 * safe; renames are not.
 */
export interface Finding {
  /** Machine-readable rule id, e.g. `missing_section`. */
  type: string;
  /** Heading of the section the finding is anchored to, if any. */
  heading: string | null;
  message: string;
  position: Position;
  severity: Severity;
}

/** Why a file was not linted. */
export type SkipReason = "no-template" | "unsupported-format";

/** Result of linting one file. */
export interface FileResult {
  file: string;
  /** True when the file was linted and produced no findings. */
  success: boolean;
  findings: Finding[];
  /** Template id/ref applied, or null when skipped. */
  template: string | null;
  /** Set when the file was skipped rather than linted. */
  skipped?: SkipReason;
}
