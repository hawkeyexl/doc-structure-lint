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
import { extractFrontmatter } from "docmeta";
import type { DocumentParser, DocumentTree } from "../types.js";
import { MooseLintError } from "../types.js";
import { documentEnd, toBlocks } from "./mdast.js";
import { sectionize } from "./sectionize.js";
import { fencedPosition as frontmatterPosition, withMetadataTitle as withFrontmatterTitle } from "./metadata.js";

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
