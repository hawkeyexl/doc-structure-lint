/**
 * The same doctype template, over every implemented format.
 *
 * This is the proof that the parser registry is real rather than decorative.
 * Each format has a pair of fixtures under `test/fixtures/formats/` saying the
 * same thing in its own syntax — one conforming, one with a single defect — and
 * both are linted against the *same* built-in, `tgdp:how-to:1.6`. Identical
 * findings across formats is what "everything downstream of `parse()` operates
 * on the generic tree" means in practice. If a template ever needs per-format
 * special-casing, the content model in ADR 01001 is wrong.
 *
 * The suite is driven by the registry, not by a list: an implemented format
 * without fixtures fails rather than being quietly skipped, so a new parser
 * cannot ship without demonstrating it works against a real template.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PARSERS } from "../../src/parsers/index.js";
import { loadTemplate } from "../../src/core/template-registry.js";
import { validateDocument } from "../../src/core/validator.js";
import type { DocumentParser, Finding } from "../../src/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "..", "fixtures", "formats");

const implemented = PARSERS.filter((p) => p.implemented);

/**
 * A format's fixture, by any of its extensions — XML ships its conforming case
 * as `.dita`, because that is what a real DITA topic is called.
 */
function fixtureFor(parser: DocumentParser, stem: string): string | null {
  for (const ext of [...parser.extensions, ".dita"]) {
    const path = join(fixtures, `${stem}${ext}`);
    if (existsSync(path)) return path;
  }
  return null;
}

function lint(parser: DocumentParser, path: string, template: unknown): Finding[] {
  const tree = parser.parse(readFileSync(path, "utf8"), path);
  return validateDocument(tree, template as Parameters<typeof validateDocument>[1]);
}

describe("every implemented format", () => {
  it("ships a conforming and a non-conforming fixture", () => {
    for (const parser of implemented) {
      expect(fixtureFor(parser, "how-to"), `${parser.name} conforming`).not.toBeNull();
      expect(
        fixtureFor(parser, "how-to-broken"),
        `${parser.name} non-conforming`,
      ).not.toBeNull();
    }
  });
});

describe.each(implemented.map((p) => [p.name, p] as const))(
  "%s against tgdp:how-to:1.6",
  (_name, parser) => {
    it("lints the conforming fixture clean", async () => {
      const path = fixtureFor(parser, "how-to")!;
      const template = await loadTemplate("tgdp:how-to:1.6");
      expect(
        lint(parser, path, template).map((f) => `${f.type}: ${f.message}`),
      ).toEqual([]);
    });

    // Every format's broken fixture carries the same single defect - a missing
    // `See also` - so the finding must be identical down to its message. A
    // format that reports it differently has leaked its own vocabulary into a
    // layer that is supposed to know nothing about formats.
    it("reports the same single finding on the non-conforming fixture", async () => {
      const path = fixtureFor(parser, "how-to-broken")!;
      const template = await loadTemplate("tgdp:how-to:1.6");
      const findings = lint(parser, path, template);

      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({
        type: "missing_section",
        message: 'Missing section "See also"',
        severity: "error",
      });
    });

    it("routes by the type its fixture declares", async () => {
      const path = fixtureFor(parser, "how-to")!;
      const tree = parser.parse(readFileSync(path, "utf8"), path);
      expect(tree.format).toBe(parser.name);
      expect(tree.frontmatter?.["type"]).toBe("how-to");
    });
  },
);
