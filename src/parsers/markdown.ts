/**
 * Markdown and MDX parsers.
 *
 * They share everything but the unified processor. MDX needs its own, selected
 * by extension rather than by a flag: `remark-mdx` reads `{` as an expression
 * delimiter, so ordinary Markdown prose containing a brace is a syntax error
 * under it. Running one processor for both formats would break either MDX
 * (without the plugin) or plain Markdown (with it).
 */
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkFrontmatter from "remark-frontmatter";
import remarkMdx from "remark-mdx";
import { extractFrontmatter, locateFrontmatter } from "docmeta";
import type { DocumentParser, DocumentTree, Position } from "../types.js";
import { MooseLintError } from "../types.js";
import { documentEnd, toBlocks } from "./mdast.js";
import type { Block } from "./sectionize.js";
import { sectionize } from "./sectionize.js";

const markdownProcessor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkFrontmatter, ["yaml", "toml"]);

const mdxProcessor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkFrontmatter, ["yaml", "toml"])
  .use(remarkMdx);

/**
 * Frontmatter span from docmeta's locator, which reports character offsets
 * against the original content. Line 1 is where a fenced block always starts,
 * and the end line is recovered by counting newlines - cheaper than a second
 * parse and exact, because the locator's offsets are byte-for-byte.
 */
function frontmatterPosition(content: string): Position | null {
  const loc = locateFrontmatter(content);
  if (!loc) return null;
  const before = content.slice(0, loc.openStart);
  const startLine = before.split("\n").length;
  const inner = content.slice(loc.openStart, loc.closeEnd);
  return {
    start: { line: startLine, column: 1, offset: loc.openStart },
    end: {
      line: startLine + inner.split("\n").length - 1,
      column: 1,
      offset: loc.closeEnd,
    },
  };
}

/**
 * Only `parse` is used, and unified's `Processor` generics differ between the
 * plain and MDX pipelines (their tree types are not the same), so the narrow
 * structural type is both sufficient and the one that lets both pass.
 */
interface Parseable {
  parse(content: string): unknown;
}

/**
 * Treat a frontmatter `title` as the document's H1 when the body has none.
 *
 * Docusaurus, Hugo, and Starlight all render the page title from frontmatter,
 * so their pages legitimately start at `##`. Read literally, such a page has no
 * top-level section, and every doctype template - which models the title as its
 * outermost rule, because that is how the published templates are written -
 * misaligns against it and reports a cascade. The page is not malformed; the
 * title simply is not written where a naive reading looks for it.
 *
 * So a synthetic H1 block is prepended, positioned on the frontmatter that
 * actually carries the title. Everything downstream then sees the document the
 * way a reader sees it rendered.
 *
 * Only when the body has no H1 of its own: prepending one where a real H1
 * exists would nest the real title inside a synthetic parent, which is a
 * different document.
 */
function withFrontmatterTitle(
  blocks: Block[],
  frontmatter: Record<string, unknown> | null,
  position: Position | null,
): Block[] {
  const title = frontmatter?.["title"];
  if (typeof title !== "string" || title.length === 0) return blocks;
  if (position === null) return blocks;
  if (blocks.some((b) => b.type === "heading" && b.level === 1)) return blocks;

  return [{ type: "heading", level: 1, title, position }, ...blocks];
}

function parseWith(
  processor: Parseable,
  format: string,
  content: string,
  filePath: string,
): DocumentTree {
  let root: unknown;
  try {
    root = processor.parse(content);
  } catch (err) {
    // MDX raises on malformed expressions; a parse failure is the file's
    // problem, not a crash, so it surfaces as an operational error naming it.
    throw new MooseLintError(
      `${filePath}: could not parse as ${format}: ${(err as Error).message}`,
    );
  }

  const meta = extractFrontmatter(content, format);
  const tree = root as Parameters<typeof toBlocks>[0];

  const frontmatter = meta.present ? meta.data : null;
  const metaPosition = frontmatterPosition(content);

  return {
    format,
    filePath,
    frontmatter,
    frontmatterPosition: metaPosition,
    sections: sectionize(
      withFrontmatterTitle(toBlocks(tree), frontmatter, metaPosition),
      documentEnd(tree),
    ),
  };
}

export const markdownParser: DocumentParser = {
  name: "markdown",
  label: "Markdown",
  extensions: [".md", ".markdown"],
  implemented: true,
  parse: (content, filePath) =>
    parseWith(markdownProcessor, "markdown", content, filePath),
};

export const mdxParser: DocumentParser = {
  name: "mdx",
  label: "MDX",
  extensions: [".mdx"],
  implemented: true,
  parse: (content, filePath) => parseWith(mdxProcessor, "mdx", content, filePath),
};
