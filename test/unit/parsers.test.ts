import { describe, expect, it } from "vitest";
import { markdownParser, mdxParser } from "../../src/parsers/markdown.js";
import {
  listFormats,
  parserByName,
  parserForExtension,
  supportedExtensions,
} from "../../src/parsers/index.js";
import { MooseLintError } from "../../src/types.js";
import type { SectionNode } from "../../src/types.js";

const parse = (md: string) => markdownParser.parse(md, "test.md");

/** Depth-first section lookup by title, for asserting on nested trees. */
function find(sections: SectionNode[], title: string): SectionNode | undefined {
  for (const section of sections) {
    if (section.title === title) return section;
    const nested = find(section.sections, title);
    if (nested) return nested;
  }
  return undefined;
}

describe("markdown parser", () => {
  it("nests sections by heading depth", () => {
    const tree = parse("# A\n\n## B\n\ntext\n\n### C\n\n## D\n");
    expect(tree.sections.map((s) => s.title)).toEqual(["A"]);
    expect(tree.sections[0]!.sections.map((s) => s.title)).toEqual(["B", "D"]);
    expect(find(tree.sections, "B")!.sections.map((s) => s.title)).toEqual(["C"]);
  });

  it("records order and parentSlug", () => {
    const tree = parse("# A\n\n## B\n\n## D\n");
    const d = find(tree.sections, "D")!;
    expect(d.order).toBe(2);
    expect(d.parentSlug).toBe("a");
    expect(tree.sections[0]!.parentSlug).toBeNull();
  });

  it("disambiguates repeated headings in slugs", () => {
    const tree = parse("# Install\n\n# Install\n");
    expect(tree.sections.map((s) => s.slug)).toEqual(["install", "install-1"]);
  });

  // The pre-rewrite parser joined `child.value` across heading children, which
  // is undefined for anything but a text node, so inline markup vanished.
  it("flattens inline markup in a heading title", () => {
    const tree = parse("# Use the `lint` *command*\n");
    expect(tree.sections[0]!.title).toBe("Use the lint command");
    expect(tree.sections[0]!.slug).toBe("use-the-lint-command");
  });

  it("ends a section where the next sibling heading begins, not at its last child", () => {
    const md = "# A\n\npara\n\n\n\n# B\n";
    const tree = parse(md);
    const a = tree.sections[0]!;
    const b = tree.sections[1]!;
    expect(a.position.end.offset).toBe(b.position.start.offset);
    // The last child ends well before the section does.
    expect(a.content[0]!.position.end.offset).toBeLessThan(a.position.end.offset);
  });

  it("ends the final section at the end of the document", () => {
    const md = "# A\n\npara\n";
    const tree = parse(md);
    expect(tree.sections[0]!.position.end.offset).toBe(md.length);
  });

  it("classifies content into generic kinds, in document order", () => {
    const tree = parse("# A\n\npara\n\n```js\ncode\n```\n\n- one\n- two\n");
    expect(tree.sections[0]!.content.map((n) => n.kind)).toEqual([
      "paragraph",
      "code",
      "list",
    ]);
  });

  it("keeps code language and list ordering", () => {
    const tree = parse("# A\n\n```bash\nls\n```\n\n1. one\n2. two\n");
    const [code, list] = tree.sections[0]!.content;
    expect(code).toMatchObject({ kind: "code", lang: "bash", text: "ls" });
    expect(list).toMatchObject({ kind: "list", ordered: true });
    expect((list as { items: unknown[] }).items).toHaveLength(2);
  });

  it("nests content inside list items so item rules can run", () => {
    const tree = parse("# A\n\n- item text\n\n  ```js\n  x\n  ```\n");
    const list = tree.sections[0]!.content[0] as { items: { children: { kind: string }[] }[] };
    expect(list.items[0]!.children.map((c) => c.kind)).toEqual(["paragraph", "code"]);
  });

  // A blockquote is not a paragraph and a table is not a list; counting them as
  // one would make `paragraphs: {max: N}` fail documents that satisfy it.
  it("ignores block types the DSL does not describe", () => {
    const tree = parse("# A\n\n> quoted\n\n---\n\n| a | b |\n| - | - |\n| 1 | 2 |\n");
    expect(tree.sections[0]!.content).toHaveLength(0);
  });

  it("puts content before any heading in an implicit lead section", () => {
    const tree = parse("intro prose\n\n## Prerequisites\n\nmore\n");
    const lead = tree.sections[0]!;
    expect(lead.level).toBe(0);
    expect(lead.headingPosition).toBeNull();
    expect(lead.content).toHaveLength(1);
    // Later headings nest under the lead rather than closing it.
    expect(lead.sections.map((s) => s.title)).toEqual(["Prerequisites"]);
  });

  it("reads frontmatter values and locates the block", () => {
    const tree = parse("---\ntype: how-to\ntags:\n  - a\n  - b\n---\n\n# A\n");
    expect(tree.frontmatter).toEqual({ type: "how-to", tags: ["a", "b"] });
    expect(tree.frontmatterPosition?.start.line).toBe(1);
    // The old line-splitting parser produced the string "- a\n- b" here.
    expect(Array.isArray(tree.frontmatter!.tags)).toBe(true);
  });

  it("reports no frontmatter when there is none", () => {
    const tree = parse("# A\n");
    expect(tree.frontmatter).toBeNull();
    expect(tree.frontmatterPosition).toBeNull();
  });

  it("excludes the frontmatter block from section content", () => {
    const tree = parse("---\ntype: how-to\n---\n\n# A\n\npara\n");
    expect(tree.sections[0]!.content.map((n) => n.kind)).toEqual(["paragraph"]);
  });
});

describe("mdx parser", () => {
  it("parses MDX expressions that plain Markdown would not", () => {
    const tree = mdxParser.parse("# A\n\n<Note>hi</Note>\n", "test.mdx");
    expect(tree.format).toBe("mdx");
    expect(tree.sections[0]!.title).toBe("A");
  });

  // remark-mdx reads `{` as an expression delimiter, so the two formats need
  // separate processors selected by extension.
  it("leaves a literal brace alone in Markdown", () => {
    const tree = parse("# A\n\nUse {placeholder} here.\n");
    expect(tree.sections[0]!.content[0]!.text).toBe("Use {placeholder} here.");
  });

  it("reports a malformed MDX file as an operational error naming the file", () => {
    expect(() => mdxParser.parse("# A\n\n{unclosed\n", "broken.mdx")).toThrow(
      MooseLintError,
    );
  });
});

describe("parser registry", () => {
  it("resolves implemented parsers by extension, case-insensitively", () => {
    expect(parserForExtension(".md")?.name).toBe("markdown");
    expect(parserForExtension(".MDX")?.name).toBe("mdx");
  });

  it("resolves parsers by name for --as", () => {
    expect(parserByName("markdown")?.name).toBe("markdown");
    expect(parserByName("nope")).toBeUndefined();
  });

  it("walks directories using only implemented formats", () => {
    const exts = supportedExtensions();
    expect(exts).toEqual(expect.arrayContaining([".md", ".markdown", ".mdx"]));
    expect(exts).not.toContain(".rst");
  });

  // Registering an unimplemented format is what turns a silent mis-parse into a
  // named gap: the old `inferFileType` defaulted every unknown extension to
  // Markdown.
  it("registers roadmap formats and reports them as not implemented", () => {
    const rst = parserForExtension(".rst");
    expect(rst?.implemented).toBe(false);
    expect(() => rst!.parse("Title\n=====\n", "a.rst")).toThrow(
      /reStructuredText is not implemented yet/,
    );
  });

  it("lists every format with its implementation status", () => {
    const formats = listFormats();
    expect(formats.map((f) => f.name)).toEqual([
      "markdown",
      "mdx",
      "asciidoc",
      "rst",
      "html",
      "xml",
    ]);
    expect(formats.filter((f) => f.implemented).map((f) => f.name)).toEqual([
      "markdown",
      "mdx",
    ]);
  });
});
