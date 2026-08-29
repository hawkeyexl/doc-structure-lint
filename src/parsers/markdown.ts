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

  return {
    format,
    filePath,
    frontmatter: meta.present ? meta.data : null,
    frontmatterPosition: frontmatterPosition(content),
    sections: sectionize(toBlocks(tree), documentEnd(tree)),
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
