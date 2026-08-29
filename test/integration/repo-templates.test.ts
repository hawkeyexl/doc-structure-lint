/**
 * The rewrite against the repository's own template file and sample documents.
 *
 * Unit tests pin each rule in isolation; this pins the combination that the
 * pre-rewrite project shipped and demonstrated in its README. `Sample` and the
 * sample document exercise the matcher's hard parts together - adjacent
 * unconstrained sections, a `$ref` component, `additionalSections`, and content
 * rules at three heading levels - so a regression here means the tool no longer
 * does what it always claimed to do, whatever the unit tests say.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { markdownParser } from "../../src/parsers/markdown.js";
import { validateDocument } from "../../src/core/validator.js";
import type { Template } from "../../src/core/template.js";

const templates = parse(readFileSync("templates.yaml", "utf8")).templates as Record<
  string,
  Template
>;

const lint = (docPath: string, templateName: string) =>
  validateDocument(
    markdownParser.parse(readFileSync(docPath, "utf8"), docPath),
    templates[templateName]!,
  );

describe("the repository's own templates", () => {
  it("lints the sample document clean against Sample", () => {
    expect(lint("artifacts/sample_markdown.md", "Sample")).toEqual([]);
  });

  // Two adjacent unconstrained sections, `Setup` and `Usage`. A slot that
  // repeated by default consumed both and reported `Usage` missing, which is
  // why repetition is opt-in.
  it("gives adjacent unconstrained sections one section each", () => {
    const findings = lint("artifacts/sample_markdown.md", "Sample");
    expect(findings.filter((f) => f.type === "missing_section")).toEqual([]);
  });

  // A how-to is a genuinely different shape from the sample, so this must
  // report - but as three precise heading mismatches, not a cascade. The
  // pre-rewrite index-based matcher turned one early mismatch into noise for
  // every section after it.
  it("reports a mismatched template as heading mismatches, not a cascade", () => {
    const findings = lint("artifacts/sample_markdown.md", "how-to");
    expect(findings.map((f) => f.type)).toEqual([
      "heading_const_error",
      "heading_const_error",
      "heading_const_error",
    ]);
    expect(findings.map((f) => f.heading)).toEqual([
      "Prerequisites",
      "Setup",
      "Next steps",
    ]);
  });

  it("handles a document with no H1 via the implicit lead section", () => {
    const tree = markdownParser.parse(
      readFileSync("artifacts/sample_markdown_headless.md", "utf8"),
      "artifacts/sample_markdown_headless.md",
    );
    expect(tree.sections[0]!.level).toBe(0);
    expect(tree.sections[0]!.sections.map((s) => s.title)).toContain(
      "Prerequisites",
    );
    // Frontmatter is still read when no heading precedes the content.
    expect(tree.frontmatter).toMatchObject({ title: "Sample" });
  });

  it("resolves a $ref component into the section that uses it", () => {
    // `Sample` reaches `Next steps` through `$ref: "#/components/sections/..."`.
    // Read raw (undereferenced) here: the registry dereferences on load, so
    // this asserts the fixture still exercises the feature.
    const raw = parse(readFileSync("templates.yaml", "utf8"));
    expect(raw.templates.Sample.sections.Introduction.sections["Next steps"]).toEqual(
      { $ref: "#/components/sections/Next steps" },
    );
  });
});
