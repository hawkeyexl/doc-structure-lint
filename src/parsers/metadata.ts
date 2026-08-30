/**
 * Metadata helpers shared by every format that has both metadata and headings.
 *
 * Both functions here were independently written four times, once per parser,
 * and were character-identical each time. They are rules about a `DocumentTree`
 * rather than about any one syntax, so they belong in one place: a subtlety
 * duplicated four ways is a subtlety that will be fixed one way.
 */
import { locateFrontmatter } from "docmeta";
import type { Position } from "../types.js";
import type { Block } from "./sectionize.js";

/**
 * Span of a leading fenced metadata block (`--- … ---`, `+++ … +++`,
 * `;;; … ;;;`), or null when the content carries none.
 *
 * docmeta's locator reports character offsets against the original content, so
 * line numbers are recovered by counting newlines rather than by a second
 * parse - exact, because those offsets are byte-for-byte.
 */
export function fencedPosition(content: string): Position | null {
  const loc = locateFrontmatter(content);
  if (!loc) return null;
  const before = content.slice(0, loc.openStart);
  const startLine = before.split("\n").length;
  const lines = content.slice(loc.openStart, loc.closeEnd).split("\n");
  return {
    start: { line: startLine, column: 1, offset: loc.openStart },
    end: {
      line: startLine + lines.length - 1,
      // Taken from the last line's own length rather than fixed at 1. When the
      // block ends with a newline that line is empty and the column is 1
      // anyway; when the closing fence ends at EOF without one, the half-open
      // end is just past the delimiter - which `offset` already said, so a
      // fixed column contradicted it and pointed a reader's caret at the start
      // of the fence line instead of its end.
      column: lines[lines.length - 1]!.length + 1,
      offset: loc.closeEnd,
    },
  };
}

/**
 * Treat a metadata `title` as the document's H1 when the body has none.
 *
 * Docusaurus, Hugo, and Starlight all render the page title from frontmatter,
 * so their pages legitimately start at `##`. Read literally, such a page has no
 * top-level section, and every doctype template - which models the title as its
 * outermost rule, because that is how the published templates are written -
 * misaligns against it and reports a cascade. The page is not malformed; the
 * title simply is not written where a naive reading looks for it.
 *
 * So a synthetic heading is prepended, positioned on the metadata that actually
 * carries the title. Everything downstream then sees the document the way a
 * reader sees it rendered.
 *
 * Only when the body has no level-1 heading of its own: prepending one where a
 * real title exists would nest it inside a synthetic parent, which is a
 * different document.
 *
 * See ADR 01006. Formats where the title is always a body element - XML, whose
 * "metadata" is the root element's own attributes - do not call this, and
 * should not.
 */
export function withMetadataTitle(
  blocks: Block[],
  metadata: Record<string, unknown> | null,
  position: Position | null,
): Block[] {
  const declared = metadata?.["title"];
  const title = typeof declared === "string" ? declared.trim() : null;
  // Trimmed, not merely non-empty: `title: "   "` is as absent as no title at
  // all, and admitting it would give the document a synthetic H1 with a blank
  // heading - which every template then reports as the wrong title, naming
  // nothing the author could search for.
  if (title === null || title.length === 0) return blocks;
  if (position === null) return blocks;
  if (blocks.some((b) => b.type === "heading" && b.level === 1)) return blocks;

  return [{ type: "heading", level: 1, title, position }, ...blocks];
}

/**
 * The content with a leading fenced metadata block removed.
 *
 * docmeta's AsciiDoc and reStructuredText extractors short-circuit: when a
 * fence is present they return it and never look at the format's own metadata.
 * So a page carrying both a `---` fence and a native `:type: how-to` header
 * lost the `type` entirely and was skipped as untyped - while the same page in
 * HTML, whose extractor has no such branch, routed correctly. Running the
 * native extractor over the fence-free remainder is what lets both be read.
 *
 * Only the values are taken from that second read; positions would be shifted
 * by the removal and are not used.
 */
export function withoutFence(content: string): string {
  const loc = locateFrontmatter(content);
  return loc ? content.slice(loc.closeEnd) : content;
}
