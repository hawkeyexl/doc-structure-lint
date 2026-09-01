import { describe, expect, it } from "vitest";
import {
  render,
  renderGithub,
  renderJson,
  renderPretty,
} from "../../src/reporters/index.js";
import { renderSarif } from "../../src/reporters/sarif.js";
import type { LintRun } from "../../src/commands/lint.js";
import type { Finding } from "../../src/types.js";

const ESC = String.fromCharCode(27);

function finding(over: Partial<Finding> = {}): Finding {
  return {
    type: "missing_section",
    heading: "Prerequisites",
    message: "Required section is missing",
    position: {
      start: { line: 3, column: 1, offset: 42 },
      end: { line: 3, column: 16, offset: 57 },
    },
    severity: "error",
    ...over,
  };
}

const run: LintRun = {
  results: [
    { file: "ok.md", success: true, findings: [], template: "how-to" },
    {
      file: "bad.md",
      success: false,
      findings: [
        finding(),
        finding({
          type: "paragraph_count",
          heading: "Overview",
          message: "Expected at least 2 paragraphs, found 1",
          position: {
            start: { line: 9, column: 3, offset: 120 },
            end: { line: 11, column: 1, offset: 180 },
          },
        }),
      ],
      template: "how-to",
    },
    {
      file: "guide.adoc",
      success: false,
      findings: [],
      template: null,
      skipped: "unsupported-format",
      reason: "guide.adoc: AsciiDoc is not implemented yet.",
    },
  ],
  summary: { checked: 2, passed: 1, failed: 1, skipped: 1 },
};

const cleanRun: LintRun = {
  results: [
    { file: "ok.md", success: true, findings: [], template: "how-to" },
    { file: "also-ok.md", success: true, findings: [], template: "how-to" },
  ],
  summary: { checked: 2, passed: 2, failed: 0, skipped: 0 },
};

/**
 * The JSON reporter is a published contract, not an implementation detail:
 * moose-docevals reads it with `JSON.parse` and plain property access, so a
 * renamed key yields zero findings instead of an error. These assertions are
 * deliberately about key names and nesting rather than about values.
 */
describe("json reporter", () => {
  it("emits a bare top-level array, one entry per file", () => {
    const parsed = JSON.parse(renderJson(run));
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(3);
    expect(parsed.map((r: { file: string }) => r.file)).toEqual([
      "ok.md",
      "bad.md",
      "guide.adoc",
    ]);
  });

  it("uses exactly the file keys { file, success, errors }", () => {
    const parsed = JSON.parse(renderJson(run));
    expect(Object.keys(parsed[0])).toEqual(["file", "success", "errors"]);
  });

  // The internal field is `findings`. The wire field is `errors`, and has to
  // stay that way.
  it("names the findings array `errors`, never `findings`", () => {
    const parsed = JSON.parse(renderJson(run));
    expect(parsed[1]).toHaveProperty("errors");
    expect(parsed[1]).not.toHaveProperty("findings");
    expect(parsed[1].errors).toHaveLength(2);
  });

  it("uses exactly the error keys { type, heading, message, position }", () => {
    const error = JSON.parse(renderJson(run))[1].errors[0];
    expect(Object.keys(error)).toEqual([
      "type",
      "heading",
      "message",
      "position",
    ]);
    expect(error.type).toBe("missing_section");
    expect(error.heading).toBe("Prerequisites");
    expect(error.message).toBe("Required section is missing");
  });

  it("nests source location as position.start / position.end", () => {
    const error = JSON.parse(renderJson(run))[1].errors[0];
    expect(error.position.start.line).toBe(3);
    expect(error.position.start.column).toBe(1);
    expect(error.position.start.offset).toBe(42);
    expect(error.position.end.line).toBe(3);
    expect(error.position.end.column).toBe(16);
    expect(error.position.end.offset).toBe(57);
  });

  it("reports a skipped file with no errors, and keeps `reason` off the wire", () => {
    const skipped = JSON.parse(renderJson(run))[2];
    expect(skipped.file).toBe("guide.adoc");
    expect(skipped.success).toBe(false);
    expect(skipped.errors).toEqual([]);
    expect(skipped).not.toHaveProperty("reason");
    expect(skipped).not.toHaveProperty("skipped");
  });

  // Mirrors moose-docevals src/graders/tools/doc-structure-lint.ts field for
  // field. If this stops compiling or matching, that grader silently stops
  // reporting.
  it("survives the moose-docevals read path", () => {
    interface WireError {
      type?: string;
      heading?: string;
      message?: string;
      position?: { start?: { line?: number; column?: number } };
    }
    const parsed = JSON.parse(renderJson(run)) as { errors?: WireError[] }[];
    const graded = parsed
      .flatMap((result) => result.errors ?? [])
      .map((err) => ({
        ruleId: err.type,
        message: err.heading
          ? `${err.heading}: ${err.message ?? "structure error"}`
          : (err.message ?? "structure error"),
        line: err.position?.start?.line,
        col: err.position?.start?.column,
      }));

    expect(graded).toEqual([
      {
        ruleId: "missing_section",
        message: "Prerequisites: Required section is missing",
        line: 3,
        col: 1,
      },
      {
        ruleId: "paragraph_count",
        message: "Overview: Expected at least 2 paragraphs, found 1",
        line: 9,
        col: 3,
      },
    ]);
  });
});

describe("pretty reporter", () => {
  it("marks every file passing on a clean run and emits no ANSI when color is off", () => {
    const out = renderPretty(cleanRun, { color: false });
    expect(out).toContain("✓ ok.md");
    expect(out).toContain("✓ also-ok.md");
    expect(out).toContain("2 files checked, 2 passed, 0 failed, 0 skipped");
    expect(out).not.toContain("✗");
    expect(out.includes(ESC)).toBe(false);
  });

  it("lists each finding under its file with position and message", () => {
    const out = renderPretty(run, { color: false });
    expect(out).toContain("✗ bad.md");
    expect(out).toContain("3:1");
    expect(out).toContain("missing_section");
    expect(out).toContain("Prerequisites: Required section is missing");
    expect(out).toContain("9:3");
    expect(out).toContain("paragraph_count");
    // `checked` counts linted files only; the skipped one is counted apart.
    expect(out).toContain("2 files checked, 1 passed, 1 failed, 1 skipped");
  });

  // A skip that leaves no trace is indistinguishable from a pass.
  it("says which file was skipped and why", () => {
    const out = renderPretty(run, { color: false });
    expect(out).toContain("- guide.adoc");
    expect(out).toContain("skipped: guide.adoc: AsciiDoc is not implemented yet.");
  });

  it("emits ANSI only when color is on", () => {
    expect(renderPretty(run, { color: true }).includes(ESC)).toBe(true);
    expect(renderPretty(run).includes(ESC)).toBe(false);
  });
});

describe("github reporter", () => {
  /**
   * One finding, so an escaping assertion is about the annotation itself and
   * not about which of several lines it landed on. Anything not overridden
   * matches the shared fixture.
   */
  function annotationFor(over: { file?: string; message?: string }): string {
    const single: LintRun = {
      results: [
        {
          file: over.file ?? "bad.md",
          success: false,
          findings: [
            finding({
              heading: null,
              message: over.message ?? "Required section is missing",
            }),
          ],
          template: "how-to",
        },
      ],
      summary: { checked: 1, passed: 0, failed: 1, skipped: 0 },
    };
    return renderGithub(single);
  }

  it("emits one ::error annotation per finding, with file, line and col", () => {
    const out = renderGithub(run);
    expect(out.split("\n")).toEqual([
      "::error file=bad.md,line=3,col=1::[missing_section] Prerequisites: Required section is missing",
      "::error file=bad.md,line=9,col=3::[paragraph_count] Overview: Expected at least 2 paragraphs, found 1",
    ]);
  });

  it("annotates nothing for passing or skipped files", () => {
    expect(renderGithub(run)).not.toContain("ok.md");
    expect(renderGithub(run)).not.toContain("guide.adoc");
    expect(renderGithub(cleanRun)).toBe("");
  });

  // Every absolute path on Windows carries a drive-letter colon. Unescaped, it
  // closes the `::`-terminated property list early, and GitHub drops the
  // annotation instead of attaching it to the file - so the whole `-f github`
  // output is silently useless on a Windows runner.
  it("escapes a colon in the file property so a Windows path still parses", () => {
    const out = annotationFor({ file: "C:\\docs\\a.md" });
    expect(out).toBe(
      "::error file=C%3A\\docs\\a.md,line=3,col=1::[missing_section] Required section is missing",
    );
  });

  // Properties are comma-separated, so a comma inside one splits the path in
  // half and leaves the remainder parsed as a nameless second property.
  it("escapes a comma in the file property so the path stays one property", () => {
    const out = annotationFor({ file: "docs/a,b.md" });
    expect(out).toContain("file=docs/a%2Cb.md,line=3,col=1::");
  });

  // A literal `%` is the escape character: left alone it makes GitHub read the
  // next two characters as a hex code and swallow them.
  it("escapes a percent in the message as %25", () => {
    const out = annotationFor({ message: "coverage is 50% of the file" });
    expect(out).toContain("coverage is 50%25 of the file");
  });

  // Percent has to be escaped before the line breaks are. The other order
  // rewrites the `%` of a `%0A` this code just introduced, and the annotation
  // shows a literal `%0A` where the break should be.
  it("escapes a percent before a newline, so the newline escape survives", () => {
    const out = annotationFor({ message: "50%\nof files" });
    expect(out).toContain("50%25%0Aof files");
    expect(out).not.toContain("%250A");
    expect(out).not.toContain("%2525");
  });

  // A raw newline ends the workflow command, so the rest of the message is
  // printed as loose log output and never reaches the annotation.
  it("escapes a newline as %0A and keeps the annotation on one line", () => {
    const out = annotationFor({ message: "first line\nsecond line" });
    expect(out.split("\n")).toHaveLength(1);
    expect(out).toContain("first line%0Asecond line");
  });

  // A bare `\r` is a line break too, and a runner's log treats it as one. The
  // collapse this replaced matched `\r?\n`, which let a lone carriage return
  // through untouched.
  it("escapes a bare carriage return as %0D and keeps the annotation on one line", () => {
    const out = annotationFor({ message: "first line\rsecond line" });
    expect(out).toContain("first line%0Dsecond line");
    expect(out).not.toContain("\r");
    expect(out.split(/\r?\n/)).toHaveLength(1);
  });

  // CRLF has to survive as both halves, in order, or a Windows-authored
  // message loses a character on the way to the annotation.
  it("escapes a CRLF pair as %0D%0A", () => {
    const out = annotationFor({ message: "first line\r\nsecond line" });
    expect(out).toContain("first line%0D%0Asecond line");
  });
});

describe("render", () => {
  it("dispatches on the format and defaults to pretty", () => {
    expect(render(run, "json")).toBe(renderJson(run));
    expect(render(run, "github")).toBe(renderGithub(run));
    expect(render(run, "pretty", { color: false })).toBe(
      renderPretty(run, { color: false }),
    );
  });

  // `render` is the entry point a library caller reaches for, and SARIF is the
  // one reporter whose entire output is paths. Without a way to pass `root`
  // through, such a caller was pinned to the process cwd and every URI in the
  // document was silently relative to the wrong directory.
  it("forwards root to the sarif reporter", () => {
    // An absolute path on purpose: `root` is only consulted for one, so a run
    // of relative paths would pass this test without the option travelling.
    const root = process.platform === "win32" ? "C:/repo" : "/repo";
    const absolute: LintRun = {
      ...run,
      results: [
        {
          file: `${root}/docs/a.md`,
          success: false,
          findings: [finding()],
          template: "how-to",
        },
      ],
    };

    expect(render(absolute, "sarif", { root })).toBe(
      renderSarif(absolute, { root }),
    );
    // Proof it travelled: under the run's own root the URI is repo-relative,
    // while under the process cwd the same file is outside the root and falls
    // back to an absolute `file:` URI.
    expect(render(absolute, "sarif", { root })).not.toBe(renderSarif(absolute));
  });
});
