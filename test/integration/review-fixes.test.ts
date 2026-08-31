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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runLint } from "../../src/commands/lint.js";
import { matchSections } from "../../src/core/match.js";
import { markdownParser } from "../../src/parsers/markdown.js";
import { htmlParser } from "../../src/parsers/html.js";
import { xmlParser } from "../../src/parsers/xml.js";
import { asciidocParser } from "../../src/parsers/asciidoc.js";
import { rstParser } from "../../src/parsers/rst.js";
import { validateDocument } from "../../src/core/validator.js";
import { refRelativeTo } from "../../src/core/template-registry.js";
import { fencedPosition } from "../../src/parsers/metadata.js";
import type { Template } from "../../src/core/template.js";
import type { DocumentTree, ListItemNode } from "../../src/types.js";

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

  // The bounded scan tested `headingMatches` before `claimedLater`, so a
  // section satisfying both rules went to whichever came first in the template.
  // A loose rule reaching a heading a stricter later rule names exactly took
  // it, and that rule then reported missing - the cascade, one section earlier
  // than the case above.
  it("does not let a loose rule take a heading a later exact rule names", () => {
    const doc = subsectionsOf("# T\n\n## Symptom summary\n");
    const { matches, findings } = matchSections(doc, {
      symptom: { heading: { pattern: "^Symptom" }, required: false, repeat: true },
      resolution: { heading: { const: "Symptom summary" } },
    });

    expect(findings).toEqual([]);
    expect(matches.map((m) => m.name)).toEqual(["resolution"]);
  });

  // The other direction of the same guard, and the reason it is asymmetric.
  // Yielding to any later rule would make a required rule stand aside for an
  // optional one, giving up the section it needs for a match the template says
  // it can do without - a clean document reporting a missing section.
  it("does not make a required rule yield to an optional later one", () => {
    const doc = subsectionsOf("# T\n\n## Symptom summary\n");
    const { matches, findings } = matchSections(doc, {
      symptom: { heading: { pattern: "^Symptom" } },
      summary: { heading: { const: "Symptom summary" }, required: false },
    });

    expect(findings).toEqual([]);
    expect(matches.map((m) => m.name)).toEqual(["symptom"]);
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

  // The guard fires on any skip but described routing only, so a run over a
  // format no parser claims was told to add a `type:` key - advice that cannot
  // change the outcome, since the tool could not read the file either way.
  it("names the cause it actually hit, not just routing", async () => {
    const unsupported = await file("notes.xyz", "whatever\n");

    const message = await runLint({ inputs: [unsupported], cwd: dir }).then(
      () => "resolved",
      (err: Error) => err.message,
    );

    expect(message).toContain("Nothing was checked");
    expect(message).toContain("--as");
    expect(message).not.toContain('"type:"');
  });

  it("still gives routing advice when that is the cause", async () => {
    await file("a.md", "# No type\n");
    const message = await runLint({ inputs: [dir], cwd: dir }).then(
      () => "resolved",
      (err: Error) => err.message,
    );

    expect(message).toContain('"type:"');
    expect(message).not.toContain("--as");
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

  // A URL base fell through to "return unchanged", so the next load classified
  // `./base.yaml` as a file and read it from the process working directory - a
  // local file quietly standing in for the remote one.
  it("re-bases a relative ref declared by a URL template onto that URL", () => {
    expect(refRelativeTo("https://x.test/t/child.yaml", "./base.yaml")).toBe(
      "https://x.test/t/base.yaml",
    );
    expect(refRelativeTo("https://x.test/t/child.yaml#c", "../base.yaml#b")).toBe(
      "https://x.test/base.yaml#b",
    );
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

  // The same rule, one level down. `<li>Parent<ul>…</ul></li>` has a child, so
  // the "no children" test that reconciled the bare case saw nothing to fix and
  // `Parent` became prose nothing counted - while mdast gives the item both a
  // paragraph and the nested list.
  it("counts an item's own prose even when the item also nests a list", () => {
    const paragraphsOfFirstItem = (tree: DocumentTree): number => {
      const list = tree.sections[0]!.sections[0]!.content.find(
        (c) => c.kind === "list",
      );
      const item = (list as { items: ListItemNode[] }).items[0]!;
      return item.children.filter((c) => c.kind === "paragraph").length;
    };

    const md = markdownParser.parse(
      "# T\n\n## Steps\n\n- Parent\n  - nested\n",
      "a.md",
    );
    const html = htmlParser.parse(
      "<html><body><h1>T</h1><h2>Steps</h2><ul><li>Parent<ul><li>nested</li></ul></li></ul></body></html>",
      "a.html",
    );

    // XML had the same defect, found only after the HTML one was fixed - the
    // two parsers reconciled the bare item separately and both stopped there.
    const xml = xmlParser.parse(
      '<topic id="t"><title>T</title><body><section><title>Steps</title>' +
        "<ul><li>Parent<ul><li>nested</li></ul></li></ul></section></body></topic>",
      "a.dita",
    );

    expect(paragraphsOfFirstItem(md)).toBe(1);
    expect(paragraphsOfFirstItem(html)).toBe(paragraphsOfFirstItem(md));
    expect(paragraphsOfFirstItem(xml)).toBe(paragraphsOfFirstItem(md));
  });

  // The trap in the obvious fix: the item's flattened text includes the nested
  // list's, so pushing it wholesale would count "nested" as the parent's prose.
  it("does not fold a nested item's text into the parent's paragraph", () => {
    const parentProse = (tree: DocumentTree): string => {
      const list = tree.sections[0]!.sections[0]!.content.find(
        (c) => c.kind === "list",
      );
      const item = (list as { items: ListItemNode[] }).items[0]!;
      const paragraph = item.children.find((c) => c.kind === "paragraph");
      return (paragraph as { text: string }).text;
    };

    for (const tree of [
      markdownParser.parse("# T\n\n## Steps\n\n- Parent\n  - nested\n", "a.md"),
      htmlParser.parse(
        "<html><body><h1>T</h1><h2>Steps</h2><ul><li>Parent<ul><li>nested</li></ul></li></ul></body></html>",
        "a.html",
      ),
      xmlParser.parse(
        '<topic id="t"><title>T</title><body><section><title>Steps</title>' +
          "<ul><li>Parent<ul><li>nested</li></ul></li></ul></section></body></topic>",
        "a.dita",
      ),
    ]) {
      expect(parentProse(tree), tree.format).toBe("Parent");
    }
  });

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

describe("the span of a metadata fence", () => {
  // The end column was fixed at 1, which is right only when the block ends with
  // a newline. A page whose closing fence is the last thing in the file got an
  // end that pointed at the start of the fence line while `offset` pointed past
  // it - the two disagreeing, on the position every synthetic H1 is anchored to.
  it("ends past the closing delimiter when the file ends without a newline", () => {
    const withNewline = "---\ntype: how-to\n---\n";
    const withoutNewline = "---\ntype: how-to\n---";

    const a = fencedPosition(withNewline)!;
    const b = fencedPosition(withoutNewline)!;

    expect(a.end.offset).toBe(withNewline.length);
    expect(a.end).toMatchObject({ line: 4, column: 1 });

    expect(b.end.offset).toBe(withoutNewline.length);
    expect(b.end).toMatchObject({ line: 3, column: 4 });
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

describe("a bare --template filename names a file", () => {
  // `--template custom.yaml --templates routes.yaml` classified `custom.yaml`
  // as a file but found no path separator in it, so it became
  // `routes.yaml#custom.yaml` and looked for a template of that name.
  it("is not rewritten into a fragment of --templates", async () => {
    const custom = await file(
      "custom.yaml",
      [
        "templates:",
        "  only:",
        "    sections:",
        "      title:",
        "        additionalSections: true",
        "",
      ].join("\n"),
    );
    const routes = await file(
      "routes.yaml",
      [
        "templates:",
        "  other:",
        "    types: [other]",
        "    sections:",
        "      title:",
        "        additionalSections: true",
        "",
      ].join("\n"),
    );
    await file("page.md", "# T\n\n## Anything\n");

    const run = await runLint({
      inputs: [join(dir, "page.md")],
      template: custom,
      templates: routes,
      cwd: dir,
    });
    expect(run.results[0]!.template).toBe(custom);
    expect(run.results[0]!.findings).toEqual([]);
  });
});

describe("a file no parser claims is skipped without being opened", () => {
  // The read ran before the parser lookup, so a file the run was always going
  // to skip was loaded into memory anyway - and when that read failed, the
  // exception left the loop. One `.xyz` the process could not open (a denied
  // permission, a file a doc build moved mid-run) therefore aborted the whole
  // run with exit 2 and no report at all, where it owed a skip line for that
  // file and a verdict for every other page.
  //
  // The denial is injected rather than staged on disk because no fixture
  // produces it on every platform: `resolveTargets` walks a directory instead
  // of handing it to the loop, so EISDIR never reaches this code, and `chmod`
  // does not deny a read on Windows.
  it("reports an unreadable one as a skip and still lints its siblings", async () => {
    const denied = await file("notes.xyz", "not a document");
    const page = await file("page.md", `---\ntype: how-to\n---\n\n${HOW_TO}`);

    vi.resetModules();
    vi.doMock("node:fs/promises", async () => {
      const real =
        await vi.importActual<typeof import("node:fs/promises")>(
          "node:fs/promises",
        );
      return {
        ...real,
        readFile: async (path: string | URL, encoding: "utf8") => {
          // Only this one path is denied. Every other read - the built-in
          // template the sibling routes to, among them - has to go through, or
          // the test would pass for the wrong reason.
          if (path === denied) {
            throw Object.assign(
              new Error(`EACCES: permission denied, open '${denied}'`),
              { code: "EACCES" },
            );
          }
          return real.readFile(path, encoding);
        },
      };
    });

    try {
      const { runLint: lintWithDeniedRead } = await import(
        "../../src/commands/lint.js"
      );
      const run = await lintWithDeniedRead({
        inputs: [denied, page],
        cwd: dir,
      });

      const skipped = run.results.find((r) => r.file.endsWith("notes.xyz"))!;
      expect(skipped.skipped).toBe("unsupported-format");
      expect(skipped.reason).toContain('no parser is registered for ".xyz"');
      // The point: the run got past it.
      expect(run.results.find((r) => r.file.endsWith("page.md"))!.success).toBe(
        true,
      );
      expect(run.summary).toMatchObject({ checked: 1, passed: 1, skipped: 1 });
    } finally {
      vi.doUnmock("node:fs/promises");
      vi.resetModules();
    }
  });
});
