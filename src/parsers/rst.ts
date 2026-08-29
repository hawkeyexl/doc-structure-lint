/**
 * reStructuredText -> generic blocks.
 *
 * Unlike its siblings this parser has no AST library under it. There is no
 * usable reStructuredText parser for JavaScript, so this reads the source
 * directly: a line scanner that answers one question - what sections does this
 * document have, and what paragraphs, code blocks, and lists are in each - and
 * then hands `sectionize` the same `Block[]` every other format produces.
 *
 * ## Section levels
 *
 * RST has no fixed heading hierarchy. A title is a line underlined, and
 * optionally also overlined, by a run of punctuation at least as long as the
 * title. Which *level* an adornment style means is discovered, not fixed:
 *
 *   "Rather than imposing a fixed number and order of section title adornment
 *    styles, the order enforced will be the order as encountered."
 *   - the reStructuredText spec, "Sections"
 *
 * So the first style seen is level 1, the next new style level 2, and so on -
 * `===` then `+++` then `---` is a perfectly ordinary document, and a
 * hardcoded character-to-level table would get it wrong. The spec also makes
 * over-and-underlined styles distinct from underline-only ones using the same
 * character, so the style key carries both facts (`over:=` vs `under:=`).
 *
 * Levels are clamped to 6, because `SectionNode.level` is documented 1-6; a
 * document with seven adornment styles is beyond what the templates model.
 *
 * ## What this deliberately does not handle
 *
 * This is a structural scanner, not docutils. It does not implement, and
 * silently ignores:
 *
 *  - **Substitutions** (`|name|` definitions and references) - a reference is
 *    flattened to its bare name, a definition is skipped with other directives.
 *  - **Includes** (`.. include::`) - the referenced file is never read, so
 *    sections it would contribute are invisible.
 *  - **Transitions** (a lone adornment run between paragraphs) - skipped, like
 *    Markdown thematic breaks.
 *  - **Definition lists**, **option lists**, and **line blocks** (`|`) -
 *    skipped, not mapped onto `list`. A definition list is not a bullet list,
 *    and counting it as one would make `lists: {max: 1}` fail a document a
 *    reader would say satisfies it. This is the same call `mdast.ts` makes for
 *    blockquotes and tables.
 *  - **Doctest blocks** (`>>>`) - recognised so they are not mis-read as prose,
 *    but skipped rather than emitted as `code`.
 *  - **Tables**, grid and simple - recognised and skipped, for the same reason.
 *  - **Block quotes** (a bare indented block) - skipped.
 *  - **Quoted literal blocks** (an unindented literal block quoted with
 *    punctuation) - not recognised; read as prose.
 *  - **Enumerator styles beyond `1.`/`1)`/`#.`/`#)`** - alphabetic and Roman
 *    enumerators (`a.`, `iv.`) and the parenthesised `(1)` form are read as
 *    prose. They are ambiguous without docutils' second-item confirmation:
 *    `A. Smith wrote this` is a sentence, not a list.
 *  - **Roles and inline markup** beyond a regex flattening - `flattenInline`
 *    strips the common constructs; it does not implement inline parsing, does
 *    not process `\` escapes, and leaves trailing reference underscores alone
 *    (stripping them would eat `snake_case`).
 *  - **Tab expansion** in indentation - a tab counts as one column, where
 *    docutils expands to the next multiple of eight.
 *  - **East Asian width** - adornment length is compared against the title's
 *    code-point count, where the spec compares display columns.
 *  - **Document title promotion** - docutils promotes a lone top-level section
 *    to the document title. Here it stays a level-1 section, which is what the
 *    doctype templates model (a title with its subsections hanging under it).
 *  - **Directive options and content semantics** - only `code-block`, `code`,
 *    and `sourcecode` produce a node at all; every other directive is skipped
 *    whole.
 *  - **Anything an unterminated fenced block would need** - a *complete* fenced
 *    front matter block is cut from the body before scanning, because `---`
 *    reads as a transition and the YAML under it as prose. An unterminated one
 *    is not front matter, and is scanned as the RST it literally is.
 *
 * One judgement call is worth stating plainly. The spec requires an adornment
 * run to extend "at least as far as the right edge of the title text", and
 * that is what is enforced here: a shorter run is not a section title, and the
 * line becomes a paragraph. docutils the implementation is more forgiving - it
 * reports "Title underline too short" and recovers - but taking the strict
 * reading is what keeps this parser agreeing with `docmeta`'s RST extractor,
 * which applies the same rule to the document title.
 */
import { extractFrontmatter, extractorForExtension, locateFrontmatter } from "docmeta";
import type {
  ContentNode,
  DocumentParser,
  DocumentTree,
  ListItemNode,
  Point,
  Position,
} from "../types.js";
import type { Block } from "./sectionize.js";
import { sectionize } from "./sectionize.js";
import { fencedPosition, withMetadataTitle as withFrontmatterTitle } from "./metadata.js";

/** Every character the spec allows as title adornment. */
const ADORNMENT_CHARS = new Set(
  "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~".split(""),
);

/** Explicit markup: a directive, comment, target, or substitution definition. */
const EXPLICIT = /^[ \t]*\.\.(?:[ \t]|$)/;
/** A directive with a parseable name, e.g. `.. code-block:: python`. */
const DIRECTIVE = /^([ \t]*)\.\.[ \t]+([\w.+:-]+)::[ \t]*(.*)$/;
/** Directives that carry a literal block, with the language as the argument. */
const CODE_DIRECTIVES = new Set(["code", "code-block", "sourcecode"]);
/** A field-list entry: `:name:` or `:name: value`. */
const FIELD = /^[ \t]*:[^:\s][^:]*:(?:[ \t]|$)/;
/** A directive option inside a directive body, e.g. `:linenos:`. */
const OPTION = /^[ \t]*:[\w-]+:(?:[ \t].*)?$/;
/** A bullet-list item. The marker must be followed by whitespace or nothing. */
const BULLET = /^([ \t]*)([*+-])(?:([ \t]+)(.*))?$/;
/** An enumerated-list item, arabic or auto (`#`), with a `.` or `)` suffix. */
const ENUM = /^([ \t]*)(\d+|#)([.)])(?:([ \t]+)(.*))?$/;
/** A doctest block. */
const DOCTEST = /^[ \t]*>>>[ \t]/;
/** A grid-table border. */
const GRID_TABLE = /^[ \t]*\+[-=+]+\+[ \t]*$/;
/** A simple-table border: runs of `=` (or `-`, for column spans) with gaps. */
const SIMPLE_TABLE = /^[ \t]*[-=]+(?:[ \t]+[-=]+)+[ \t]*$/;

/**
 * The source, indexed by line.
 *
 * `text` is the array the scanner reads, and it is mutable on purpose: list
 * item markers are blanked out of it *in place, space for space*, so an item's
 * body can be scanned by the same code that scans the document body without
 * re-slicing anything. Every column and offset in `starts` stays exact by
 * construction rather than by bookkeeping.
 *
 * Line terminators are stripped, and CRLF is handled here so nothing below has
 * to know about it.
 */
interface Source {
  text: string[];
  /** Offset of the first character of each line. */
  starts: number[];
  /** End of the document, for closing the final sections. */
  end: Point;
}

function indexLines(content: string): Source {
  const text: string[] = [];
  const starts: number[] = [];
  let cursor = 0;
  for (;;) {
    starts.push(cursor);
    const nl = content.indexOf("\n", cursor);
    if (nl === -1) {
      text.push(content.slice(cursor));
      break;
    }
    const hadCr = nl > cursor && content.charCodeAt(nl - 1) === 13;
    text.push(content.slice(cursor, hadCr ? nl - 1 : nl));
    cursor = nl + 1;
  }
  return {
    text,
    starts,
    end: {
      line: text.length,
      column: (text[text.length - 1] ?? "").length + 1,
      offset: content.length,
    },
  };
}

/** Leading whitespace width. Tabs count as one column; see the header. */
function indentOf(line: string): number {
  let i = 0;
  while (i < line.length && (line[i] === " " || line[i] === "\t")) i++;
  return i;
}

function isBlank(line: string | undefined): boolean {
  return (line ?? "").trim() === "";
}

/**
 * A run of one repeated adornment character starting at column 1, or null.
 *
 * One character counts. docutils only rejects a run for being short when it is
 * also shorter than the title, so `A` over `=` is a section - and a lone
 * punctuation line that underlines nothing is a too-short transition marker,
 * which docutils drops. Skipping it, which is what the caller does with any
 * adornment that started no title, is the same outcome.
 */
function adornmentOf(line: string | undefined): { char: string; length: number } | null {
  const trimmed = (line ?? "").replace(/[ \t]+$/, "");
  if (trimmed.length < 1) return null;
  const char = trimmed[0]!;
  if (!ADORNMENT_CHARS.has(char)) return null;
  for (let i = 1; i < trimmed.length; i++) {
    if (trimmed[i] !== char) return null;
  }
  return { char, length: trimmed.length };
}

/**
 * Strip the inline markup a heading or paragraph is likely to carry, so a title
 * matches a template's `heading.const` and a slug reads like the rendered page.
 * A regex pass, not an inline parser - see the header for what it misses.
 */
function flattenInline(text: string): string {
  return text
    .replace(/``([^`]*)``/g, "$1")
    .replace(/:[\w.+:-]+:`([^`]*)`/g, "$1")
    .replace(/`([^`]*?)[ \t]*<[^<>]*>`__?/g, "$1")
    .replace(/`([^`]*)`__?/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\|([^|\s][^|]*)\|/g, "$1")
    .trim();
}

/** Point at the start of `line`'s column `column` (1-based). */
function pointAt(src: Source, line: number, column: number): Point {
  return {
    line: line + 1,
    column,
    offset: (src.starts[line] ?? 0) + column - 1,
  };
}

/**
 * Span of the source lines `first..last` inclusive, ending just past the last
 * non-whitespace character - the convention mdast uses, so a block's end never
 * runs into the heading that follows it.
 */
function spanOf(src: Source, first: number, last: number, startColumn?: number): Position {
  const firstLine = src.text[first] ?? "";
  const lastLine = (src.text[last] ?? "").replace(/[ \t]+$/, "");
  return {
    start: pointAt(src, first, startColumn ?? indentOf(firstLine) + 1),
    end: pointAt(src, last, lastLine.length + 1),
  };
}

/** A section title found at a line, with the adornment style that marked it. */
interface TitleHit {
  title: string;
  /** Style key; over-and-underlined is distinct from underline-only. */
  style: string;
  /** First line of the construct (the overline, or the title text). */
  first: number;
  /** Last line of the construct (always the underline). */
  last: number;
}

/**
 * A section title starting at `line`, or null.
 *
 * Both forms are checked: overline / text / matching underline, and text /
 * underline. The adornment must be at least as long as the title text, and an
 * overline must match its underline in both character and length - what the
 * spec requires, and what `docmeta`'s RST extractor enforces for the doctitle.
 */
function titleAt(src: Source, line: number, limit: number): TitleHit | null {
  const over = adornmentOf(src.text[line]);
  if (over) {
    if (line + 2 >= limit) return null;
    const text = src.text[line + 1] ?? "";
    const under = adornmentOf(src.text[line + 2]);
    const title = flattenInline(text);
    if (
      title !== "" &&
      adornmentOf(text) === null &&
      under !== null &&
      under.char === over.char &&
      under.length === over.length &&
      over.length >= text.trim().length
    ) {
      return { title, style: `over:${over.char}`, first: line, last: line + 2 };
    }
    // A lone run is a transition, and a mismatched pair is not a title.
    return null;
  }

  if (line + 1 >= limit) return null;
  const text = src.text[line] ?? "";
  if (text.trim() === "" || indentOf(text) > 0) return null;
  const under = adornmentOf(src.text[line + 1]);
  if (under === null || under.length < text.trim().length) return null;
  const title = flattenInline(text);
  if (title === "") return null;
  return { title, style: `under:${under.char}`, first: line, last: line + 1 };
}

/**
 * End of an indented block opened at `from`: the first line at or after `from`
 * whose indent is at or below `base` and which is not blank. Returns the
 * exclusive end, trimmed of trailing blank lines.
 */
function indentedBlockEnd(src: Source, from: number, to: number, base: number): number {
  let i = from;
  let last = from - 1;
  while (i < to) {
    const line = src.text[i] ?? "";
    if (isBlank(line)) {
      i++;
      continue;
    }
    if (indentOf(line) <= base) break;
    last = i;
    i++;
  }
  return last + 1;
}

/** The lines `from..to` with their common indent removed, joined by newlines. */
function dedent(src: Source, from: number, to: number): string {
  let common = Infinity;
  for (let i = from; i < to; i++) {
    const line = src.text[i] ?? "";
    if (!isBlank(line)) common = Math.min(common, indentOf(line));
  }
  if (!Number.isFinite(common)) common = 0;
  const out: string[] = [];
  for (let i = from; i < to; i++) {
    const line = src.text[i] ?? "";
    out.push(isBlank(line) ? "" : line.slice(common).replace(/[ \t]+$/, ""));
  }
  return out.join("\n").replace(/\n+$/, "");
}

/** Last non-blank line in `from..to`, or `from - 1` when there is none. */
function lastContentLine(src: Source, from: number, to: number): number {
  for (let i = to - 1; i >= from; i--) {
    if (!isBlank(src.text[i])) return i;
  }
  return from - 1;
}

/** Scanner state that outlives one range: the adornment styles seen so far. */
interface Levels {
  styles: string[];
}

function levelFor(levels: Levels, style: string): number {
  let index = levels.styles.indexOf(style);
  if (index === -1) {
    levels.styles.push(style);
    index = levels.styles.length - 1;
  }
  return Math.min(index + 1, 6);
}

/**
 * Scan `from..to` at indent `base` into ordered blocks.
 *
 * `headings` is false inside a list item: RST section titles only occur at the
 * document's own indent, and a heading emitted from inside an item would break
 * the fold.
 */
function scanRange(
  src: Source,
  levels: Levels,
  from: number,
  to: number,
  base: number,
  headings: boolean,
): Block[] {
  const blocks: Block[] = [];
  const content = (node: ContentNode): void => {
    blocks.push({ type: "content", node });
  };
  let i = from;

  while (i < to) {
    const line = src.text[i] ?? "";

    if (isBlank(line)) {
      i++;
      continue;
    }

    if (headings) {
      const hit = titleAt(src, i, to);
      if (hit) {
        blocks.push({
          type: "heading",
          level: levelFor(levels, hit.style),
          title: hit.title,
          position: spanOf(src, hit.first, hit.last),
        });
        i = hit.last + 1;
        continue;
      }
    }

    // `::` alone is the expanded form of the literal-block marker, and it also
    // reads as a two-character run of `:`. The marker wins: an adornment of
    // colons could only ever underline a title one or two characters wide.
    if (line.trim() === "::") {
      i = readParagraph(src, levels, blocks, i, to, base, headings);
      continue;
    }

    // A run of adornment that did not start a title is a transition, or the
    // stray underline of something that was not one. Either way, not content.
    if (adornmentOf(line) !== null) {
      i++;
      continue;
    }

    const lineIndent = indentOf(line);

    // Explicit markup. A code directive becomes a `code` node; every other
    // directive, comment, target, and substitution definition is skipped whole.
    if (EXPLICIT.test(line)) {
      const bodyEnd = indentedBlockEnd(src, i + 1, to, lineIndent);
      const directive = DIRECTIVE.exec(line);
      const name = directive?.[2]?.toLowerCase();
      if (name && CODE_DIRECTIVES.has(name)) {
        const lang = (directive?.[3] ?? "").trim();
        // Drop the directive's own options (`:linenos:` and friends) before the
        // body; they are configuration, not code.
        let codeStart = i + 1;
        while (codeStart < bodyEnd && OPTION.test(src.text[codeStart] ?? "")) codeStart++;
        while (codeStart < bodyEnd && isBlank(src.text[codeStart])) codeStart++;
        const codeEnd = lastContentLine(src, codeStart, bodyEnd) + 1;
        content({
          kind: "code",
          position: spanOf(src, i, Math.max(codeEnd - 1, i)),
          text: codeStart < codeEnd ? dedent(src, codeStart, codeEnd) : "",
          ...(lang ? { lang } : {}),
        });
      }
      i = Math.max(bodyEnd, i + 1);
      continue;
    }

    // Field lists (docinfo, and bibliographic fields) are metadata, read
    // separately by `readMetadata`. Never body content.
    if (FIELD.test(line) && lineIndent === base) {
      i = Math.max(indentedBlockEnd(src, i + 1, to, lineIndent), i + 1);
      while (i < to && FIELD.test(src.text[i] ?? "") && indentOf(src.text[i] ?? "") === base) {
        i = Math.max(indentedBlockEnd(src, i + 1, to, lineIndent), i + 1);
      }
      continue;
    }

    if (DOCTEST.test(line) || GRID_TABLE.test(line) || SIMPLE_TABLE.test(line)) {
      // Consume the run of non-blank lines the construct occupies.
      let end = i;
      while (end < to && !isBlank(src.text[end])) end++;
      i = end;
      continue;
    }

    // An indented block with no `::` ahead of it is a block quote.
    if (lineIndent > base) {
      i = Math.max(indentedBlockEnd(src, i, to, base), i + 1);
      continue;
    }

    const bullet = BULLET.exec(line);
    if (bullet && indentOf(line) === base && bulletHasBody(bullet, src, i, to, base)) {
      const list = parseList(src, levels, i, to, base, false);
      content(list.node);
      i = list.next;
      continue;
    }

    const enumerated = ENUM.exec(line);
    if (enumerated && indentOf(line) === base && bulletHasBody(enumerated, src, i, to, base)) {
      const list = parseList(src, levels, i, to, base, true);
      content(list.node);
      i = list.next;
      continue;
    }

    // A term whose next line is indented is a definition list, not a paragraph
    // followed by a block quote. Skipped, like every other undescribed kind.
    const next = src.text[i + 1];
    if (i + 1 < to && !isBlank(next) && indentOf(next ?? "") > base) {
      i = Math.max(indentedBlockEnd(src, i + 1, to, base), i + 1);
      continue;
    }

    i = readParagraph(src, levels, blocks, i, to, base, headings);
  }

  return blocks;
}

/**
 * Does a matched list marker actually open an item?
 *
 * A marker with text after it always does. A bare marker opens one only when an
 * indented block follows, which is what separates an empty list item from a
 * line that merely starts with a hyphen.
 */
function bulletHasBody(
  match: RegExpExecArray,
  src: Source,
  line: number,
  to: number,
  base: number,
): boolean {
  // The content group is 4 for `BULLET` and 5 for `ENUM`, which has the extra
  // suffix group. Checking both is cheaper than threading the pattern's shape
  // through: only one of the two is ever a content group, and the other is
  // whitespace or undefined.
  if ((match[4] ?? "").trim() !== "" || (match[5] ?? "").trim() !== "") return true;
  for (let i = line + 1; i < to; i++) {
    const next = src.text[i] ?? "";
    if (isBlank(next)) continue;
    return indentOf(next) > base;
  }
  return false;
}

/** The marker text and the column its content starts at, for one item line. */
interface Marker {
  /** Width of the marker plus the whitespace after it. */
  width: number;
  /** Indent the item's body sits at. */
  contentIndent: number;
}

function markerOf(match: RegExpExecArray, ordered: boolean): Marker {
  const indent = (match[1] ?? "").length;
  const marker = ordered ? `${match[2] ?? ""}${match[3] ?? ""}` : (match[2] ?? "");
  const gap = (ordered ? match[4] : match[3]) ?? " ";
  return { width: marker.length + gap.length, contentIndent: indent + marker.length + gap.length };
}

/**
 * Parse the run of list items starting at `from`.
 *
 * Each item's marker is blanked out of `src.text` - replaced by exactly as many
 * spaces - so the item body is an ordinary indented block that `scanRange` can
 * read with no special case. Offsets and columns are untouched by construction.
 */
function parseList(
  src: Source,
  levels: Levels,
  from: number,
  to: number,
  base: number,
  ordered: boolean,
): { node: ContentNode; next: number } {
  const pattern = ordered ? ENUM : BULLET;
  const firstMatch = pattern.exec(src.text[from] ?? "")!;
  const markerChar = ordered ? (firstMatch[3] ?? ".") : (firstMatch[2] ?? "*");
  const items: ListItemNode[] = [];
  // Where the list ends, excluding the blank lines between items - those belong
  // to whatever follows, so a list before a heading does not swallow the gap.
  let end = from;
  let i = from;

  while (i < to) {
    // Items may be separated by blank lines; the list ends at the first
    // non-blank line that is not another item at this indent.
    let start = i;
    while (start < to && isBlank(src.text[start])) start++;
    if (start >= to) break;

    const line = src.text[start] ?? "";
    if (indentOf(line) !== base) break;
    const match = pattern.exec(line);
    if (!match) break;
    // docutils ends a list when the marker style changes; so do we.
    const thisChar = ordered ? (match[3] ?? ".") : (match[2] ?? "");
    if (thisChar !== markerChar) break;
    if (!bulletHasBody(match, src, start, to, base)) break;

    const marker = markerOf(match, ordered);
    // Blank the marker in place. Same length, so `starts` stays exact.
    src.text[start] = " ".repeat(marker.contentIndent) + line.slice(marker.contentIndent);

    const bodyEnd = Math.max(indentedBlockEnd(src, start + 1, to, base), start + 1);
    const last = lastContentLine(src, start, bodyEnd);
    const children = scanRange(src, levels, start, bodyEnd, marker.contentIndent, false)
      .filter((b): b is Extract<Block, { type: "content" }> => b.type === "content")
      .map((b) => b.node);

    items.push({
      position: spanOf(src, start, Math.max(last, start), base + 1),
      text: children.map((c) => c.text).join("\n"),
      children,
    });
    i = bodyEnd;
    end = bodyEnd;
  }

  const last = lastContentLine(src, from, end);
  return {
    node: {
      kind: "list",
      position: spanOf(src, from, Math.max(last, from), base + 1),
      text: items.map((item) => item.text).join("\n"),
      ordered,
      items,
    },
    next: Math.max(i, from + 1),
  };
}

/**
 * Read one paragraph, and the literal block it may introduce.
 *
 * A paragraph ending in `::` opens a literal block: the indented block after
 * it becomes `code`, and the `::` is stripped from the paragraph's own text the
 * way docutils strips it - removed entirely when the paragraph is only `::` or
 * when whitespace precedes it, and collapsed to one colon otherwise.
 */
function readParagraph(
  src: Source,
  levels: Levels,
  blocks: Block[],
  from: number,
  to: number,
  base: number,
  headings: boolean,
): number {
  let end = from;
  while (end < to) {
    const line = src.text[end] ?? "";
    if (isBlank(line)) break;
    if (end > from) {
      // A line whose successor underlines it ends the paragraph and starts a
      // section, and a construct of any other kind ends it too.
      if (headings && titleAt(src, end, to)) break;
      if (adornmentOf(line) !== null) break;
      if (EXPLICIT.test(line)) break;
      if (indentOf(line) !== base) break;
      if (GRID_TABLE.test(line) || SIMPLE_TABLE.test(line) || DOCTEST.test(line)) break;
    }
    end++;
  }

  const rawText = flattenInline(
    src.text
      .slice(from, end)
      .map((l) => l.trim())
      .join("\n"),
  );
  const literal = /::$/.test(rawText);
  const text = !literal
    ? rawText
    : rawText === "::"
      ? "" // A paragraph that is only `::` is the marker, and nothing else.
      : rawText.replace(/(\s*)::$/, (_m, space: string) => (space === "" ? ":" : ""));

  if (text.trim() !== "") {
    blocks.push({
      type: "content",
      node: { kind: "paragraph", position: spanOf(src, from, end - 1), text },
    });
  }

  if (!literal) return end;

  // The literal block is the next indented block, after any blank lines.
  let start = end;
  while (start < to && isBlank(src.text[start])) start++;
  if (start >= to || indentOf(src.text[start] ?? "") <= base) return end;

  const blockEnd = indentedBlockEnd(src, start, to, base);
  const last = lastContentLine(src, start, blockEnd);
  blocks.push({
    type: "content",
    node: {
      kind: "code",
      position: spanOf(src, start, Math.max(last, start)),
      text: dedent(src, start, blockEnd),
    },
  });
  return Math.max(blockEnd, end);
}

/**
 * Span of the native docinfo block: the leading field list, or - when a page
 * carries only a title - the title line docmeta read it from.
 *
 * docmeta reports the block's start line but not its extent, and we are already
 * holding a line index, so the span is cheaper to recover here than to ask for.
 */
function docinfoPosition(src: Source): Position | null {
  const limit = src.text.length;
  let i = 0;
  while (i < limit && isBlank(src.text[i])) i++;

  const hit = titleAt(src, i, limit);
  if (hit) i = hit.last + 1;
  while (i < limit && isBlank(src.text[i])) i++;

  const fieldStart = i;
  while (i < limit && FIELD.test(src.text[i] ?? "") && indentOf(src.text[i] ?? "") === 0) {
    i = Math.max(indentedBlockEnd(src, i + 1, limit, 0), i + 1);
  }
  if (i > fieldStart) return spanOf(src, fieldStart, i - 1);
  if (hit) return spanOf(src, hit.first, hit.last);
  return null;
}

interface Metadata {
  frontmatter: Record<string, unknown> | null;
  position: Position | null;
  /**
   * First body line, 0-based. Non-zero only for a fenced block, whose lines
   * would otherwise be scanned as prose - `---` as a transition and the YAML
   * under it as a paragraph, which opens an implicit lead section and hands the
   * template's top-level slot the wrong thing. A docinfo field list needs no
   * such cut: it is inside the body, and the scanner skips field lists.
   */
  bodyStart: number;
}

/**
 * Read the page's metadata, from both places an RST page can put it.
 *
 * `extractFrontmatter(content, "rst")` - the call `markdown.ts` makes - reads
 * only a *fenced* block; its format argument is a label copied onto the result,
 * not a dispatch. On its own it would leave every page using the native docinfo
 * field list unrouted, and that field list is how RST authors actually declare
 * `:type: how-to`. The RST-aware reading lives in docmeta's extractor registry,
 * so both are read and merged.
 *
 * A fenced block wins a key collision: it is the author being deliberate about
 * metadata, where a docinfo `title` is often just the document's own heading
 * read a second time. `present` is the OR of the two - the same shape the HTML
 * parser landed on, so the formats stay consistent.
 *
 * That docinfo `title` is worth knowing about. In RST the page title genuinely
 * *is* the first section title, so a page with a title and no fields comes back
 * with non-null `frontmatter` holding just that. Nothing downstream is misled -
 * routing reads `type` and `$template` - and taking docmeta's answer verbatim
 * keeps one source of truth for what a format's metadata is.
 */
function readMetadata(content: string, filePath: string, src: Source): Metadata {
  const fenced = extractFrontmatter(content, "rst");
  const native = extractorForExtension(".rst")?.extract(content, filePath);

  if (!fenced.present && !native?.present) {
    return { frontmatter: null, position: null, bodyStart: 0 };
  }

  const loc = fenced.present ? locateFrontmatter(content) : null;
  return {
    frontmatter: {
      ...(native?.present ? native.data : {}),
      ...(fenced.present ? fenced.data : {}),
    },
    position: fenced.present ? fencedPosition(content) : docinfoPosition(src),
    bodyStart: loc ? src.starts.findIndex((start) => start >= loc.closeEnd) : 0,
  };
}

export const rstParser: DocumentParser = {
  name: "rst",
  label: "reStructuredText",
  extensions: [".rst"],
  implemented: true,
  parse(content, filePath): DocumentTree {
    const src = indexLines(content);
    const { frontmatter, position, bodyStart } = readMetadata(content, filePath, src);
    const blocks = scanRange(
      src,
      { styles: [] },
      Math.max(bodyStart, 0),
      src.text.length,
      0,
      true,
    );

    return {
      format: "rst",
      filePath,
      frontmatter,
      frontmatterPosition: position,
      sections: sectionize(
        withFrontmatterTitle(blocks, frontmatter, position),
        src.end,
      ),
    };
  },
};
