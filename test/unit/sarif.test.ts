/**
 * SARIF is a format whose mistakes are silent: a malformed URI, or a result
 * naming a rule nobody declared, uploads to GitHub cleanly and then annotates
 * nothing. There is no error to notice, so these assertions stand in for the
 * one CI cannot give us.
 *
 * The output is not validated against the published SARIF 2.1.0 JSON Schema.
 * That schema is not vendored anywhere in the tree and fetching it would put a
 * network call in the unit suite; `ajv` is a dependency here but `ajv-draft-04`
 * is only present by hoisting from `docmeta`, so relying on it would make the
 * suite depend on a transitive package this project never declared. The
 * structure is hand-asserted instead, field by field.
 */
import { describe, expect, it } from "vitest";
import { renderSarif } from "../../src/reporters/sarif.js";
import { render } from "../../src/reporters/index.js";
import type { LintFileResult, LintRun } from "../../src/commands/lint.js";
import type { Finding } from "../../src/types.js";
import pkg from "../../package.json" with { type: "json" };

/** A Windows root, used on every platform: the mapping is string-level and
 *  must not depend on which runner the suite happens to be on. */
const WIN_ROOT = "C:\\repo";

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

function file(over: Partial<LintFileResult> = {}): LintFileResult {
  return {
    file: "docs/guide.md",
    success: false,
    findings: [finding()],
    template: "how-to",
    ...over,
  };
}

function runOf(results: LintFileResult[]): LintRun {
  const skipped = results.filter((r) => r.skipped != null).length;
  const failed = results.filter((r) => r.skipped == null && !r.success).length;
  const checked = results.length - skipped;
  return {
    results,
    summary: { checked, passed: checked - failed, failed, skipped },
  };
}

/**
 * Parsed SARIF, read loosely. These tests assert the wire shape, and typing it
 * here would only restate the reporter's own private interfaces - which is the
 * one thing a test of a wire format must not do.
 */
function sarif(results: LintFileResult[], root = WIN_ROOT): any {
  return JSON.parse(renderSarif(runOf(results), { root }));
}

function theRun(log: any): any {
  return log.runs[0];
}

/** Every `uri` anywhere in the document, at any depth. */
function allUris(node: any, found: string[] = []): string[] {
  if (node === null || typeof node !== "object") return found;
  if (typeof node.uri === "string") found.push(node.uri);
  for (const value of Object.values(node)) allUris(value, found);
  return found;
}

describe("renderSarif envelope", () => {
  it("is SARIF 2.1.0 with the official schema and exactly one run", () => {
    const log = sarif([file()]);
    expect(log.version).toBe("2.1.0");
    expect(log.$schema).toBe(
      "https://docs.oasis-open.org/sarif/sarif/v2.1.0/errata01/os/schemas/sarif-schema-2.1.0.json",
    );
    expect(log.runs).toHaveLength(1);
  });

  it("names the tool and carries the package version", () => {
    const driver = theRun(sarif([file()])).tool.driver;
    expect(driver.name).toBe("moose-lint");
    expect(driver.informationUri).toBe("https://github.com/hawkeyexl/moose-lint");
    expect(driver.version).toBe(pkg.version);
  });

  it("records a successful invocation - findings are not a tool failure", () => {
    const invocations = theRun(sarif([file()])).invocations;
    expect(invocations).toHaveLength(1);
    expect(invocations[0].executionSuccessful).toBe(true);
  });

  it("is pretty-printed", () => {
    const text = renderSarif(runOf([file()]), { root: WIN_ROOT });
    expect(text).toContain('\n  "version"');
    expect(text).toBe(JSON.stringify(JSON.parse(text), null, 2));
  });

  it("is reachable through render() as the sarif format", () => {
    const log = JSON.parse(render(runOf([file()]), "sarif"));
    expect(log.version).toBe("2.1.0");
    expect(theRun(log).results).toHaveLength(1);
  });
});

describe("renderSarif rule descriptors", () => {
  const mixed = [
    file({ file: "a.md", findings: [finding(), finding({ type: "lists_count_error" })] }),
    file({ file: "b.md", findings: [finding()] }),
  ];

  it("declares one descriptor per distinct type, in first-seen order", () => {
    const rules = theRun(sarif(mixed)).tool.driver.rules;
    expect(rules.map((r: any) => r.id)).toEqual([
      "missing_section",
      "lists_count_error",
    ]);
  });

  it("gives each descriptor a Pascal-case name and a short description", () => {
    const rules = theRun(sarif(mixed)).tool.driver.rules;
    expect(rules[0].name).toBe("MissingSection");
    expect(rules[0].shortDescription.text).toBe("Missing section");
    expect(rules[1].name).toBe("ListsCountError");
  });

  it("points every result's ruleIndex at the descriptor its ruleId names", () => {
    const run = theRun(sarif(mixed));
    expect(run.results).toHaveLength(3);
    for (const result of run.results) {
      expect(typeof result.ruleIndex).toBe("number");
      expect(run.tool.driver.rules[result.ruleIndex].id).toBe(result.ruleId);
    }
    // The three results share only two rules, so the indexes must repeat.
    expect(run.results.map((r: any) => r.ruleIndex)).toEqual([0, 1, 0]);
  });

  it("declares a rule for every ruleId a result carries", () => {
    const run = theRun(sarif(mixed));
    const declared = new Set(run.tool.driver.rules.map((r: any) => r.id));
    for (const result of run.results) expect(declared.has(result.ruleId)).toBe(true);
  });

  it("defaults a rule's level only when its findings agree on one", () => {
    const unanimous = theRun(
      sarif([file({ findings: [finding(), finding()] })]),
    ).tool.driver.rules[0];
    expect(unanimous.defaultConfiguration).toEqual({ level: "error" });

    const conflicted = theRun(
      sarif([file({ findings: [finding(), finding({ severity: "warning" })] })]),
    ).tool.driver.rules[0];
    expect(conflicted.defaultConfiguration).toBeUndefined();
  });
});

describe("renderSarif results", () => {
  it("maps severity onto the SARIF level", () => {
    const run = theRun(
      sarif([
        file({
          findings: [
            finding({ severity: "error" }),
            finding({ type: "lists_count_error", severity: "warning" }),
          ],
        }),
      ]),
    );
    expect(run.results.map((r: any) => r.level)).toEqual(["error", "warning"]);
  });

  it("copies the region across unchanged - both ends are 1-based and endColumn is exclusive on both sides", () => {
    const run = theRun(
      sarif([
        file({
          findings: [
            finding({
              position: {
                start: { line: 9, column: 3, offset: 120 },
                end: { line: 11, column: 7, offset: 180 },
              },
            }),
          ],
        }),
      ]),
    );
    expect(run.results[0].locations[0].physicalLocation.region).toEqual({
      startLine: 9,
      startColumn: 3,
      endLine: 11,
      endColumn: 7,
    });
  });

  it("keeps a zero-width span as a zero-length region", () => {
    const run = theRun(
      sarif([
        file({
          findings: [
            finding({
              position: {
                start: { line: 1, column: 1, offset: 0 },
                end: { line: 1, column: 1, offset: 0 },
              },
            }),
          ],
        }),
      ]),
    );
    expect(run.results[0].locations[0].physicalLocation.region).toEqual({
      startLine: 1,
      startColumn: 1,
      endLine: 1,
      endColumn: 1,
    });
  });

  it("puts the heading in the message and keeps it as data in properties", () => {
    const result = theRun(sarif([file()])).results[0];
    expect(result.message.text).toBe("Prerequisites: Required section is missing");
    expect(result.properties).toEqual({ heading: "Prerequisites" });
  });

  it("omits the heading entirely when a finding has none", () => {
    const result = theRun(
      sarif([
        file({
          findings: [
            finding({ heading: null, type: "parse_error", message: "boom" }),
          ],
        }),
      ]),
    ).results[0];
    expect(result.message.text).toBe("boom");
    expect(result.properties).toBeUndefined();
  });

  it("keeps newlines, unlike the one-line github reporter", () => {
    const result = theRun(
      sarif([
        file({
          findings: [
            finding({ heading: null, message: "first line\nsecond line" }),
          ],
        }),
      ]),
    ).results[0];
    expect(result.message.text).toBe("first line\nsecond line");
  });
});

describe("renderSarif clean runs", () => {
  const clean = [
    file({ file: "ok.md", success: true, findings: [] }),
    file({ file: "also-ok.md", success: true, findings: [] }),
  ];

  it("emits no results but a complete, well-formed document", () => {
    const log = sarif(clean);
    const run = theRun(log);
    expect(run.results).toEqual([]);
    expect(log.version).toBe("2.1.0");
    expect(run.tool.driver.name).toBe("moose-lint");
    expect(run.invocations[0].executionSuccessful).toBe(true);
    expect(run.originalUriBaseIds.SRCROOT.uri).toBe("file:///C:/repo/");
  });

  it("still declares the rules array, empty", () => {
    expect(theRun(sarif(clean)).tool.driver.rules).toEqual([]);
  });

  it("carries no notification machinery when nothing was skipped", () => {
    const run = theRun(sarif(clean));
    expect(run.tool.driver.notifications).toBeUndefined();
    expect(run.invocations[0].toolExecutionNotifications).toBeUndefined();
  });
});

describe("renderSarif skipped files", () => {
  const skipped = file({
    file: "guide.adoc",
    success: false,
    findings: [],
    template: null,
    skipped: "unsupported-format",
    reason: "AsciiDoc is not implemented yet.",
  });

  it("reports a skip as a tool notification, never as a result", () => {
    const run = theRun(sarif([skipped]));
    expect(run.results).toEqual([]);
    const notes = run.invocations[0].toolExecutionNotifications;
    expect(notes).toHaveLength(1);
    expect(notes[0].level).toBe("note");
    expect(notes[0].message.text).toBe("AsciiDoc is not implemented yet.");
  });

  it("declares the notification descriptor and references it by id and index", () => {
    const run = theRun(sarif([skipped]));
    const declared = run.tool.driver.notifications;
    expect(declared.map((d: any) => d.id)).toEqual(["unsupported-format"]);
    expect(declared[0].name).toBe("UnsupportedFormat");
    const note = run.invocations[0].toolExecutionNotifications[0];
    expect(note.descriptor).toEqual({ id: "unsupported-format", index: 0 });
    expect(declared[note.descriptor.index].id).toBe(note.descriptor.id);
  });

  it("locates the notification at the file, with no region to point at", () => {
    const note = theRun(sarif([skipped])).invocations[0]
      .toolExecutionNotifications[0];
    expect(note.locations[0].physicalLocation.artifactLocation).toEqual({
      uri: "guide.adoc",
      uriBaseId: "SRCROOT",
    });
    expect(note.locations[0].physicalLocation.region).toBeUndefined();
  });

  it("shares one descriptor across repeats and adds one per distinct reason", () => {
    const run = theRun(
      sarif([
        skipped,
        file({ ...skipped, file: "other.adoc" }),
        file({
          file: "untyped.md",
          success: false,
          findings: [],
          template: null,
          skipped: "no-template",
          reason: "no type in frontmatter and no template resolved",
        }),
      ]),
    );
    expect(run.tool.driver.notifications.map((d: any) => d.id)).toEqual([
      "unsupported-format",
      "no-template",
    ]);
    const notes = run.invocations[0].toolExecutionNotifications;
    expect(notes.map((n: any) => n.descriptor.index)).toEqual([0, 0, 1]);
  });

  it("falls back to a generic message when the run recorded no reason", () => {
    const note = theRun(
      sarif([file({ ...skipped, reason: undefined })]),
    ).invocations[0].toolExecutionNotifications[0];
    expect(note.message.text).toBe(
      "File was not linted: no parser handles its format.",
    );
  });

  it("keeps findings and skips side by side in one report", () => {
    const run = theRun(sarif([file(), skipped]));
    expect(run.results).toHaveLength(1);
    expect(run.invocations[0].toolExecutionNotifications).toHaveLength(1);
  });
});

describe("renderSarif URIs", () => {
  function uriOf(path: string, root = WIN_ROOT): any {
    return theRun(sarif([file({ file: path })], root)).results[0].locations[0]
      .physicalLocation.artifactLocation;
  }

  it("turns a Windows absolute path under the root into a forward-slashed relative URI", () => {
    expect(uriOf("C:\\repo\\docs\\guide.md")).toEqual({
      uri: "docs/guide.md",
      uriBaseId: "SRCROOT",
    });
  });

  it("forward-slashes a backslashed relative path", () => {
    expect(uriOf("docs\\nested\\guide.md")).toEqual({
      uri: "docs/nested/guide.md",
      uriBaseId: "SRCROOT",
    });
  });

  it("matches a Windows root case-insensitively, since Windows paths are", () => {
    expect(uriOf("c:\\REPO\\docs\\guide.md")).toEqual({
      uri: "docs/guide.md",
      uriBaseId: "SRCROOT",
    });
  });

  it("matches a UNC root case-insensitively too, since a share is a Windows path", () => {
    // A checkout on a network share is the case a drive-letter test cannot
    // reach. Missing it emits an absolute `file:` URI, and an alert carrying
    // one attaches to no file in the repository - silently, on upload.
    expect(
      uriOf("\\\\SERVER\\SHARE\\docs\\guide.md", "\\\\server\\share"),
    ).toEqual({
      uri: "docs/guide.md",
      uriBaseId: "SRCROOT",
    });
  });

  it("still refuses to case-fold a posix root, where casing distinguishes files", () => {
    // The folding is a concession to Windows, not a general relaxation: on a
    // case-sensitive filesystem `/repo` and `/REPO` are two directories, and
    // relativizing one against the other would point the alert at the wrong
    // file rather than at none.
    expect(uriOf("/REPO/docs/guide.md", "/repo")).toEqual({
      uri: "file:///REPO/docs/guide.md",
    });
  });

  it("passes an already-relative posix path straight through", () => {
    expect(uriOf("docs/guide.md")).toEqual({
      uri: "docs/guide.md",
      uriBaseId: "SRCROOT",
    });
  });

  it("relativizes a posix absolute path against a posix root", () => {
    expect(uriOf("/srv/repo/docs/guide.md", "/srv/repo")).toEqual({
      uri: "docs/guide.md",
      uriBaseId: "SRCROOT",
    });
  });

  it("falls back to an absolute file URI for a path outside the root", () => {
    // Still forward-slashed, and with no uriBaseId, because no relative URI
    // reaches it - the honest answer rather than an invented `../` chain.
    expect(uriOf("C:\\elsewhere\\stray.md")).toEqual({
      uri: "file:///C:/elsewhere/stray.md",
    });
  });

  it("does not mistake a sibling directory with a shared prefix for a child", () => {
    expect(uriOf("C:\\repository\\stray.md")).toEqual({
      uri: "file:///C:/repository/stray.md",
    });
  });

  it("keeps that sibling guard when the match is the case-folded one", () => {
    // The trailing slash `normalizeRoot` appends is what stops `share` from
    // swallowing `shareholder`; comparing case-folded must not step around it.
    expect(
      uriOf("\\\\SERVER\\SHAREHOLDER\\stray.md", "\\\\server\\share"),
    ).toEqual({
      uri: "file://SERVER/SHAREHOLDER/stray.md",
    });
  });

  it("percent-encodes what a URI cannot carry raw", () => {
    expect(uriOf("C:\\repo\\docs\\my guide.md").uri).toBe("docs/my%20guide.md");
    expect(uriOf("<stdin>").uri).toBe("%3Cstdin%3E");
  });

  it("declares the run root as originalUriBaseIds, on both path flavours", () => {
    expect(theRun(sarif([file()])).originalUriBaseIds).toEqual({
      SRCROOT: { uri: "file:///C:/repo/" },
    });
    expect(
      theRun(sarif([file()], "/srv/repo")).originalUriBaseIds.SRCROOT.uri,
    ).toBe("file:///srv/repo/");
  });

  it("tolerates a root that already ends in a separator", () => {
    expect(uriOf("C:\\repo\\docs\\guide.md", "C:\\repo\\")).toEqual({
      uri: "docs/guide.md",
      uriBaseId: "SRCROOT",
    });
  });

  it("emits no backslash in any URI anywhere in the document", () => {
    // The ADR's headline failure: a backslashed URI uploads successfully and
    // matches no file, leaving a green check over an empty dashboard.
    const log = sarif(
      [
        file({ file: "C:\\repo\\docs\\guide.md" }),
        file({ file: "docs\\nested\\other.md" }),
        file({ file: "C:\\elsewhere\\stray.md" }),
        file({
          file: "C:\\repo\\legacy\\old.adoc",
          findings: [],
          template: null,
          skipped: "unsupported-format",
          reason: "AsciiDoc is not implemented yet.",
        }),
      ],
      WIN_ROOT,
    );
    const uris = allUris(log);
    expect(uris.length).toBeGreaterThan(0);
    for (const uri of uris) expect(uri).not.toContain("\\");
  });
});
