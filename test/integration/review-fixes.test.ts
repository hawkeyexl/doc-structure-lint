/**
 * Regressions found by review, each pinned by the case that exposed it.
 *
 * These are grouped rather than scattered because they share a property worth
 * keeping visible: every one of them passed the suite that existed at the time.
 * Most were silent - a wrong template, an unapplied policy, a page skipped -
 * and the run still exited 0. Where a fix changed behavior the test says which
 * behavior and why.
 */
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runLint } from "../../src/commands/lint.js";
import { matchSections } from "../../src/core/match.js";
import { markdownParser } from "../../src/parsers/markdown.js";
import { htmlParser } from "../../src/parsers/html.js";
import { xmlParser } from "../../src/parsers/xml.js";
import { asciidocParser } from "../../src/parsers/asciidoc.js";
import { rstParser } from "../../src/parsers/rst.js";
import { validateDocument } from "../../src/core/validator.js";
import { refRelativeTo } from "../../src/core/template-registry.js";
import type { Template } from "../../src/core/template.js";

let dir: string;

async function file(name: string, content: string): Promise<string> {
  const path = join(dir, name);
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, content);
  return path;
}

const HOW_TO =
  "# Do the thing\n\n## Overview\n\nWhy.\n\n## Install it\n\nHow.\n\n## See also\n\nLinks.\n";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "moose-lint-review-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("the matcher does not strand sections a later rule needs", () => {
  const subsectionsOf = (md: string) =>
    markdownParser.parse(md, "t.md").sections[0]!.sections;

  // An optional rule's forward scan used to run unbounded, marking everything
  // between the cursor and its match as extra - including the section a later
  // required rule was going to match. One misplaced heading then produced four
  // findings, with `See also` reported as BOTH missing and unexpected.
  it("reports one finding for a misplaced optional section", () => {
    const doc = subsectionsOf(
      "# T\n\n## Overview\n\n## Install it\n\n## See also\n\n## Before you start\n",
    );
    const { findings } = matchSections(doc, {
      overview: { heading: { const: "Overview" } },
      "before you start": {
        heading: { const: "Before you start" },
        required: false,
      },
      task: {},
      "see also": { heading: { const: "See also" } },
    });

    expect(findings.map((f) => f.type)).toEqual(["unexpected_section"]);
    expect(findings[0]!.message).toContain("Before you start");
  });

  // The anchored `repeat` loop omitted the `claimedLater` guard the slot branch
  // has, so a repeating rule consumed the section a later anchored rule needed
  // and then validated it against its own subsection rules.
  it("stops a repeating rule at a section a later rule claims", () => {
    const doc = subsectionsOf(
      "# T\n\n## Symptom A\n\n## Symptom B\n\n## Symptom summary\n",
    );
    const { matches, findings } = matchSections(doc, {
      symptom: { heading: { pattern: "^Symptom" }, repeat: true },
      resolution: { heading: { const: "Symptom summary" } },
    });

    expect(findings).toEqual([]);
    expect(
      matches.filter((m) => m.name === "symptom").map((m) => m.section.title),
    ).toEqual(["Symptom A", "Symptom B"]);
  });
});

describe("a run that checks nothing", () => {
  // Exiting 0 here is a permanently green CI job over a docset nothing looked
  // at. The guard that used to cover it tested the type index before any file
  // was read, and could never fire.
  it("fails rather than reporting a clean run", async () => {
    await file("a.md", "# No type\n");
    await expect(runLint({ inputs: [dir], cwd: dir })).rejects.toThrow(
      /Nothing was checked/,
    );
  });
});

describe("a broken template is contained, not fatal", () => {
  // `heading.pattern` is author text compiled with `new RegExp`, and
  // `validateDocument` was the one call in `lintOne` with no try - so one bad
  // pattern aborted the whole run and the other pages were never reported.
  it("reports an uncompilable pattern against the pages that route to it", async () => {
    const templates = await file(
      "bad.yaml",
      [
        "templates:",
        "  bad:",
        "    types: [bad]",
        "    sections:",
        "      title:",
        "        heading:",
        '          pattern: "Step ("',
        "",
      ].join("\n"),
    );
    await file("a.md", "---\ntype: bad\n---\n\n# A\n");
    await file("b.md", `---\ntype: how-to\n---\n\n${HOW_TO}`);

    const run = await runLint({ inputs: [dir], templates, cwd: dir });
    const bad = run.results.find((r) => r.file.endsWith("a.md"))!;
    const good = run.results.find((r) => r.file.endsWith("b.md"))!;

    expect(bad.findings[0]!.type).toBe("template_error");
    expect(bad.findings[0]!.message).toContain("Invalid pattern");
    // The point: the other page still got linted.
    expect(good.success).toBe(true);
  });
});

describe("template refs resolve against the file that declared them", () => {
  it("leaves built-in ids, URLs, and absolute paths alone", () => {
    expect(refRelativeTo("/a/b/t.yaml", "tgdp:how-to:1.6")).toBe(
      "tgdp:how-to:1.6",
    );
    expect(refRelativeTo("/a/b/t.yaml", "https://x/y.yaml")).toBe(
      "https://x/y.yaml",
    );
  });

  it("re-bases a relative ref onto the declaring file's directory", () => {
    const rebased = refRelativeTo(join(dir, "tpl", "child.yaml"), "./base.yaml#b");
    expect(rebased.replace(/\\/g, "/")).toContain("tpl/base.yaml#b");
  });

  // `.then(resolveExtends)` passes one argument, so the injected resolver was
  // dropped and `extends: ./base.yaml` was looked for at the process cwd.
  it("resolves a relative extends from a subdirectory", async () => {
    await file(
      "tpl/base.yaml",
      [
        "templates:",
        "  base:",
        "    sections:",
        "      title:",
        "        additionalSections: true",
        "",
      ].join("\n"),
    );
    const child = await file(
      "tpl/child.yaml",
      [
        "templates:",
        "  child:",
        "    types: [child]",
        "    extends: ./base.yaml#base",
        "",
      ].join("\n"),
    );
    await file("page.md", "---\ntype: child\n---\n\n# T\n\n## Anything\n");

    const run = await runLint({
      inputs: [join(dir, "page.md")],
      templates: child,
      cwd: process.cwd(),
    });
    expect(run.results[0]!.findings).toEqual([]);
  });

  // A template inheriting `types` through `extends` declares none of its own,
  // so reading the raw file routed nothing to it while the page silently went
  // to the built-in it meant to replace.
  it("routes by types inherited through extends", async () => {
    const templates = await file(
      "house.yaml",
      [
        "templates:",
        "  house:",
        "    extends: tgdp:how-to:1.6",
        "    sections:",
        "      title:",
        "        sections:",
        "          see also:",
        "            required: false",
        "",
      ].join("\n"),
    );
    // No `See also`, which the built-in requires and the child relaxes.
    await file("page.md", "---\ntype: how-to\n---\n\n# T\n\n## Overview\n\nW.\n\n## Do it\n\nH.\n");

    const run = await runLint({
      inputs: [join(dir, "page.md")],
      templates,
      cwd: dir,
    });
    expect(run.results[0]!.template).toBe(`${templates}#house`);
    expect(run.results[0]!.findings).toEqual([]);
  });
});

describe("a bare list item counts the same in every format", () => {
  // mdast puts a list item's principal text in a paragraph child; HTML and XML
  // iterated element children only, so `<li>text</li>` had none and
  // `lists.items.paragraphs.min` meant different things per format.
  const template: Template = {
    sections: {
      title: {
        sections: {
          steps: { lists: { min: 1, items: { min: 1, paragraphs: { min: 1 } } } },
        },
      },
    },
  };

  it("agrees across markdown, html, xml, asciidoc, and rst", () => {
    const trees = [
      markdownParser.parse("# T\n\n## Steps\n\n- one\n- two\n", "a.md"),
      htmlParser.parse(
        "<html><body><h1>T</h1><h2>Steps</h2><ul><li>one</li><li>two</li></ul></body></html>",
        "a.html",
      ),
      xmlParser.parse(
        '<topic id="t"><title>T</title><body><section><title>Steps</title><ul><li>one</li><li>two</li></ul></section></body></topic>',
        "a.dita",
      ),
      asciidocParser.parse("= T\n\n== Steps\n\n* one\n* two\n", "a.adoc"),
      rstParser.parse("T\n=\n\nSteps\n-----\n\n- one\n- two\n", "a.rst"),
    ];

    for (const tree of trees) {
      expect(
        validateDocument(tree, template).map((f) => f.type),
        tree.format,
      ).toEqual([]);
    }
  });
});

describe("metadata is read from both a fence and the format's own header", () => {
  // docmeta's AsciiDoc and reStructuredText extractors return the fence and
  // stop, so a page carrying both lost its native `:type:` and was skipped.
  it("keeps `type` when an AsciiDoc page also has a fence", () => {
    const tree = asciidocParser.parse(
      "---\naudience: admins\n---\n= Title\n:type: how-to\n\nBody.\n",
      "a.adoc",
    );
    expect(tree.frontmatter).toMatchObject({
      type: "how-to",
      audience: "admins",
    });
  });

  it("keeps `type` when a reStructuredText page also has a fence", () => {
    const tree = rstParser.parse(
      "---\naudience: admins\n---\n:type: how-to\n\nTitle\n=====\n\nBody.\n",
      "a.rst",
    );
    expect(tree.frontmatter).toMatchObject({
      type: "how-to",
      audience: "admins",
    });
  });

  // A BOM makes parse5 synthesize a `<head>` with no source location, which
  // nulled the position and silently switched off the synthetic title - so the
  // document lost its top-level section entirely.
  it("keeps the synthetic title on an HTML page with a BOM", () => {
    const doc =
      '<!DOCTYPE html><html><head><meta name="type" content="how-to"><title>T</title></head><body><h2>Overview</h2><p>x</p></body></html>';
    for (const source of [doc, `﻿${doc}`]) {
      const tree = htmlParser.parse(source, "a.html");
      expect(tree.sections.map((s) => `L${s.level}:${s.title}`)).toEqual([
        "L1:T",
      ]);
    }
  });
});

describe("a directory whose name contains glob metacharacters", () => {
  // The path was interpolated into a fast-glob pattern unescaped, so an
  // ordinary Windows directory matched nothing and the run exited 2 claiming
  // the directory was empty.
  it("is walked, not treated as a pattern", async () => {
    await file("docs (2024)/a.md", `---\ntype: how-to\n---\n\n${HOW_TO}`);
    const run = await runLint({ inputs: ["docs (2024)"], cwd: dir });
    expect(run.summary).toMatchObject({ checked: 1, passed: 1 });
  });
});
