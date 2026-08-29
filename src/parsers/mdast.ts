/**
 * mdast -> generic blocks. Shared by the Markdown and MDX parsers, which differ
 * only in which unified processor produced the tree.
 *
 * Node types outside `heading`/`paragraph`/`code`/`list` are skipped rather
 * than mapped to a nearest neighbour. A blockquote is not a paragraph and a
 * table is not a list; counting them as one would make `paragraphs: {max: 3}`
 * fail on documents a reader would say satisfy it.
 */
import { toString as mdastToString } from "mdast-util-to-string";
import type { Position } from "../types.js";
import type { ContentNode, ListItemNode } from "../types.js";
import type { Block } from "./sectionize.js";

/** Minimal structural view of an mdast node; avoids depending on @types/mdast shapes. */
interface MdNode {
  type: string;
  position?: {
    start: { line: number; column: number; offset?: number };
    end: { line: number; column: number; offset?: number };
  };
  children?: MdNode[];
  depth?: number;
  lang?: string | null;
  ordered?: boolean | null;
  value?: string;
}

const ZERO: Position = {
  start: { line: 1, column: 1, offset: 0 },
  end: { line: 1, column: 1, offset: 0 },
};

/**
 * unist positions carry `offset` as optional. It is always present on a tree
 * remark parsed from a string, but the type does not say so, and a missing
 * offset would otherwise become `NaN` in a reporter.
 */
export function positionOf(node: MdNode): Position {
  const p = node.position;
  if (!p) return { start: { ...ZERO.start }, end: { ...ZERO.end } };
  return {
    start: { line: p.start.line, column: p.start.column, offset: p.start.offset ?? 0 },
    end: { line: p.end.line, column: p.end.column, offset: p.end.offset ?? 0 },
  };
}

function toContentNode(node: MdNode): ContentNode | null {
  switch (node.type) {
    case "paragraph":
      return {
        kind: "paragraph",
        position: positionOf(node),
        text: mdastToString(node as never),
      };
    case "code":
      return {
        kind: "code",
        position: positionOf(node),
        text: node.value ?? "",
        ...(node.lang ? { lang: node.lang } : {}),
      };
    case "list":
      return {
        kind: "list",
        position: positionOf(node),
        text: mdastToString(node as never),
        ordered: Boolean(node.ordered),
        items: (node.children ?? [])
          .filter((child) => child.type === "listItem")
          .map(
            (item): ListItemNode => ({
              position: positionOf(item),
              text: mdastToString(item as never),
              children: (item.children ?? [])
                .map(toContentNode)
                .filter((n): n is ContentNode => n !== null),
            }),
          ),
      };
    default:
      return null;
  }
}

/** Flatten an mdast root's direct children into ordered blocks. */
export function toBlocks(root: MdNode): Block[] {
  const blocks: Block[] = [];
  for (const node of root.children ?? []) {
    // Frontmatter is metadata, not body content; the caller reads it separately.
    if (node.type === "yaml" || node.type === "toml") continue;

    if (node.type === "heading") {
      blocks.push({
        type: "heading",
        level: node.depth ?? 1,
        title: mdastToString(node as never),
        position: positionOf(node),
      });
      continue;
    }

    const content = toContentNode(node);
    if (content) blocks.push({ type: "content", node: content });
  }
  return blocks;
}

/** End of the document, for closing the final sections. */
export function documentEnd(root: MdNode): Position["end"] {
  return positionOf(root).end;
}
