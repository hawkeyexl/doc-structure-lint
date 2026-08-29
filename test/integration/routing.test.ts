/**
 * Type routing through `runLint`, against real files on disk.
 *
 * `resolve-template.test.ts` pins the precedence chain in isolation. This pins
 * what the chain is for: pointing the tool at a directory of mixed doctypes and
 * having each page checked against the template it claims to be — the thing the
 * pre-rewrite tool could not do at all, because `--template` applied one
 * template to every file.
 */
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runLint } from "../../src/commands/lint.js";

let dir: string;

/** Write a file under the temp dir, creating parents. */
async function file(name: string, content: string): Promise<string> {
  const path = join(dir, name);
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, content);
  return path;
}

const HOW_TO = [
  "# Do the thing",
  "",
  "## Overview",
  "",
  "Why you would.",
  "",
  "## Install it",
  "",
  "Steps.",
  "",
  "## See also",
  "",
  "Links.",
  "",
].join("\n");

const typed = (type: string, body = HOW_TO) => `---\ntype: ${type}\n---\n\n${body}`;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "moose-lint-routing-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("routing a directory of mixed doctypes", () => {
  it("checks each page against the template for what it says it is", async () => {
    await file("guide.md", typed("how-to"));
    await file("notes.md", typed("release-notes", "# Release notes - Widget 1.0\n"));

    const run = await runLint({ inputs: [dir], cwd: dir });

    expect(run.summary).toMatchObject({ checked: 2, passed: 2, failed: 0 });
    expect(run.results.map((r) => r.template).sort()).toEqual([
      "tgdp:how-to:1.6",
      "tgdp:release-notes:1.6",
    ]);
  });

  it("reports against the routed template, not a blanket one", async () => {
    // A how-to missing its Overview. Routed correctly, that is one finding;
    // checked against some other doctype it would be a cascade of noise.
    await file(
      "guide.md",
      typed("how-to", "# Do the thing\n\n## Install it\n\nSteps.\n\n## See also\n"),
    );
    const run = await runLint({ inputs: [dir], cwd: dir });
    // One structural problem, one finding. The pre-rewrite matcher turned this
    // into a cascade, and a too-eager coercion turned it into two.
    expect(run.results[0]!.findings.map((f) => f.type)).toEqual([
      "missing_section",
    ]);
    expect(run.results[0]!.findings[0]!.message).toContain("Overview");
  });
});

describe("a page with no type", () => {
  it("is skipped and does not fail the run", async () => {
    await file("untyped.md", "# Just a page\n\nProse.\n");
    const run = await runLint({ inputs: [dir], cwd: dir });

    expect(run.summary).toMatchObject({ checked: 0, failed: 0, skipped: 1 });
    expect(run.results[0]).toMatchObject({ skipped: "no-template", template: null });
  });

  // The point of skipping: a repo that has typed three pages out of two hundred
  // can adopt the tool today, and the untyped remainder is moose-meta's job.
  it("does not stop its typed neighbours being checked", async () => {
    await file("untyped.md", "# Just a page\n");
    await file("guide.md", typed("how-to"));
    const run = await runLint({ inputs: [dir], cwd: dir });

    expect(run.summary).toMatchObject({ checked: 1, passed: 1, skipped: 1 });
  });
});

describe("a page whose type resolves to nothing", () => {
  it("fails, rather than silently ceasing to be checked", async () => {
    await file("typo.md", typed("how-two", "# Typo\n"));
    const run = await runLint({ inputs: [dir], cwd: dir });

    expect(run.summary).toMatchObject({ checked: 1, failed: 1, skipped: 0 });
    const finding = run.results[0]!.findings[0]!;
    expect(finding.type).toBe("unknown_type");
    expect(finding.message).toContain("how-to");
  });

  it("anchors the finding on the frontmatter that declared it", async () => {
    await file("typo.md", typed("how-two", "# Typo\n"));
    const run = await runLint({ inputs: [dir], cwd: dir });
    expect(run.results[0]!.findings[0]!.position.start.line).toBe(1);
  });
});

describe("user templates", () => {
  const USER_TEMPLATES = [
    "templates:",
    "  house-how-to:",
    "    types: [how-to]",
    "    sections:",
    "      title:",
    "        additionalSections: true",
    "        sections:",
    "          overview:",
    "            heading:",
    "              const: Overview",
    "",
  ].join("\n");

  it("beat a built-in for the same doctype, with no config and no flag", async () => {
    const templates = await file("templates.yaml", USER_TEMPLATES);
    // No `See also`, which the TGDP built-in requires and the house one does not.
    await file(
      "guide.md",
      typed("how-to", "# Do the thing\n\n## Overview\n\nWhy.\n"),
    );

    const run = await runLint({ inputs: [join(dir, "guide.md")], templates, cwd: dir });

    expect(run.results[0]!.template).toBe(`${templates}#house-how-to`);
    expect(run.results[0]!.findings).toEqual([]);
  });

  it("leave doctypes they do not declare on the built-in", async () => {
    const templates = await file("templates.yaml", USER_TEMPLATES);
    await file("notes.md", typed("release-notes", "# Release notes - Widget 1.0\n"));

    const run = await runLint({ inputs: [join(dir, "notes.md")], templates, cwd: dir });
    expect(run.results[0]!.template).toBe("tgdp:release-notes:1.6");
  });
});

describe("overrides in the chain", () => {
  it("let --template override a page's own type", async () => {
    await file("guide.md", typed("how-to"));
    const run = await runLint({
      inputs: [dir],
      template: "tgdp:reference:1.6",
      cwd: dir,
    });
    expect(run.results[0]!.template).toBe("tgdp:reference:1.6");
  });

  it("let a page name its own template with $template", async () => {
    await file(
      "guide.md",
      `---\ntype: how-to\n$template: tgdp:reference:1.6\n---\n\n${HOW_TO}`,
    );
    const run = await runLint({ inputs: [dir], cwd: dir });
    expect(run.results[0]!.template).toBe("tgdp:reference:1.6");
  });
});

describe("--explain", () => {
  it("records the chain without linting", async () => {
    await file("guide.md", typed("how-to"));
    const run = await runLint({ inputs: [dir], explain: true, cwd: dir });

    const steps = run.results[0]!.resolution?.steps ?? [];
    expect(steps.map((s) => s.stage)).toEqual([
      "cli",
      "frontmatter-template",
      "config-override",
      "type",
    ]);
  });

  it("is absent unless asked for, so results stay small", async () => {
    await file("guide.md", typed("how-to"));
    const run = await runLint({ inputs: [dir], cwd: dir });
    expect(run.results[0]!.resolution).toBeUndefined();
  });
});

describe("an unloadable template", () => {
  // One broken template must not abort a run over a whole tree.
  it("is reported against the pages that route to it, not thrown", async () => {
    await file("guide.md", `---\n$template: ./missing.yaml#nope\n---\n\n# A\n`);
    const run = await runLint({ inputs: [dir], cwd: dir });

    expect(run.results[0]!.findings[0]!.type).toBe("template_error");
    expect(run.summary.failed).toBe(1);
  });
});
