/**
 * The AsciiDoc parser.
 *
 * Two things get most of the attention here. Positions, because Asciidoctor
 * reports line numbers and nothing else - no columns, no offsets, no end of a
 * block - and the pre-rewrite `parsers/asciidoc.js` papered over that by
 * rebuilding a `== Title` marker and running `content.indexOf()` on it, which
 * lands on the wrong occurrence for a repeated heading and misses entirely when
 * a heading carries an attribute line. And metadata, because AsciiDoc's native
 * header is how a real page says `:type: how-to`, so routing depends on it.
 *
 * The fixtures at the bottom are the point of the exercise: the same document,
 * written in AsciiDoc, has to produce the same findings as its Markdown twin.
 */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { asciidocParser } from "../../src/parsers/asciidoc.js";
import { validateDocument } from "../../src/core/validator.js";
import { loadTemplate } from "../../src/core/template-registry.js";
import { MooseLintError } from "../../src/types.js";
import type { ListNode, SectionNode } from "../../src/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "..", "fixtures", "formats");

const parse = (adoc: string) => asciidocParser.parse(adoc, "test.adoc");

/** Depth-first section lookup by title, for asserting on nested trees. */
function find(sections: SectionNode[], title: string): SectionNode | undefined {
  for (const section of sections) {
    if (section.title === title) return section;
    const nested = find(section.sections, title);
    if (nested) return nested;
  }
  return undefined;
}

/** Findings as one readable line each, so a failure names what went wrong. */
async function lint(file: string): Promise<string[]> {
  const path = join(fixtures, file);
  const tree = asciidocParser.parse(await readFile(path, "utf8"), path);
  const findings = validateDocument(tree, await loadTemplate("tgdp:how-to:1.6"));
  return findings.map((f) => `${f.position.start.line}: [${f.type}] ${f.message}`);
}

describe("asciidoc parser", () => {
  it("registers itself for the AsciiDoc extensions", () => {
    expect(asciidocParser).toMatchObject({
      name: "asciidoc",
      label: "AsciiDoc",
      implemented: true,
    });
    expect(asciidocParser.extensions).toEqual([".adoc", ".asciidoc"]);
  });

  // Asciidoctor's `=` title is level 0 and lives on the document rather than in
  // the block tree, so both the offset and the promotion have to be undone.
  it("nests sections by level, with the document title as the H1", () => {
    const tree = parse("= A\n\n== B\n\ntext\n\n=== C\n\n== D\n");
    expect(tree.format).toBe("asciidoc");
    expect(tree.sections.map((s) => s.title)).toEqual(["A"]);
    expect(tree.sections[0]!.level).toBe(1);
    expect(tree.sections[0]!.sections.map((s) => s.title)).toEqual(["B", "D"]);
    expect(find(tree.sections, "B")!.level).toBe(2);
    expect(find(tree.sections, "B")!.sections.map((s) => s.title)).toEqual(["C"]);
    expect(find(tree.sections, "C")!.level).toBe(3);
  });

  it("records order and parentSlug", () => {
    const tree = parse("= A\n\n== B\n\n== D\n");
    const d = find(tree.sections, "D")!;
    expect(d.order).toBe(2);
    expect(d.parentSlug).toBe("a");
    expect(tree.sections[0]!.order).toBe(1);
    expect(tree.sections[0]!.parentSlug).toBeNull();
  });

  // Asciidoctor hands back titles as inline HTML, so flattening them is what
  // makes `heading: {const: "..."}` mean the same thing it does in Markdown.
  it("flattens inline markup in a heading title", () => {
    const tree = parse("= T\n\n== Use the `lint` *command*\n");
    const section = tree.sections[0]!.sections[0]!;
    expect(section.title).toBe("Use the lint command");
    expect(section.slug).toBe("use-the-lint-command");
  });

  it("puts the preamble under a document title into the title's own content", () => {
    const tree = parse("= A\n\nLead prose.\n\n== B\n\nmore\n");
    expect(tree.sections[0]!.content.map((n) => n.kind)).toEqual(["paragraph"]);
    expect(tree.sections[0]!.content[0]!.text).toBe("Lead prose.");
    expect(tree.sections[0]!.sections.map((s) => s.title)).toEqual(["B"]);
  });
});

describe("content kinds", () => {
  it("classifies content generically, in document order", () => {
    const tree = parse(
      "= A\n\n== B\n\npara\n\n[source,js]\n----\ncode\n----\n\n* one\n* two\n",
    );
    expect(find(tree.sections, "B")!.content.map((n) => n.kind)).toEqual([
      "paragraph",
      "code",
      "list",
    ]);
  });

  it("carries a listing's language and its unconverted source", () => {
    const tree = parse("= A\n\n[source,bash]\n----\nls -l && echo 'a < b'\n----\n");
    expect(tree.sections[0]!.content[0]).toMatchObject({
      kind: "code",
      lang: "bash",
      text: "ls -l && echo 'a < b'",
    });
  });

  it("reads an unlabelled listing and a literal block as code with no language", () => {
    const tree = parse("= A\n\n----\nplain\n----\n\n....\nliteral\n....\n");
    const content = tree.sections[0]!.content;
    expect(content.map((n) => n.kind)).toEqual(["code", "code"]);
    expect(content[0]).not.toHaveProperty("lang");
    expect(content[1]).not.toHaveProperty("lang");
  });

  it("distinguishes ordered from unordered lists", () => {
    // In separate sections deliberately: two adjacent lists with different
    // markers are one nested list to AsciiDoc, not two siblings.
    const tree = parse("= A\n\n== U\n\n* one\n* two\n\n== O\n\n. first\n. second\n. third\n");
    const unordered = find(tree.sections, "U")!.content[0] as ListNode;
    const ordered = find(tree.sections, "O")!.content[0] as ListNode;
    expect(unordered).toMatchObject({ kind: "list", ordered: false });
    expect(unordered.items.map((i) => i.text)).toEqual(["one", "two"]);
    expect(ordered).toMatchObject({ kind: "list", ordered: true });
    expect(ordered.items).toHaveLength(3);
  });

  // An item's principal text is not one of its blocks in Asciidoctor, but it is
  // a paragraph child in mdast - so `lists: {items: {paragraphs: ...}}` only
  // counts the same thing in both formats because the parser puts it there.
  it("nests an item's own text and its attached blocks so item rules can run", () => {
    const tree = parse("= A\n\n* item text\n+\n[source,js]\n----\nx\n----\n");
    const list = tree.sections[0]!.content[0] as ListNode;
    expect(list.items[0]!.children.map((c) => c.kind)).toEqual([
      "paragraph",
      "code",
    ]);
    expect(list.items[0]!.children[0]!.text).toBe("item text");
  });

  it("nests a list inside the item that carries it", () => {
    const tree = parse("= A\n\n* outer\n. inner one\n. inner two\n");
    const list = tree.sections[0]!.content[0] as ListNode;
    const nested = list.items[0]!.children[1] as ListNode;
    expect(list.items).toHaveLength(1);
    expect(nested).toMatchObject({ kind: "list", ordered: true });
    expect(nested.items.map((i) => i.text)).toEqual(["inner one", "inner two"]);
    expect(nested.position.start.line).toBe(4);
  });

  // An admonition is not a paragraph and a table is not a list; counting them
  // as one would make `paragraphs: {max: N}` fail documents that satisfy it.
  // Skipping is whole-subtree, so an admonition's own paragraph is gone too.
  it("skips block types the content model does not describe", () => {
    const tree = parse(
      [
        "= A",
        "",
        "NOTE: an admonition",
        "",
        "|===",
        "| a | b",
        "|===",
        "",
        "****",
        "a sidebar",
        "****",
        "",
        "term:: definition",
        "",
        "'''",
        "",
      ].join("\n"),
    );
    expect(tree.sections[0]!.content).toEqual([]);
  });
});

describe("positions", () => {
  it("anchors a section on its own source line", () => {
    const adoc = "= A\n\n== B\n\npara\n\n== C\n\npara\n";
    const tree = parse(adoc);
    const b = find(tree.sections, "B")!;
    expect(b.headingPosition!.start.line).toBe(3);
    expect(b.headingPosition!.start.column).toBe(1);
    expect(b.headingPosition!.start.offset).toBe(adoc.indexOf("== B"));
    // The heading spans its own line, the way an mdast heading spans its `#`.
    expect(b.headingPosition!.end.offset).toBe(adoc.indexOf("== B") + "== B".length);
  });

  it("ends a section where the next sibling begins", () => {
    const adoc = "= A\n\n== B\n\npara\n\n\n\n== C\n\npara\n";
    const tree = parse(adoc);
    const [b, c] = tree.sections[0]!.sections;
    expect(b!.position.end.offset).toBe(c!.position.start.offset);
    expect(c!.position.start.offset).toBe(adoc.indexOf("== C"));
    // The span covers the blank lines a reader would call part of the section.
    expect(b!.content[0]!.position.start.offset).toBeLessThan(b!.position.end.offset);
  });

  it("ends the final section at the end of the document", () => {
    const adoc = "= A\n\n== B\n\npara\n";
    const tree = parse(adoc);
    expect(find(tree.sections, "B")!.position.end.offset).toBe(adoc.length);
    expect(tree.sections[0]!.position.end.offset).toBe(adoc.length);
  });

  // The pre-rewrite parser recovered offsets with `content.indexOf("== Setup")`,
  // which returns the first occurrence whichever section is being placed.
  it("places repeated headings independently", () => {
    const adoc = "= A\n\n== Setup\n\none\n\n== Setup\n\ntwo\n";
    const tree = parse(adoc);
    const [first, second] = tree.sections[0]!.sections;
    expect(first!.headingPosition!.start.line).toBe(3);
    expect(second!.headingPosition!.start.line).toBe(7);
    expect(second!.headingPosition!.start.offset).toBe(adoc.lastIndexOf("== Setup"));
    expect(tree.sections[0]!.sections.map((s) => s.slug)).toEqual([
      "setup",
      "setup-1",
    ]);
  });

  // ...and a heading carrying an id line is not written the way the
  // reconstructed marker assumed, so it never matched at all.
  it("places a heading that carries a block attribute line", () => {
    const adoc = "= A\n\n[#setup]\n== Setup\n\none\n";
    const tree = parse(adoc);
    const setup = tree.sections[0]!.sections[0]!;
    expect(setup.headingPosition!.start.line).toBe(4);
    expect(setup.headingPosition!.start.offset).toBe(adoc.indexOf("== Setup"));
  });

  it("gives content nodes spans that tile the section in document order", () => {
    const adoc = "= A\n\n== B\n\none\n\ntwo\n\n== C\n";
    const tree = parse(adoc);
    const b = find(tree.sections, "B")!;
    const [one, two] = b.content;
    expect(one!.position.start.line).toBe(5);
    expect(two!.position.start.line).toBe(7);
    expect(one!.position.end.offset).toBe(two!.position.start.offset);
    expect(two!.position.end.offset).toBe(adoc.indexOf("== C"));
  });
});

describe("document metadata", () => {
  // `extractFrontmatter` only ever reads a fenced block, so a parser that
  // called it alone would leave every real AsciiDoc page unrouted.
  it("reads the native header, so a page can declare its doctype", () => {
    const tree = parse("= Rotate a key\n:type: how-to\n:draft: true\n\n== Overview\n");
    expect(tree.frontmatter).toMatchObject({
      type: "how-to",
      draft: true,
      title: "Rotate a key",
    });
    expect(tree.frontmatterPosition).toMatchObject({
      start: { line: 1, column: 1, offset: 0 },
      end: { line: 3 },
    });
  });

  it("keeps header attribute values typed rather than stringly", () => {
    const tree = parse("= T\n:version: 2\n:draft: false\n\n== Overview\n");
    expect(tree.frontmatter).toMatchObject({ version: 2, draft: false });
  });

  it("reads a fenced block, and positions the metadata on it", () => {
    const adoc = "---\ntype: how-to\ntags:\n  - a\n  - b\n---\n\n= T\n\n== Overview\n";
    const tree = parse(adoc);
    expect(tree.frontmatter).toMatchObject({ type: "how-to", tags: ["a", "b"] });
    expect(Array.isArray(tree.frontmatter!["tags"])).toBe(true);
    expect(tree.frontmatterPosition?.start.line).toBe(1);
  });

  // A `---` fence is a thematic break in AsciiDoc. Without `skip-front-matter`
  // the metadata would parse as body content - and the line numbers of
  // everything after it still have to index the original file.
  it("keeps the fence out of the body without shifting line numbers", () => {
    const adoc = "---\ntype: how-to\n---\n\n= T\n\n== Overview\n\npara\n";
    const tree = parse(adoc);
    expect(tree.sections.map((s) => s.title)).toEqual(["T"]);
    expect(tree.sections[0]!.content).toEqual([]);
    expect(tree.sections[0]!.headingPosition!.start.line).toBe(5);
    expect(find(tree.sections, "Overview")!.headingPosition!.start.line).toBe(7);
    expect(find(tree.sections, "Overview")!.content[0]!.position.start.line).toBe(9);
  });

  it("reports no metadata when the file carries none", () => {
    const tree = parse("== Overview\n\nprose\n");
    expect(tree.frontmatter).toBeNull();
    expect(tree.frontmatterPosition).toBeNull();
  });
});

describe("a metadata title standing in for a missing document title", () => {
  it("becomes the top-level section", () => {
    const tree = parse(":title: Rotate an API key\n:type: how-to\n\n== Overview\n\nWhy.\n");
    const root = tree.sections[0]!;
    expect(root.level).toBe(1);
    expect(root.title).toBe("Rotate an API key");
    expect(root.sections.map((s) => s.title)).toEqual(["Overview"]);
  });

  it("is anchored on the header, where the title actually is", () => {
    const tree = parse(":title: A\n\n== Overview\n");
    expect(tree.sections[0]!.headingPosition?.start.line).toBe(1);
    expect(tree.sections[0]!.headingPosition?.start.offset).toBe(0);
  });

  it("does not displace a real document title", () => {
    const tree = parse("= From the body\n:title: From metadata\n\n== Overview\n");
    expect(tree.sections.map((s) => s.title)).toEqual(["From the body"]);
  });

  it("is not synthesized without a title", () => {
    const tree = parse(":type: how-to\n\n== Overview\n");
    expect(tree.sections[0]!.title).toBe("Overview");
    expect(tree.sections[0]!.level).toBe(2);
  });

  it("takes the content before the first heading with it", () => {
    const tree = parse(":title: A\n\nLead prose.\n\n== Overview\n");
    const root = tree.sections[0]!;
    expect(root.content.map((n) => n.kind)).toEqual(["paragraph"]);
    expect(root.sections.map((s) => s.title)).toEqual(["Overview"]);
  });
});

// Asciidoctor recovers from every malformed *document* it was given here - an
// unterminated block warns and carries on - so the guard is what turns a
// refusal by the loader itself into a named operational error rather than a
// stack trace out of Opal.
it("reports input Asciidoctor cannot load as an operational error naming the file", () => {
  const notAString = 42 as unknown as string;
  expect(() => asciidocParser.parse(notAString, "broken.adoc")).toThrow(MooseLintError);
  expect(() => asciidocParser.parse(notAString, "broken.adoc")).toThrow(
    /broken\.adoc: could not parse as asciidoc/,
  );
});

/**
 * The fixtures, end to end. The parser is imported directly rather than through
 * `parserForExtension`, so a failure here is this parser's and not the
 * registry's - routing has its own tests, and a broken registry entry would
 * otherwise fail every parser's suite at once.
 */
describe("the AsciiDoc format fixtures, against tgdp:how-to:1.6", () => {
  it("routes how-to.adoc on the doctype in its header", async () => {
    const path = join(fixtures, "how-to.adoc");
    const tree = asciidocParser.parse(await readFile(path, "utf8"), path);
    expect(tree.frontmatter?.["type"]).toBe("how-to");
  });

  it("lints how-to.adoc clean", async () => {
    expect(await lint("how-to.adoc")).toEqual([]);
  });

  it("reports the one missing section in how-to-broken.adoc", async () => {
    const findings = await lint("how-to-broken.adoc");
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatch(/\[missing_section\].*See also/);
  });
});

describe("asciidoc parser: open blocks", () => {
  // `--` is how an author attaches several blocks to one list item. Skipping it
  // as an unmapped context made a numbered step's whole body invisible to a
  // template - the most likely real-world surprise in this parser.
  const STEP = [
    "= T",
    "",
    "== Steps",
    "",
    ". Do the thing",
    "+",
    "--",
    "Extra prose.",
    "",
    "----",
    "cmd",
    "----",
    "--",
    "",
    "[NOTE]",
    "--",
    "An aside.",
    "--",
    "",
  ].join("\n");

  const steps = () =>
    asciidocParser.parse(STEP, "t.adoc").sections[0]!.sections[0]!;

  it("shows a list item the blocks attached to it", () => {
    const list = steps().content.find((c) => c.kind === "list");
    expect(list).toBeDefined();
    expect(
      (list as { items: { children: { kind: string }[] }[] }).items[0]!.children.map(
        (c) => c.kind,
      ),
    ).toEqual(["paragraph", "paragraph", "code"]);
  });

  // A `--` block turned into a real construct arrives with that construct's own
  // context, so it is skipped by the default branch just as mdast skips a
  // blockquote. Only the bare attach-blocks form still reports `open`.
  it("still skips an admonition built from a -- block", () => {
    expect(steps().content.map((c) => c.kind)).toEqual(["list"]);
  });
});
