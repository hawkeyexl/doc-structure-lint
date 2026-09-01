/**
 * Fold a flat list of blocks into a nested section tree.
 *
 * Every format arrives here as an ordered list of `Block`s - a heading, or a
 * piece of content - and leaves as `SectionNode[]`. Keeping the fold in one
 * place is what makes a new format one `toBlocks` function rather than a second
 * copy of the nesting, position, and slug logic.
 *
 * Two position rules are deliberate:
 *
 *  - A section ends where the *next section at its level or shallower* begins,
 *    not at its own last child. A finding about a section therefore spans the
 *    trailing blank lines a reader would consider part of it, and adjacent
 *    sections tile the document with no gaps.
 *  - Content appearing before any heading becomes an implicit lead section at
 *    `level: 0`, so a headless document (frontmatter, prose, then `## ...`)
 *    still has somewhere to hang its content and its later headings nest under
 *    it rather than being dropped.
 */
import GithubSlugger from "github-slugger";
import type { ContentNode, Position, SectionNode } from "../types.js";

export interface HeadingBlock {
  type: "heading";
  /** 1-6. */
  level: number;
  title: string;
  position: Position;
}

export interface ContentBlock {
  type: "content";
  node: ContentNode;
}

export type Block = HeadingBlock | ContentBlock;

/** Mutable while open; frozen into a `SectionNode` on close. */
interface OpenSection {
  node: SectionNode;
  /** End of the last block seen, the fallback when nothing follows. */
  lastEnd: Position["end"];
}

/**
 * @param blocks   Document blocks in source order, frontmatter excluded.
 * @param docEnd   End of the document, used to close the final sections.
 */
export function sectionize(blocks: Block[], docEnd: Position["end"]): SectionNode[] {
  const slugger = new GithubSlugger();
  const roots: SectionNode[] = [];
  const stack: OpenSection[] = [];

  /** Close every open section at `level` or deeper, ending it at `end`. */
  const closeTo = (level: number, end: Position["end"]): void => {
    while (stack.length > 0 && stack[stack.length - 1]!.node.level >= level) {
      const open = stack.pop()!;
      open.node.position.end = { ...end };
    }
  };

  const push = (node: SectionNode): void => {
    const parent = stack[stack.length - 1];
    if (parent) {
      node.parentSlug = parent.node.slug;
      node.order = parent.node.sections.length + 1;
      parent.node.sections.push(node);
    } else {
      node.parentSlug = null;
      node.order = roots.length + 1;
      roots.push(node);
    }
    stack.push({ node, lastEnd: node.position.end });
  };

  /**
   * The implicit lead section. `level: 0` is below every real heading, so the
   * headings that follow nest inside it instead of closing it.
   */
  const openLead = (start: Position["start"]): void => {
    push({
      slug: slugger.slug("(lead)"),
      title: "",
      level: 0,
      order: 0,
      parentSlug: null,
      headingPosition: null,
      position: { start: { ...start }, end: { ...start } },
      content: [],
      sections: [],
    });
  };

  for (const block of blocks) {
    if (block.type === "heading") {
      closeTo(block.level, block.position.start);
      push({
        slug: slugger.slug(block.title),
        title: block.title,
        level: block.level,
        order: 0,
        parentSlug: null,
        headingPosition: { ...block.position },
        position: { start: { ...block.position.start }, end: { ...block.position.end } },
        content: [],
        sections: [],
      });
      continue;
    }

    if (stack.length === 0) openLead(block.node.position.start);
    const current = stack[stack.length - 1]!;
    current.node.content.push(block.node);
    current.lastEnd = block.node.position.end;
    // Every enclosing section grows with its descendants, so a parent's span
    // always covers its children even before it is closed.
    for (const open of stack) open.node.position.end = { ...block.node.position.end };
  }

  closeTo(0, docEnd);
  return roots;
}
