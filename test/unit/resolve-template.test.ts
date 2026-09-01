import { describe, expect, it } from "vitest";
import {
  buildTypeIndex,
  knownTypes,
  resolveTemplateRef,
  type TypeIndexEntry,
} from "../../src/core/resolve-template.js";
import type { TemplateFile } from "../../src/core/template.js";

const index = (entries: Record<string, TypeIndexEntry>) =>
  new Map(Object.entries(entries));

const userFile = (templates: TemplateFile["templates"]): TemplateFile => ({
  templates,
});

describe("buildTypeIndex", () => {
  it("maps each doctype a built-in serves to that built-in", () => {
    const built = buildTypeIndex({
      builtins: [
        { id: "tgdp:how-to:1.6", types: ["how-to"] },
        { id: "tgdp:concept:1.6", types: ["concept", "explanation"] },
      ],
    });
    expect(built.get("how-to")).toEqual({
      ref: "tgdp:how-to:1.6",
      source: "builtin",
    });
    // One template can serve two names for the same shape.
    expect(built.get("explanation")?.ref).toBe("tgdp:concept:1.6");
  });

  // Dropping a template file in the repo with `types:` on it is the whole
  // mechanism: no config entry, no flag.
  it("routes a doctype to a user template that declares it", () => {
    const built = buildTypeIndex({
      userFiles: [
        {
          ref: "./templates.yaml",
          file: userFile({ "api-operation": { types: ["api-operation"] } }),
        },
      ],
    });
    expect(built.get("api-operation")).toEqual({
      ref: "./templates.yaml#api-operation",
      source: "user",
    });
  });

  it("lets a user template override a built-in for the same doctype", () => {
    const built = buildTypeIndex({
      builtins: [{ id: "tgdp:how-to:1.6", types: ["how-to"] }],
      userFiles: [
        { ref: "./mine.yaml", file: userFile({ "how-to": { types: ["how-to"] } }) },
      ],
    });
    expect(built.get("how-to")).toEqual({
      ref: "./mine.yaml#how-to",
      source: "user",
    });
  });

  it("ignores templates that declare no doctype", () => {
    const built = buildTypeIndex({
      userFiles: [{ ref: "./t.yaml", file: userFile({ Sample: {} }) }],
    });
    expect(built.size).toBe(0);
  });

  it("lets a later user file win", () => {
    const built = buildTypeIndex({
      userFiles: [
        { ref: "./a.yaml", file: userFile({ x: { types: ["how-to"] } }) },
        { ref: "./b.yaml", file: userFile({ y: { types: ["how-to"] } }) },
      ],
    });
    expect(built.get("how-to")?.ref).toBe("./b.yaml#y");
  });
});

describe("resolveTemplateRef precedence", () => {
  const typeIndex = index({
    "how-to": { ref: "tgdp:how-to:1.6", source: "builtin" },
    reference: { ref: "tgdp:reference:1.6", source: "builtin" },
  });

  it("puts --template above everything", () => {
    const r = resolveTemplateRef({
      filePath: "docs/a.md",
      frontmatter: { type: "how-to", $template: "./x.yaml#y" },
      cliTemplate: "./cli.yaml#z",
      overrides: [{ files: "docs/**", template: "./o.yaml#o" }],
      typeIndex,
      defaultTemplate: "./d.yaml#d",
    });
    expect(r).toMatchObject({ ref: "./cli.yaml#z", stage: "cli" });
  });

  it("puts a page's $template above repo policy and its own type", () => {
    const r = resolveTemplateRef({
      filePath: "docs/a.md",
      frontmatter: { type: "how-to", $template: "./x.yaml#y" },
      overrides: [{ files: "docs/**", template: "./o.yaml#o" }],
      typeIndex,
    });
    expect(r).toMatchObject({ ref: "./x.yaml#y", stage: "frontmatter-template" });
  });

  it("puts a matching override above the page's type", () => {
    const r = resolveTemplateRef({
      filePath: "docs/api/get.md",
      frontmatter: { type: "how-to" },
      overrides: [{ files: "docs/api/**", template: "tgdp:reference:1.6" }],
      typeIndex,
    });
    expect(r).toMatchObject({ ref: "tgdp:reference:1.6", stage: "config-override" });
  });

  it("takes the first matching override, not the best one", () => {
    const r = resolveTemplateRef({
      filePath: "docs/api/get.md",
      frontmatter: null,
      overrides: [
        { files: "docs/**", template: "first" },
        { files: "docs/api/**", template: "second" },
      ],
      typeIndex,
    });
    expect(r.ref).toBe("first");
  });

  it("matches override globs against a Windows path", () => {
    const r = resolveTemplateRef({
      filePath: "docs\\api\\get.md",
      frontmatter: null,
      overrides: [{ files: "docs/api/**", template: "tgdp:reference:1.6" }],
      typeIndex,
    });
    expect(r.ref).toBe("tgdp:reference:1.6");
  });

  it("routes by the page's type when nothing above it applies", () => {
    const r = resolveTemplateRef({
      filePath: "docs/a.md",
      frontmatter: { type: "how-to" },
      typeIndex,
    });
    expect(r).toMatchObject({ ref: "tgdp:how-to:1.6", stage: "type" });
  });

  it("falls back to a configured default for an untyped page", () => {
    const r = resolveTemplateRef({
      filePath: "docs/a.md",
      frontmatter: { title: "A" },
      typeIndex,
      defaultTemplate: "./d.yaml#d",
    });
    expect(r).toMatchObject({ ref: "./d.yaml#d", stage: "config-default" });
  });

  it("ignores a non-string type or $template", () => {
    const r = resolveTemplateRef({
      filePath: "docs/a.md",
      frontmatter: { type: ["how-to"], $template: 42 },
      typeIndex,
    });
    expect(r.ref).toBeNull();
    expect(r.cause).toBe("no-type");
  });
});

describe("a page that declares no doctype", () => {
  // An untyped page is moose-meta's complaint - its OKF schema already requires
  // `type`. Skipping rather than failing is what lets moose-lint be pointed at
  // a whole tree on day one.
  it("is skipped, not failed", () => {
    const r = resolveTemplateRef({
      filePath: "docs/a.md",
      frontmatter: null,
      typeIndex: index({ "how-to": { ref: "x", source: "builtin" } }),
    });
    expect(r.ref).toBeNull();
    expect(r.cause).toBe("no-type");
  });
});

describe("a page that declares a doctype nothing serves", () => {
  const typeIndex = index({
    "how-to": { ref: "tgdp:how-to:1.6", source: "builtin" },
    tutorial: { ref: "tgdp:tutorial:1.6", source: "builtin" },
    reference: { ref: "tgdp:reference:1.6", source: "builtin" },
  });

  // A typo must not silently stop a page being checked - the one outcome worse
  // than a false positive.
  it("is an unknown type, not a skip", () => {
    const r = resolveTemplateRef({
      filePath: "docs/a.md",
      frontmatter: { type: "how-two" },
      typeIndex,
    });
    expect(r.ref).toBeNull();
    expect(r.cause).toBe("unknown-type");
    expect(r.unknownType).toBe("how-two");
  });

  it("suggests the near misses", () => {
    const r = resolveTemplateRef({
      filePath: "docs/a.md",
      frontmatter: { type: "how-two" },
      typeIndex,
    });
    expect(r.suggestions).toContain("how-to");
  });

  it("suggests nothing for a type that resembles nothing known", () => {
    const r = resolveTemplateRef({
      filePath: "docs/a.md",
      frontmatter: { type: "changelog" },
      typeIndex,
    });
    expect(r.suggestions).toEqual([]);
  });

  it("lists known doctypes in sorted order for the caller to report", () => {
    expect(knownTypes(typeIndex)).toEqual(["how-to", "reference", "tutorial"]);
  });
});

describe("the resolution record", () => {
  // "Why was this page linted with that template?" should never require
  // reading the source.
  it("records every stage that was consulted, in order", () => {
    const r = resolveTemplateRef({
      filePath: "docs/a.md",
      frontmatter: { type: "how-to" },
      typeIndex: index({ "how-to": { ref: "tgdp:how-to:1.6", source: "builtin" } }),
    });
    expect(r.steps.map((s) => s.stage)).toEqual([
      "cli",
      "frontmatter-template",
      "config-override",
      "type",
    ]);
    expect(r.steps.at(-1)).toMatchObject({
      stage: "type",
      ref: "tgdp:how-to:1.6",
    });
  });

  it("stops recording at the stage that decided", () => {
    const r = resolveTemplateRef({
      filePath: "docs/a.md",
      frontmatter: { type: "how-to" },
      cliTemplate: "./x.yaml#y",
      typeIndex: index({ "how-to": { ref: "tgdp:how-to:1.6", source: "builtin" } }),
    });
    expect(r.steps.map((s) => s.stage)).toEqual(["cli"]);
  });

  it("says which source the type resolved through", () => {
    const r = resolveTemplateRef({
      filePath: "docs/a.md",
      frontmatter: { type: "how-to" },
      typeIndex: index({ "how-to": { ref: "./mine.yaml#h", source: "user" } }),
    });
    expect(r.steps.at(-1)?.detail).toContain("user");
  });
});
