import { describe, expect, it } from "vitest";
import { markdownParser } from "../../src/parsers/markdown.js";
import { matchSections } from "../../src/core/match.js";
import { validateDocument } from "../../src/core/validator.js";
import type { Template, TemplateSection } from "../../src/core/template.js";

/** Sibling sections one level below a single H1, the common template shape. */
function subsectionsOf(md: string) {
  return markdownParser.parse(md, "t.md").sections[0]!.sections;
}

const heading = (
  text: string,
  extra: Partial<TemplateSection> = {},
): TemplateSection => ({ heading: { const: text }, ...extra });

describe("matchSections", () => {
  it("pairs anchored rules with their sections in order", () => {
    const doc = subsectionsOf("# T\n\n## Overview\n\n## See also\n");
    const { matches, findings } = matchSections(doc, {
      overview: heading("Overview"),
      "see also": heading("See also"),
    });
    expect(findings).toEqual([]);
    expect(matches.map((m) => [m.name, m.section.title])).toEqual([
      ["overview", "Overview"],
      ["see also", "See also"],
    ]);
  });

  // The pre-rewrite matcher paired rule[i] with section[i], so one absent
  // optional section shifted every later comparison by one and produced a
  // cascade of bogus findings. This is the regression that made published
  // doctype templates - which are full of optional sections - unusable.
  it("keeps later sections aligned when an optional rule is absent", () => {
    const doc = subsectionsOf("# T\n\n## Overview\n\n## See also\n");
    const { matches, findings } = matchSections(doc, {
      overview: heading("Overview"),
      background: heading("Background", { required: false }),
      "see also": heading("See also"),
    });
    expect(findings).toEqual([]);
    expect(matches.map((m) => [m.name, m.section.title])).toEqual([
      ["overview", "Overview"],
      ["see also", "See also"],
    ]);
  });

  it("reports a required rule that matches nothing as missing", () => {
    const doc = subsectionsOf("# T\n\n## Overview\n\n## See also\n");
    const { findings } = matchSections(doc, {
      overview: heading("Overview"),
      "before you start": heading("Before you start"),
      "see also": heading("See also"),
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ type: "missing_section" });
    expect(findings[0]!.message).toContain("Before you start");
  });

  // Degrading a simple one-for-one mismatch into missing + unexpected would
  // make the reader reconstruct what happened. Keep the precise message.
  it("reports a lone wrong heading as a mismatch, not missing + unexpected", () => {
    const tree = markdownParser.parse("# Wrong Heading\n\ntext\n", "t.md");
    const findings = validateDocument(tree, {
      sections: { intro: heading("Introduction") },
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toBe(
      'Expected title "Introduction", but found "Wrong Heading"',
    );
  });

  it("flags sections the template does not describe", () => {
    const doc = subsectionsOf("# T\n\n## Overview\n\n## Surprise\n");
    const { findings } = matchSections(doc, { overview: heading("Overview") });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ type: "unexpected_section" });
    expect(findings[0]!.message).toContain("Surprise");
  });

  it("allows undescribed sections when additionalSections is set", () => {
    const doc = subsectionsOf("# T\n\n## Overview\n\n## Surprise\n");
    const { findings } = matchSections(
      doc,
      { overview: heading("Overview") },
      { additionalSections: true },
    );
    expect(findings).toEqual([]);
  });

  it("skips past extra sections to find a required one further on", () => {
    const doc = subsectionsOf("# T\n\n## Extra\n\n## See also\n");
    const { matches, findings } = matchSections(doc, {
      "see also": heading("See also"),
    });
    expect(matches.map((m) => m.section.title)).toEqual(["See also"]);
    expect(findings.map((f) => f.type)).toEqual(["unexpected_section"]);
  });

  it("matches an anchored rule by pattern", () => {
    const doc = subsectionsOf("# T\n\n## Request Parameters\n");
    const { matches, findings } = matchSections(doc, {
      params: { heading: { pattern: "^(Request )?Parameters$" } },
    });
    expect(findings).toEqual([]);
    expect(matches).toHaveLength(1);
  });
});

describe("slot rules", () => {
  it("claims exactly one section by default", () => {
    const doc = subsectionsOf("# T\n\n## Setup\n\n## Usage\n\n## Next steps\n");
    const { matches, findings } = matchSections(doc, {
      setup: {},
      usage: {},
      "next steps": heading("Next steps"),
    });
    expect(findings).toEqual([]);
    expect(matches.map((m) => [m.name, m.section.title])).toEqual([
      ["setup", "Setup"],
      ["usage", "Usage"],
      ["next steps", "Next steps"],
    ]);
  });

  // Repetition has to be opt-in. Adjacent slots are ordinary in hand-written
  // templates - the repo's own `Sample` has `Setup` then `Usage` - and a
  // greedy first slot swallows the second one's section, reporting it missing.
  it("does not let one slot swallow the next slot's section", () => {
    const doc = subsectionsOf("# T\n\n## Setup\n\n## Usage\n");
    const { findings } = matchSections(doc, { setup: {}, usage: {} });
    expect(findings).toEqual([]);
  });

  // A published template's repeated placeholder - TGDP writes a bracketed
  // "{Task name}" - does mean "one or more sections go here".
  it("consumes every section up to the next anchored rule when repeat is set", () => {
    const doc = subsectionsOf(
      "# T\n\n## Overview\n\n## Install it\n\n## Configure it\n\n## See also\n",
    );
    const { matches, findings } = matchSections(doc, {
      overview: heading("Overview"),
      task: { repeat: true },
      "see also": heading("See also"),
    });
    expect(findings).toEqual([]);
    expect(
      matches.filter((m) => m.name === "task").map((m) => m.section.title),
    ).toEqual(["Install it", "Configure it"]);
  });

  it("stops a slot at an anchored rule further down the template", () => {
    const doc = subsectionsOf("# T\n\n## A task\n\n## Next steps\n");
    const { matches } = matchSections(doc, {
      task: { repeat: true },
      summary: heading("Summary", { required: false }),
      "next steps": heading("Next steps"),
    });
    expect(matches.map((m) => [m.name, m.section.title])).toEqual([
      ["task", "A task"],
      ["next steps", "Next steps"],
    ]);
  });

  it("reports an empty required slot as missing", () => {
    const doc = subsectionsOf("# T\n\n## Overview\n\n## See also\n");
    const { findings } = matchSections(doc, {
      overview: heading("Overview"),
      task: { repeat: true },
      "see also": heading("See also"),
    });
    expect(findings.map((f) => f.type)).toEqual(["missing_section"]);
  });

  it("accepts an empty optional slot", () => {
    const doc = subsectionsOf("# T\n\n## Overview\n\n## See also\n");
    const { findings } = matchSections(doc, {
      overview: heading("Overview"),
      task: { required: false, repeat: true },
      "see also": heading("See also"),
    });
    expect(findings).toEqual([]);
  });

  it("runs content rules against every section a slot consumed", () => {
    const tree = markdownParser.parse(
      "# T\n\n## Step one\n\npara\n\n## Step two\n",
      "t.md",
    );
    const template: Template = {
      sections: {
        title: { sections: { step: { repeat: true, paragraphs: { min: 1 } } } },
      },
    };
    const findings = validateDocument(tree, template);
    // Only the second step is missing its paragraph.
    expect(findings).toHaveLength(1);
    expect(findings[0]!.heading).toBe("Step two");
  });
});

describe("recursion", () => {
  it("descends into subsections of matched pairs", () => {
    const tree = markdownParser.parse(
      "# T\n\n## Usage\n\n### Troubleshooting\n",
      "t.md",
    );
    const template: Template = {
      sections: {
        title: {
          sections: {
            usage: heading("Usage", {
              sections: { trouble: heading("Troubleshooting") },
            }),
          },
        },
      },
    };
    expect(validateDocument(tree, template)).toEqual([]);
  });

  it("reports findings in document order", () => {
    const tree = markdownParser.parse("# T\n\n## A\n\n## B\n\n## C\n", "t.md");
    const template: Template = {
      sections: {
        title: {
          sections: {
            a: heading("A", { paragraphs: { min: 1 } }),
            b: heading("B", { paragraphs: { min: 1 } }),
            c: heading("C", { paragraphs: { min: 1 } }),
          },
        },
      },
    };
    const findings = validateDocument(tree, template);
    expect(findings.map((f) => f.heading)).toEqual(["A", "B", "C"]);
    const offsets = findings.map((f) => f.position.start.offset);
    expect([...offsets].sort((x, y) => x - y)).toEqual(offsets);
  });
});
