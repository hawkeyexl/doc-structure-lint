/**
 * The XML parser.
 *
 * The parser is imported directly rather than through the registry, so a
 * failure here is this parser's and not the registry's - routing has its own
 * tests.
 */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseXml, xmlParser, XML_VOCABULARIES } from "../../src/parsers/xml.js";
import type { XmlVocabulary } from "../../src/parsers/xml.js";
import { validateDocument } from "../../src/core/validator.js";
import { loadTemplate } from "../../src/core/template-registry.js";
import { MooseLintError } from "../../src/types.js";
import type { SectionNode } from "../../src/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "..", "fixtures", "formats");

const parse = (xml: string, file = "test.xml") => xmlParser.parse(xml, file);

/** Depth-first section lookup by title. */
function find(sections: SectionNode[], title: string): SectionNode | undefined {
  for (const section of sections) {
    if (section.title === title) return section;
    const nested = find(section.sections, title);
    if (nested) return nested;
  }
  return undefined;
}

/** `title@level` for every section, depth-first, for shape comparisons. */
function outline(sections: SectionNode[]): string[] {
  return sections.flatMap((s) => [`${s.title}@${s.level}`, ...outline(s.sections)]);
}

/**
 * The same page in both built-in vocabularies. DITA nests `<topic>`/`<section>`
 * and writes prose in `<p>`; DocBook nests `<chapter>`/`<section>` and writes
 * it in `<para>`. Nothing downstream should be able to tell.
 */
const DITA_DOC = `<?xml version="1.0"?>
<topic id="guide" type="how-to">
  <title>Guide</title>
  <body>
    <p>Lead prose.</p>
    <section>
      <title>Setup</title>
      <p>Setup prose.</p>
      <codeblock outputclass="language-bash">npm install</codeblock>
      <ul>
        <li>one</li>
        <li>two</li>
      </ul>
    </section>
  </body>
  <topic id="usage">
    <title>Usage</title>
    <body>
      <p>Usage prose.</p>
      <topic id="advanced">
        <title>Advanced</title>
        <body><p>Deeper still.</p></body>
      </topic>
    </body>
  </topic>
</topic>
`;

const DOCBOOK_DOC = `<?xml version="1.0"?>
<chapter xmlns="http://docbook.org/ns/docbook" version="5.0" type="how-to">
  <title>Guide</title>
  <para>Lead prose.</para>
  <section>
    <title>Setup</title>
    <para>Setup prose.</para>
    <programlisting language="bash">npm install</programlisting>
    <itemizedlist>
      <listitem>one</listitem>
      <listitem>two</listitem>
    </itemizedlist>
  </section>
  <section>
    <title>Usage</title>
    <para>Usage prose.</para>
    <section>
      <title>Advanced</title>
      <para>Deeper still.</para>
    </section>
  </section>
</chapter>
`;

describe("xml parser: vocabularies", () => {
  it("builds the same tree shape from DITA and DocBook", () => {
    const dita = outline(parse(DITA_DOC).sections);
    const docbook = outline(parse(DOCBOOK_DOC, "test.docbook.xml").sections);
    expect(dita).toEqual([
      "Guide@1",
      "Setup@2",
      "Usage@2",
      "Advanced@3",
    ]);
    expect(docbook).toEqual(dita);
  });

  it("maps both vocabularies onto the same content kinds", () => {
    for (const doc of [DITA_DOC, DOCBOOK_DOC]) {
      const setup = find(parse(doc).sections, "Setup")!;
      expect(setup.content.map((n) => n.kind)).toEqual([
        "paragraph",
        "code",
        "list",
      ]);
    }
  });

  it("recognizes DocBook by namespace even when the root name is shared", () => {
    // `<section>` is a root in both built-ins, so only the namespace separates
    // them - and `<para>` would too, if the namespace were absent.
    const xml = `<section xmlns="http://docbook.org/ns/docbook">
  <title>Only</title>
  <para>Prose.</para>
</section>`;
    const tree = parse(xml);
    expect(tree.sections[0]!.content.map((n) => n.kind)).toEqual(["paragraph"]);
  });

  it("lets one exclusive content element outweigh a root-name match", () => {
    // `<section>` is a DocBook root, but `<p>` is DITA's alone. Reading this as
    // DocBook would leave `<p>` unmapped and silently skip it, producing a
    // titled section with no content and no complaint.
    const xml = `<section>
  <title>Only</title>
  <p>Prose.</p>
</section>`;
    const tree = parse(xml);
    expect(tree.sections[0]!.content.map((n) => n.kind)).toEqual(["paragraph"]);
  });

  it("reads a bespoke schema from a caller-supplied vocabulary", () => {
    const acme: XmlVocabulary = {
      name: "acme",
      label: "Acme Docs",
      namespaces: ["https://acme.example/docs"],
      roots: ["manual"],
      sections: ["manual", "chapter"],
      titles: ["heading"],
      titleWrappers: [],
      transparent: ["content"],
      paragraphs: ["text"],
      code: ["sample"],
      codeLangAttributes: ["lang"],
      unorderedLists: ["bullets"],
      orderedLists: ["numbered"],
      listItems: ["item"],
    };
    const xml = `<manual xmlns="https://acme.example/docs">
  <heading>Manual</heading>
  <content>
    <chapter>
      <heading>First</heading>
      <text>Prose.</text>
      <sample lang="go">println()</sample>
    </chapter>
  </content>
</manual>`;
    const tree = parseXml(xml, "acme.xml", [acme]);
    expect(outline(tree.sections)).toEqual(["Manual@1", "First@2"]);
    const first = find(tree.sections, "First")!;
    expect(first.content.map((n) => n.kind)).toEqual(["paragraph", "code"]);
    expect(first.content[1]).toMatchObject({ kind: "code", lang: "go" });
  });

  it("ships DITA and DocBook as the built-ins", () => {
    expect(XML_VOCABULARIES.map((v) => v.name)).toEqual(["dita", "docbook"]);
  });
});

describe("xml parser: nesting and the fold", () => {
  it("turns element nesting into heading level", () => {
    const tree = parse(DITA_DOC);
    expect(tree.sections.map((s) => s.title)).toEqual(["Guide"]);
    expect(find(tree.sections, "Guide")!.level).toBe(1);
    expect(find(tree.sections, "Setup")!.level).toBe(2);
    expect(find(tree.sections, "Advanced")!.level).toBe(3);
  });

  it("records order and parentSlug from the fold", () => {
    const tree = parse(DITA_DOC);
    expect(tree.sections[0]!.parentSlug).toBeNull();
    const setup = find(tree.sections, "Setup")!;
    const usage = find(tree.sections, "Usage")!;
    expect(setup.order).toBe(1);
    expect(usage.order).toBe(2);
    expect(usage.parentSlug).toBe("guide");
    expect(find(tree.sections, "Advanced")!.parentSlug).toBe("usage");
  });

  it("does not count transparent wrappers as levels", () => {
    // `<body>` wraps the section but is not one; `Setup` is a child of `Guide`,
    // not a grandchild.
    expect(find(parse(DITA_DOC).sections, "Setup")!.parentSlug).toBe("guide");
  });

  it("treats a section container with no title as transparent", () => {
    // An untitled DITA <section> is legal. It adds no heading, so it adds no
    // level either, and its content belongs to the section around it.
    const xml = `<topic>
  <title>Only</title>
  <body>
    <section>
      <p>Untitled prose.</p>
    </section>
    <p>Sibling prose.</p>
  </body>
</topic>`;
    const tree = parse(xml);
    expect(outline(tree.sections)).toEqual(["Only@1"]);
    expect(tree.sections[0]!.content.map((n) => n.kind)).toEqual([
      "paragraph",
      "paragraph",
    ]);
  });

  it("clamps levels at 6", () => {
    const deep = (depth: number): string =>
      depth === 0
        ? "<p>bottom</p>"
        : `<topic><title>L${depth}</title>${deep(depth - 1)}</topic>`;
    const tree = parse(deep(9));
    const levels: number[] = [];
    const walk = (sections: SectionNode[]): void => {
      for (const s of sections) {
        levels.push(s.level);
        walk(s.sections);
      }
    };
    walk(tree.sections);
    expect(Math.max(...levels)).toBe(6);
    expect(levels.length).toBe(9);
  });

  it("puts the title first, so no implicit lead section is opened", () => {
    const tree = parse(DITA_DOC);
    expect(tree.sections[0]!.level).toBe(1);
    expect(tree.sections[0]!.headingPosition).not.toBeNull();
  });
});

describe("xml parser: content", () => {
  it("skips unmapped elements together with their subtree", () => {
    // A DITA <note> is an admonition, not a paragraph; counting the <p> inside
    // it would be the mistake the Markdown parser avoids with blockquotes.
    const xml = `<topic>
  <title>Only</title>
  <body>
    <p>Real prose.</p>
    <note><p>Not prose.</p></note>
    <table><tgroup><tbody><row><entry><p>Nor this.</p></entry></row></tbody></tgroup></table>
  </body>
</topic>`;
    const content = parse(xml).sections[0]!.content;
    expect(content.map((n) => n.kind)).toEqual(["paragraph"]);
    expect(content[0]!.text).toBe("Real prose.");
  });

  it("distinguishes ordered from unordered lists", () => {
    const xml = `<topic>
  <title>Only</title>
  <body>
    <ul><li>a</li></ul>
    <ol><li>b</li></ol>
    <steps><step><cmd>c</cmd></step></steps>
  </body>
</topic>`;
    const lists = parse(xml).sections[0]!.content;
    expect(lists.map((n) => (n as { ordered: boolean }).ordered)).toEqual([
      false,
      true,
      true,
    ]);
  });

  it("gives list items their own content, so item rules can run", () => {
    const xml = `<topic>
  <title>Only</title>
  <body>
    <ol>
      <li>
        <p>Run it.</p>
        <codeblock outputclass="language-bash">ls</codeblock>
      </li>
    </ol>
  </body>
</topic>`;
    const list = parse(xml).sections[0]!.content[0] as {
      items: { text: string; children: { kind: string }[] }[];
    };
    expect(list.items).toHaveLength(1);
    expect(list.items[0]!.children.map((c) => c.kind)).toEqual([
      "paragraph",
      "code",
    ]);
    expect(list.items[0]!.text).toBe("Run it. ls");
  });

  it("keeps a code block's language and its text verbatim", () => {
    const xml = `<topic>
  <title>Only</title>
  <body>
    <codeblock outputclass="language-bash">
      one
        two
    </codeblock>
  </body>
</topic>`;
    const code = parse(xml).sections[0]!.content[0] as {
      kind: string;
      lang?: string;
      text: string;
    };
    expect(code.kind).toBe("code");
    // `outputclass="language-bash"` is the DITA spelling of a fence's info string.
    expect(code.lang).toBe("bash");
    expect(code.text).toBe("      one\n        two");
  });

  it("flattens inline markup in a title", () => {
    const xml = `<topic><title>Use the <codeph>lint</codeph> command</title><body><p>x</p></body></topic>`;
    const tree = parse(xml);
    expect(tree.sections[0]!.title).toBe("Use the lint command");
    expect(tree.sections[0]!.slug).toBe("use-the-lint-command");
  });

  it("finds a DocBook title inside <info>", () => {
    const xml = `<article xmlns="http://docbook.org/ns/docbook">
  <info><title>Wrapped</title></info>
  <para>Prose.</para>
</article>`;
    const tree = parse(xml);
    expect(tree.sections[0]!.title).toBe("Wrapped");
    // <info> itself is metadata, so nothing inside it becomes content.
    expect(tree.sections[0]!.content.map((n) => n.kind)).toEqual(["paragraph"]);
  });
});

describe("xml parser: positions", () => {
  const xml = [
    `<?xml version="1.0"?>`, //          line 1
    `<topic>`, //                        line 2
    `  <title>Only</title>`, //          line 3
    `  <body>`, //                       line 4
    `    <p>Prose.</p>`, //              line 5
    `  </body>`, //                      line 6
    `</topic>`, //                       line 7
    ``,
  ].join("\n");

  it("reports 1-based line and column with a 0-based offset", () => {
    const tree = parse(xml);
    const para = tree.sections[0]!.content[0]!;
    expect(para.position.start).toEqual({ line: 5, column: 5, offset: 65 });
    expect(xml.slice(para.position.start.offset)).toMatch(/^<p>Prose\.<\/p>/);
  });

  it("ends a block exclusively, right after its closing tag", () => {
    const tree = parse(xml);
    const para = tree.sections[0]!.content[0]!;
    expect(xml.slice(para.position.start.offset, para.position.end.offset)).toBe(
      "<p>Prose.</p>",
    );
  });

  it("spans a heading from its container's start tag through its title", () => {
    const tree = parse(xml);
    const heading = tree.sections[0]!.headingPosition!;
    expect(xml.slice(heading.start.offset, heading.end.offset)).toBe(
      "<topic>\n  <title>Only</title>",
    );
  });

  it("ends the last section at the end of the document", () => {
    const tree = parse(xml);
    expect(tree.sections[0]!.position.end.offset).toBe(xml.length);
  });

  it("keeps offsets pointing into the file when it uses CRLF", () => {
    const crlf = xml.replace(/\n/g, "\r\n");
    const para = parse(crlf).sections[0]!.content[0]!;
    expect(crlf.slice(para.position.start.offset)).toMatch(/^<p>Prose\.<\/p>/);
  });

  it("keeps offsets pointing into the file when it starts with a BOM", () => {
    const bom = `﻿${xml}`;
    const para = parse(bom).sections[0]!.content[0]!;
    expect(bom.slice(para.position.start.offset)).toMatch(/^<p>Prose\.<\/p>/);
  });
});

describe("xml parser: metadata", () => {
  it("reads the doctype from the root element's attributes", () => {
    const tree = parse(DITA_DOC);
    expect(tree.frontmatter).toMatchObject({ id: "guide", type: "how-to" });
  });

  it("drops namespace declarations from the metadata", () => {
    const tree = parse(DOCBOOK_DOC, "test.docbook.xml");
    expect(Object.keys(tree.frontmatter ?? {})).not.toContain("xmlns");
    expect(tree.frontmatter).toMatchObject({ type: "how-to" });
  });

  it("anchors frontmatterPosition on the root element's start tag", () => {
    const xml = `<topic id="a" type="how-to">\n  <title>Only</title>\n</topic>\n`;
    const pos = parse(xml).frontmatterPosition!;
    expect(xml.slice(pos.start.offset, pos.end.offset)).toBe(
      `<topic id="a" type="how-to">`,
    );
  });
});

describe("xml parser: failure modes", () => {
  it("raises MooseLintError naming the file for malformed XML", () => {
    expect(() => parse("<topic><title>T</topic>", "broken.xml")).toThrow(
      MooseLintError,
    );
    expect(() => parse("<topic><title>T</topic>", "broken.xml")).toThrow(
      /broken\.xml: could not parse as XML/,
    );
  });

  it("raises for an unclosed root element", () => {
    expect(() => parse("<topic><title>T</title>", "unclosed.xml")).toThrow(
      MooseLintError,
    );
  });

  it("raises for content that is not XML at all", () => {
    expect(() => parse("just some prose", "prose.xml")).toThrow(MooseLintError);
  });

  it("raises on an error xmldom recovered from by guessing", () => {
    // A stray `<` is level `error`, not `fatalError`: xmldom repairs it and
    // carries on. In XML the element tree *is* the structure, so linting a
    // repaired tree would report on a document nobody wrote.
    expect(() => parse("<topic><title>a &lt; b</title><p>x < y</p></topic>")).toThrow(
      MooseLintError,
    );
  });

  it("tolerates a warning xmldom recovers from without changing the tree", () => {
    // An unquoted attribute value is a `warning`: the element tree is intact,
    // and attributes here are metadata, not structure.
    const tree = parse(`<topic id=guide><title>Only</title><body><p>x</p></body></topic>`);
    expect(tree.sections.map((s) => s.title)).toEqual(["Only"]);
  });

  it("names the gap when no vocabulary recognizes the document", () => {
    const xml = `<invoice><customer>Acme</customer><total>10</total></invoice>`;
    expect(() => parse(xml, "invoice.xml")).toThrow(MooseLintError);
    expect(() => parse(xml, "invoice.xml")).toThrow(
      /invoice\.xml: no known XML vocabulary matched <invoice>.*DITA, DocBook.*XML_VOCABULARIES/s,
    );
  });

  it("names the gap when a vocabulary matches but nothing is titled", () => {
    // A ditamap is recognizably DITA-ish but holds no titled section element,
    // so there is no structure to check - and saying that beats returning an
    // empty tree that lints as "missing every section".
    const xml = `<map><title>Nav</title><topicref href="a.dita"/></map>`;
    expect(() => parse(xml, "nav.xml")).toThrow(
      /nav\.xml: read as DITA, but no titled section was found/,
    );
  });
});

describe("xml parser: registry shape", () => {
  it("declares itself as an implemented .xml parser", () => {
    expect(xmlParser.name).toBe("xml");
    expect(xmlParser.label).toBe("XML");
    expect(xmlParser.implemented).toBe(true);
    // `.dita` too: that is what a DITA topic is called on disk, and a docset of
    // them would otherwise be walked past. `.ditamap` is deliberately absent —
    // a map has no titled section, so every map would report as unparseable.
    expect(xmlParser.extensions).toEqual([".xml", ".dita"]);
    expect(xmlParser.extensions).not.toContain(".ditamap");
  });

  it("reports its own format on the tree", () => {
    expect(parse(DITA_DOC).format).toBe("xml");
  });
});

/**
 * The payoff: the same built-in template that checks a Markdown page checks a
 * DITA page, and says the same thing about it.
 */
describe("xml parser: tgdp:how-to:1.6", () => {
  it("lints the conforming fixture clean", async () => {
    const file = join(fixtures, "how-to.xml");
    const tree = xmlParser.parse(await readFile(file, "utf8"), file);
    const findings = validateDocument(tree, await loadTemplate("tgdp:how-to:1.6"));
    expect(findings.map((f) => `[${f.type}] ${f.message}`)).toEqual([]);
  });

  it("routes on the type declared as a root attribute", async () => {
    const file = join(fixtures, "how-to.xml");
    const tree = xmlParser.parse(await readFile(file, "utf8"), file);
    expect(tree.frontmatter).toMatchObject({ type: "how-to" });
  });

  it("reports exactly the one defect in the broken fixture", async () => {
    const file = join(fixtures, "how-to-broken.xml");
    const tree = xmlParser.parse(await readFile(file, "utf8"), file);
    const findings = validateDocument(tree, await loadTemplate("tgdp:how-to:1.6"));
    expect(findings).toHaveLength(1);
    expect(findings[0]!.type).toBe("missing_section");
    expect(findings[0]!.message).toBe('Missing section "See also"');
  });

  it("matches its Markdown twin's outline section for section", async () => {
    const file = join(fixtures, "how-to.xml");
    const tree = xmlParser.parse(await readFile(file, "utf8"), file);
    expect(outline(tree.sections)).toEqual([
      "Rotate an API key@1",
      "Overview@2",
      "Before you start@2",
      "Rotate the key@2",
      "See also@2",
    ]);
  });
});
