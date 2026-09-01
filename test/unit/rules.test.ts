import { describe, expect, it } from "vitest";

import { MooseLintError } from "../../src/types.js";
import type {
  CodeNode,
  ContentNode,
  ListItemNode,
  ListNode,
  ParagraphNode,
  Position,
  SectionNode,
} from "../../src/types.js";
import {
  checkCodeBlocks,
  checkHeading,
  checkLists,
  checkParagraphs,
  checkSequence,
  clearPatternCache,
  codeBlocksOf,
  compilePattern,
  groupRuns,
  listsOf,
  paragraphsOf,
} from "../../src/rules/index.js";

/* -------------------------------------------------------------------------- *
 * Fixtures
 *
 * No parser exists yet, so trees are built by hand. Every node gets a distinct
 * line so findings can be traced back to the node that produced them.
 * -------------------------------------------------------------------------- */

const SECTION_LINE = 1;
const HEADING_LINE = 2;

function pos(line: number): Position {
  return {
    start: { line, column: 1, offset: line * 100 },
    end: { line, column: 20, offset: line * 100 + 19 },
  };
}

function paragraph(text: string, line = 10): ParagraphNode {
  return { kind: "paragraph", text, position: pos(line) };
}

function code(text = "npm install", line = 20, lang = "bash"): CodeNode {
  return { kind: "code", text, lang, position: pos(line) };
}

function listItem(
  text: string,
  line = 30,
  children: ContentNode[] = []
): ListItemNode {
  return { text, position: pos(line), children };
}

function list(items: ListItemNode[], line = 30): ListNode {
  return {
    kind: "list",
    ordered: false,
    items,
    text: items.map((item) => item.text).join("\n"),
    position: pos(line),
  };
}

function section(
  content: ContentNode[],
  overrides: Partial<SectionNode> = {}
): SectionNode {
  return {
    slug: "install",
    title: "Install",
    level: 2,
    order: 1,
    parentSlug: null,
    headingPosition: pos(HEADING_LINE),
    position: pos(SECTION_LINE),
    content,
    sections: [],
    ...overrides,
  };
}

/** Messages only, for assertions that care about which rules fired. */
function messages(findings: { message: string }[]): string[] {
  return findings.map((finding) => finding.message);
}

/* -------------------------------------------------------------------------- *
 * Content queries
 * -------------------------------------------------------------------------- */

describe("content queries", () => {
  const mixed: ContentNode[] = [
    paragraph("first", 10),
    code("code", 11),
    list([listItem("item", 12)], 12),
    paragraph("second", 13),
  ];

  it("buckets a flat content array by kind, in document order", () => {
    expect(paragraphsOf(mixed).map((node) => node.text)).toEqual([
      "first",
      "second",
    ]);
    expect(codeBlocksOf(mixed)).toHaveLength(1);
    expect(listsOf(mixed)).toHaveLength(1);
  });

  it("returns empty buckets for empty content", () => {
    expect(paragraphsOf([])).toEqual([]);
    expect(codeBlocksOf([])).toEqual([]);
    expect(listsOf([])).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- *
 * heading
 * -------------------------------------------------------------------------- */

describe("checkHeading", () => {
  it("returns nothing when the template has no heading rule", () => {
    expect(checkHeading(section([]), undefined)).toEqual([]);
  });

  it("reports a title that does not equal const", () => {
    const findings = checkHeading(section([]), { const: "Overview" });

    expect(findings).toEqual([
      {
        type: "heading_const_error",
        heading: "Install",
        message: `Expected title "Overview", but found "Install"`,
        position: pos(HEADING_LINE),
        severity: "error",
      },
    ]);
  });

  it("accepts a title that equals const", () => {
    expect(checkHeading(section([]), { const: "Install" })).toEqual([]);
  });

  it("reports a title that does not match pattern", () => {
    const findings = checkHeading(section([]), { pattern: "^Step \\d+" });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.type).toBe("heading_pattern_error");
    expect(findings[0]?.message).toBe(
      `Title "Install" doesn't match pattern "^Step \\d+"`
    );
  });

  it("accepts a title that matches pattern", () => {
    expect(checkHeading(section([]), { pattern: "^Inst" })).toEqual([]);
  });

  it("reports const and pattern independently", () => {
    const findings = checkHeading(section([]), {
      const: "Overview",
      pattern: "^Step \\d+",
    });

    expect(findings.map((finding) => finding.type)).toEqual([
      "heading_const_error",
      "heading_pattern_error",
    ]);
  });

  it("anchors to the section when there is no heading of its own", () => {
    const lead = section([], { headingPosition: null, title: "" });
    const findings = checkHeading(lead, { const: "Overview" });

    expect(findings[0]?.position).toEqual(pos(SECTION_LINE));
    expect(findings[0]?.heading).toBe("");
  });
});

/* -------------------------------------------------------------------------- *
 * paragraphs
 * -------------------------------------------------------------------------- */

describe("checkParagraphs", () => {
  it("returns nothing when the template has no paragraphs rule", () => {
    expect(checkParagraphs(section([paragraph("one")]), undefined)).toEqual([]);
  });

  it("reports too few paragraphs", () => {
    const findings = checkParagraphs(section([paragraph("one", 10)]), {
      min: 2,
    });

    expect(findings).toEqual([
      {
        type: "paragraphs_count_error",
        heading: "Install",
        message: "Expected at least 2 paragraphs, but found 1",
        position: pos(SECTION_LINE),
        severity: "error",
      },
    ]);
  });

  it("reports too many paragraphs", () => {
    const findings = checkParagraphs(
      section([paragraph("a", 10), paragraph("b", 11), paragraph("c", 12)]),
      { max: 2 }
    );

    expect(messages(findings)).toEqual([
      "Expected at most 2 paragraphs, but found 3",
    ]);
  });

  it("counts only paragraphs, ignoring code and lists", () => {
    const findings = checkParagraphs(
      section([
        paragraph("only one", 10),
        code("npm install", 11),
        list([listItem("item", 12)], 12),
      ]),
      { min: 2 }
    );

    expect(messages(findings)).toEqual([
      "Expected at least 2 paragraphs, but found 1",
    ]);
  });

  it("reports the paragraph that fails its pattern, cycling patterns", () => {
    const findings = checkParagraphs(
      section([
        paragraph("Step 1", 10),
        paragraph("Do the thing", 11),
        paragraph("Step 2", 12),
        paragraph("nope", 13),
      ]),
      { patterns: ["^Step \\d+$", "^Do"] }
    );

    expect(findings).toEqual([
      {
        type: "paragraph_pattern_error",
        heading: "Install",
        message: "Paragraph 4 doesn't match expected pattern.",
        position: pos(13),
        severity: "error",
      },
    ]);
  });

  it("accepts content that satisfies min, max, and patterns", () => {
    const findings = checkParagraphs(
      section([paragraph("Step 1", 10), paragraph("Step 2", 11)]),
      { min: 2, max: 2, patterns: ["^Step \\d+$"] }
    );

    expect(findings).toEqual([]);
  });

  it("reports every violated rule at once, counts before patterns", () => {
    const findings = checkParagraphs(section([paragraph("nope", 10)]), {
      min: 2,
      max: 1,
      patterns: ["^Step \\d+$"],
    });

    expect(messages(findings)).toEqual([
      "Expected at least 2 paragraphs, but found 1",
      "Paragraph 1 doesn't match expected pattern.",
    ]);
  });

  // The JavaScript rules guarded min/max on truthiness, so `max: 0` was a
  // silent no-op and "no paragraphs allowed" was inexpressible. A bound of zero
  // is a bound.
  it("enforces a zero maximum", () => {
    expect(messages(checkParagraphs(section([paragraph("a", 10)]), { max: 0 }))).toEqual([
      "Expected at most 0 paragraphs, but found 1",
    ]);
    expect(checkParagraphs(section([]), { max: 0 })).toEqual([]);
    expect(checkParagraphs(section([]), { min: 0 })).toEqual([]);
  });

  it("treats an uncompilable pattern as a broken template, not a finding", () => {
    expect(() =>
      checkParagraphs(section([paragraph("one")]), { patterns: ["("] })
    ).toThrow(MooseLintError);
    expect(() =>
      checkParagraphs(section([paragraph("one")]), { patterns: ["("] })
    ).toThrow(/Invalid pattern "\("/);
  });
});

/* -------------------------------------------------------------------------- *
 * code blocks
 * -------------------------------------------------------------------------- */

describe("checkCodeBlocks", () => {
  it("returns nothing when the template has no code_blocks rule", () => {
    expect(checkCodeBlocks(section([code()]), undefined)).toEqual([]);
  });

  it("reports too few code blocks", () => {
    const findings = checkCodeBlocks(section([paragraph("prose", 10)]), {
      min: 1,
    });

    expect(findings).toEqual([
      {
        type: "code_blocks_count_error",
        heading: "Install",
        message: "Expected at least 1 code blocks, but found 0",
        position: pos(SECTION_LINE),
        severity: "error",
      },
    ]);
  });

  it("reports too many code blocks", () => {
    const findings = checkCodeBlocks(
      section([code("a", 20), code("b", 21), code("c", 22)]),
      { max: 2 }
    );

    expect(messages(findings)).toEqual([
      "Expected at most 2 code blocks, but found 3",
    ]);
  });

  it("accepts a count inside the range", () => {
    const findings = checkCodeBlocks(
      section([paragraph("prose", 10), code("a", 20), code("b", 21)]),
      { min: 1, max: 2 }
    );

    expect(findings).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- *
 * lists
 * -------------------------------------------------------------------------- */

describe("checkLists", () => {
  it("returns nothing when the template has no lists rule", () => {
    expect(checkLists(section([]), undefined)).toEqual([]);
  });

  it("reports too few lists", () => {
    const findings = checkLists(section([paragraph("prose", 10)]), { min: 1 });

    expect(findings).toEqual([
      {
        type: "lists_count_error",
        heading: "Install",
        message: "Expected at least 1 lists, but found 0",
        position: pos(SECTION_LINE),
        severity: "error",
      },
    ]);
  });

  it("reports too many lists", () => {
    const findings = checkLists(
      section([
        list([listItem("a", 30)], 30),
        list([listItem("b", 31)], 31),
        list([listItem("c", 32)], 32),
      ]),
      { max: 2 }
    );

    expect(messages(findings)).toEqual([
      "Expected at most 2 lists, but found 3",
    ]);
  });

  it("reports an over-long list once, anchored at the offending list", () => {
    const findings = checkLists(
      section([
        list([listItem("a", 30), listItem("b", 31)], 30),
        list(
          [
            listItem("c", 40),
            listItem("d", 41),
            listItem("e", 42),
            listItem("f", 43),
          ],
          40
        ),
      ]),
      { items: { max: 3 } }
    );

    expect(findings).toEqual([
      {
        type: "list_items_count_error",
        heading: "Install",
        message: "Expected at most 3 items in a list",
        position: pos(40),
        severity: "error",
      },
    ]);
  });

  it("reports an under-filled list once, however many lists break the rule", () => {
    const findings = checkLists(
      section([list([listItem("a", 30)], 30), list([listItem("b", 40)], 40)]),
      { items: { min: 2 } }
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toBe("Expected at least 2 items in a list");
    expect(findings[0]?.position).toEqual(pos(30));
  });

  it("accepts lists inside every bound", () => {
    const findings = checkLists(
      section([list([listItem("a", 30), listItem("b", 31)], 30)]),
      { min: 1, max: 2, items: { min: 1, max: 3 } }
    );

    expect(findings).toEqual([]);
  });

  it("runs item-level paragraph rules against each item's children", () => {
    const findings = checkLists(
      section([
        list(
          [
            listItem("has prose", 30, [paragraph("explanation", 31)]),
            listItem("bare", 32),
          ],
          30
        ),
      ]),
      { items: { paragraphs: { min: 1 } } }
    );

    expect(findings).toEqual([
      {
        type: "paragraphs_count_error",
        heading: "Install",
        message: "Expected at least 1 paragraphs, but found 0",
        position: pos(32),
        severity: "error",
      },
    ]);
  });

  it("runs item-level code_blocks rules against each item's children", () => {
    const findings = checkLists(
      section([
        list(
          [
            listItem("with code", 30, [code("npm i", 31)]),
            listItem("without", 32, [paragraph("just prose", 33)]),
          ],
          30
        ),
      ]),
      { items: { code_blocks: { min: 1 } } }
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toBe(
      "Expected at least 1 code blocks, but found 0"
    );
    expect(findings[0]?.position).toEqual(pos(32));
  });

  it("recurses into nested lists, item rules and all", () => {
    const nested = list([listItem("only child", 33)], 32);
    const findings = checkLists(
      section([list([listItem("parent", 30, [nested])], 30)]),
      { items: { lists: { min: 1, items: { min: 2 } } } }
    );

    expect(findings).toEqual([
      {
        type: "list_items_count_error",
        heading: "Install",
        message: "Expected at least 2 items in a list",
        position: pos(32),
        severity: "error",
      },
    ]);
  });

  it("reports a missing nested list at the item that should hold it", () => {
    const findings = checkLists(
      section([list([listItem("no sublist", 30, [paragraph("x", 31)])], 30)]),
      { items: { lists: { min: 1 } } }
    );

    expect(findings).toEqual([
      {
        type: "lists_count_error",
        heading: "Install",
        message: "Expected at least 1 lists, but found 0",
        position: pos(30),
        severity: "error",
      },
    ]);
  });
});

/* -------------------------------------------------------------------------- *
 * sequence
 * -------------------------------------------------------------------------- */

describe("groupRuns", () => {
  it("groups consecutive same-kind nodes and spans their positions", () => {
    const runs = groupRuns([
      paragraph("a", 10),
      paragraph("b", 11),
      code("npm i", 12),
      list([listItem("x", 13)], 13),
      list([listItem("y", 14)], 14),
    ]);

    expect(runs.map((run) => run.kind)).toEqual(["paragraph", "code", "list"]);
    expect(runs[0]?.nodes).toHaveLength(2);
    expect(runs[0]?.position).toEqual({
      start: pos(10).start,
      end: pos(11).end,
    });
    expect(runs[2]?.position).toEqual({
      start: pos(13).start,
      end: pos(14).end,
    });
  });

  it("starts a new run when the kind changes back", () => {
    const runs = groupRuns([
      paragraph("a", 10),
      code("npm i", 11),
      paragraph("b", 12),
    ]);

    expect(runs.map((run) => run.kind)).toEqual([
      "paragraph",
      "code",
      "paragraph",
    ]);
  });

  it("returns no runs for empty content", () => {
    expect(groupRuns([])).toEqual([]);
  });
});

describe("checkSequence", () => {
  it("returns nothing when the template has no sequence rule", () => {
    expect(checkSequence(section([paragraph("a")]), undefined)).toEqual([]);
  });

  it("accepts content whose runs match the sequence in order", () => {
    const findings = checkSequence(
      section([
        paragraph("intro", 10),
        code("npm install", 11),
        list([listItem("a", 12), listItem("b", 13)], 12),
        paragraph("outro", 14),
      ]),
      [
        { paragraphs: { min: 1 } },
        { code_blocks: { max: 1 } },
        { lists: { min: 1 } },
        { paragraphs: { min: 1 } },
      ]
    );

    expect(findings).toEqual([]);
  });

  it("reports content whose runs are in the wrong order", () => {
    const findings = checkSequence(
      section([paragraph("intro", 10), code("npm install", 11)]),
      [{ code_blocks: {} }, { paragraphs: {} }]
    );

    expect(findings).toEqual([
      {
        type: "sequence_order_error",
        heading: "Install",
        message:
          'Expected sequence ["code_blocks","paragraphs"], but found sequence ["paragraphs","code_blocks"]',
        position: pos(SECTION_LINE),
        severity: "error",
      },
    ]);
  });

  it("treats consecutive same-kind nodes as one run", () => {
    const findings = checkSequence(
      section([
        paragraph("a", 10),
        paragraph("b", 11),
        paragraph("c", 12),
        code("npm install", 13),
      ]),
      [{ paragraphs: { min: 3 } }, { code_blocks: { min: 1 } }]
    );

    expect(findings).toEqual([]);
  });

  it("counts runs, not nodes, when comparing lengths", () => {
    const findings = checkSequence(
      section([paragraph("a", 10), paragraph("b", 11)]),
      [{ paragraphs: {} }, { paragraphs: {} }]
    );

    expect(findings).toEqual([
      {
        type: "sequence_length_error",
        heading: "Install",
        message: "Expected 2 content types in sequence, but found 1",
        position: pos(SECTION_LINE),
        severity: "error",
      },
    ]);
  });

  it("stops at a length mismatch instead of also reporting order", () => {
    const findings = checkSequence(section([code("npm install", 10)]), [
      { paragraphs: {} },
      { code_blocks: {} },
      { lists: {} },
    ]);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.type).toBe("sequence_length_error");
  });

  it("applies each run's rule to that run only, anchored at its span", () => {
    const findings = checkSequence(
      section([
        paragraph("a", 10),
        paragraph("b", 11),
        code("npm install", 12),
        paragraph("c", 13),
      ]),
      [
        { paragraphs: { min: 3 } },
        { code_blocks: { min: 1 } },
        { paragraphs: { min: 1 } },
      ]
    );

    expect(findings).toEqual([
      {
        type: "paragraphs_count_error",
        heading: "Install",
        message: "Expected at least 3 paragraphs, but found 2",
        position: { start: pos(10).start, end: pos(11).end },
        severity: "error",
      },
    ]);
  });

  it("checks paragraph patterns inside a run", () => {
    const findings = checkSequence(
      section([paragraph("Step 1", 10), paragraph("nope", 11), code("x", 12)]),
      [{ paragraphs: { patterns: ["^Step \\d+$"] } }, { code_blocks: {} }]
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.type).toBe("paragraph_pattern_error");
    expect(findings[0]?.message).toBe(
      "Paragraph 2 doesn't match expected pattern."
    );
    expect(findings[0]?.position).toEqual(pos(11));
  });

  it("checks list item rules inside a run", () => {
    const findings = checkSequence(
      section([paragraph("intro", 10), list([listItem("only", 30)], 30)]),
      [{ paragraphs: {} }, { lists: { items: { min: 2 } } }]
    );

    expect(messages(findings)).toEqual([
      "Expected at least 2 items in a list",
    ]);
  });
});

describe("compilePattern", () => {
  // Heading matching is quadratic by nature - every rule is asked about every
  // section - so the same handful of patterns were recompiled hundreds of times
  // over one page. Identity is the observable part of the memo.
  it("returns one instance per pattern", () => {
    expect(compilePattern("^Step ")).toBe(compilePattern("^Step "));
    expect(compilePattern("^Step ")).not.toBe(compilePattern("^Other "));
  });

  // Sharing an instance is only safe while these carry no `g` or `y`, which are
  // the flags that make `lastIndex` persist between calls. If this ever fails,
  // the memo has to go, not the assertion.
  it("compiles without the flags that would make sharing stateful", () => {
    const regex = compilePattern("^Step ");
    expect(regex.global).toBe(false);
    expect(regex.sticky).toBe(false);
    expect(regex.test("Step one")).toBe(true);
    expect(regex.test("Step one")).toBe(true);
  });

  it("still names the template's own bad pattern, and does not memo it", () => {
    expect(() => compilePattern("Step (")).toThrow(MooseLintError);
    expect(() => compilePattern("Step (")).toThrow(/Invalid pattern "Step \("/);
  });

  it("recompiles after the cache is cleared", () => {
    const before = compilePattern("^Cleared ");
    clearPatternCache();
    expect(compilePattern("^Cleared ")).not.toBe(before);
  });
});
