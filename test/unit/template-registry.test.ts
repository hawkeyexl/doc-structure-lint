import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { dereference } from "@apidevtools/json-schema-ref-parser";
import {
  classifyRef,
  listBuiltins,
  loadTemplate,
  loadTemplateFile,
  resolveExtends,
  validateTemplateFile,
  type TemplateResolver,
} from "../../src/core/template-registry.js";
import { isRequired, isSlot, type Template } from "../../src/core/template.js";
import { MooseLintError } from "../../src/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "..", "fixtures", "templates");
const repoRoot = join(here, "..", "..");

/** The message of the `MooseLintError` a rejected promise carries. */
async function rejectionMessage(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(MooseLintError);
    return (err as Error).message;
  }
  throw new Error("expected the call to reject, but it resolved");
}

/** The message of the `MooseLintError` a synchronous call throws. */
function thrownMessage(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(MooseLintError);
    return (err as Error).message;
  }
  throw new Error("expected the call to throw, but it returned");
}

describe("classifyRef", () => {
  it("classifies a built-in id", () => {
    expect(classifyRef("tgdp:how-to:1").kind).toBe("builtin");
    // A hyphenated segment must still classify as a built-in, not a file.
    expect(classifyRef("moose-lint:how-to:1").kind).toBe("builtin");
    expect(classifyRef("tgdp:how-to:1").ref).toBe("tgdp:how-to:1");
  });

  it("classifies an http(s) url", () => {
    expect(classifyRef("https://example.com/templates.yaml").kind).toBe("url");
    expect(classifyRef("http://example.com/templates.yaml").kind).toBe("url");
  });

  it("classifies a path as a file", () => {
    expect(classifyRef("./templates.yaml").kind).toBe("file");
    expect(classifyRef("templates/how-to.yaml").kind).toBe("file");
    expect(classifyRef("../a/b.json").kind).toBe("file");
  });

  it("never classifies a Windows path as a built-in", () => {
    expect(classifyRef("C:\\Users\\me\\templates.yaml").kind).toBe("file");
    // No extension either: the backslash alone has to be enough.
    expect(classifyRef("C:\\Users\\me\\templates").kind).toBe("file");
    expect(classifyRef("C:").kind).toBe("file");
  });

  it("classifies a bare template filename as a file, not a built-in", () => {
    // No path separator, so only the extension keeps these out of the
    // built-in namespace.
    expect(classifyRef("templates.yaml").kind).toBe("file");
    expect(classifyRef("templates.yml").kind).toBe("file");
    expect(classifyRef("templates.json").kind).toBe("file");
  });
});

describe("built-ins", () => {
  it("lists every entry in the manifest", () => {
    const builtins = listBuiltins();
    expect(builtins.length).toBeGreaterThan(0);
    for (const builtin of builtins) {
      expect(builtin.id).toMatch(/^[a-z0-9-]+:[a-z0-9-]+:[\d.]+$/);
      expect(builtin.title).not.toBe(builtin.id);
      expect(builtin.types.length).toBeGreaterThan(0);
    }
  });

  it("loads a built-in through the same schema validation as a user file", async () => {
    const [first] = listBuiltins();
    const template = await loadTemplate(first!.id);
    expect(template.types).toEqual(first!.types);
    expect(Object.keys(template.sections ?? {}).length).toBeGreaterThan(0);
  });

  it("caches a built-in rather than re-reading it", async () => {
    const [first] = listBuiltins();
    expect(await loadTemplate(first!.id)).toBe(await loadTemplate(first!.id));
  });

  it("errors on an unknown built-in id, listing what is available", async () => {
    // A real vendor and slug with the wrong version: the near miss is the case
    // worth getting right.
    const message = await rejectionMessage(loadTemplate("tgdp:how-to:9.9"));
    expect(message).toContain('Unknown built-in template "tgdp:how-to:9.9"');
    expect(message).toContain("tgdp:how-to:1.6");
  });

  it("refuses to load a built-in id as a file", async () => {
    const message = await rejectionMessage(loadTemplateFile("tgdp:how-to:1.6"));
    expect(message).toContain("built-in template id, not a template file");
  });

  // The fragment was stripped and then ignored, so this loaded the built-in
  // and succeeded - a configuration error silently selecting a different
  // reference than the author wrote, which is the failure the `Object.hasOwn`
  // guard below exists to prevent one ref-kind over.
  it("rejects a fragment on a built-in id rather than ignoring it", async () => {
    const message = await rejectionMessage(loadTemplate("tgdp:how-to:1.6#typo"));
    expect(message).toContain("#typo");
    expect(message).toContain("tgdp:how-to:1.6");
  });

  it("still loads the same id without a fragment", async () => {
    const template = await loadTemplate("tgdp:how-to:1.6");
    expect(template.sections).toBeDefined();
  });
});

describe("loadTemplateFile", () => {
  it("loads a yaml file and leaves unstated booleans unstated", async () => {
    const file = await loadTemplateFile(join(fixtures, "single.yaml"));
    const overview = file.templates?.["how-to"]?.sections?.["overview"];
    expect(overview?.heading?.const).toBe("Overview");
    // Deliberately NOT defaulted to `true` at load time: a written-in default
    // wins the `extends` merge and would reset an inherited `required: false`.
    // "Required unless stated" is `isRequired`'s job, not the loader's.
    expect(overview?.required).toBeUndefined();
    expect(isRequired(overview!)).toBe(true);
    expect(file.templates?.["how-to"]?.sections?.["before you start"]?.required).toBe(false);
  });

  it("loads a json file", async () => {
    const file = await loadTemplateFile(join(fixtures, "single.json"));
    expect(file.templates?.["concept"]?.types).toEqual(["concept"]);
  });

  it("reports a missing file by name", async () => {
    const message = await rejectionMessage(loadTemplateFile(join(fixtures, "nope.yaml")));
    expect(message).toContain("Template file not found");
    expect(message).toContain("nope.yaml");
  });

  it("names the source and the instance path of a schema error", async () => {
    const source = join(fixtures, "invalid.yaml");
    const message = await rejectionMessage(loadTemplateFile(source));
    // The pre-rewrite loader threw a bare "Template is invalid" here.
    expect(message).toContain(source);
    expect(message).toContain("/templates/how-to/sections/overview");
    expect(message).toContain("must NOT have additional properties");
    expect(message).toContain("paragrafs");
  });
});

describe("`instructions` migration", () => {
  it("replaces the raw schema error with a migration message", async () => {
    const source = join(fixtures, "instructions.yaml");
    const message = await rejectionMessage(loadTemplateFile(source));

    expect(message).toContain(source);
    expect(message).toContain('"templates.how-to.sections.title" uses `instructions`');
    expect(message).toContain("moose-lint no longer evaluates");
    expect(message).toContain("moose-docevals assertion eval in moose.config.yaml");
    // The eval snippet, with the author's own instruction in it.
    expect(message).toContain("  docevals:");
    expect(message).toContain("    evals:");
    expect(message).toContain("      how-to-title:");
    expect(message).toContain("        assertion: Must mention the intent of the document");
    expect(message).toContain("        grader: ai");
    // And none of Ajv's useless "must NOT be valid" for the `not` keyword.
    expect(message).not.toContain("must NOT be valid");
  });

  it("catches `instructions` wherever it sits in the file", () => {
    const message = thrownMessage(() =>
      validateTemplateFile(
        {
          templates: {
            Sample: {
              sections: {
                Introduction: {
                  sections: { Setup: { instructions: ["Explain the prerequisites"] } },
                },
              },
            },
          },
        },
        "nested.yaml",
      ),
    );
    expect(message).toContain('"templates.Sample.sections.Introduction.sections.Setup"');
    expect(message).toContain("      sample-introduction-setup:");
    expect(message).toContain("        assertion: Explain the prerequisites");
  });

  // Inside a `sections:` map the keys are section names the author chose. TGDP's
  // README doctype wants a section about installation instructions, and calling
  // it `instructions` must not be mistaken for the legacy property.
  it("does not mistake a section named `instructions` for the legacy key", () => {
    const file = validateTemplateFile(
      {
        templates: {
          readme: {
            sections: {
              instructions: { heading: { const: "Instructions" } },
            },
          },
        },
      },
      "readme.yaml",
    );
    expect(file.templates?.["readme"]?.sections?.["instructions"]?.heading?.const).toBe(
      "Instructions",
    );
  });

  it("still catches the legacy property on a section named `instructions`", () => {
    const message = thrownMessage(() =>
      validateTemplateFile(
        {
          templates: {
            readme: {
              sections: {
                instructions: { instructions: ["Explain how to install it"] },
              },
            },
          },
        },
        "readme.yaml",
      ),
    );
    expect(message).toContain('"templates.readme.sections.instructions"');
    expect(message).toContain("        assertion: Explain how to install it");
  });
});

/**
 * The repo's own `templates.yaml`, ported. Two things in it did not survive:
 * `instructions:` on two sections - the local-language-model hook this tool no
 * longer has - and the `doc-structure-lint: 0.0.1` version marker, which the old
 * loader never saw because it validated one template at a time and never looked
 * at the file around them. Both are removed from the file itself.
 *
 * Everything else validates unchanged, which is what these tests pin: section
 * keys with spaces (`before you start`, `Next steps`), `$ref` components,
 * `sequence`, and nested `sections`.
 */
describe("the repo's own templates.yaml", () => {
  const source = join(repoRoot, "templates.yaml");

  // It is the file the README teaches from, so "it loads" is a real assertion,
  // not a formality. Both blockers named above have been removed from it: the
  // `instructions:` rejection is pinned against a dedicated fixture instead.
  it("loads and validates as shipped", async () => {
    const file = await loadTemplateFile(source);
    expect(Object.keys(file.templates ?? {})).toEqual(
      expect.arrayContaining(["how-to", "api-operation", "Sample"]),
    );
  });

  it("keeps the section shapes the old loader never validated", async () => {
    const raw = await readFile(source, "utf8");
    const dereferenced = await dereference<Record<string, unknown>>(
      parseYaml(raw) as Record<string, unknown>,
    );

    const file = validateTemplateFile(dereferenced, "templates.yaml");

    // Section keys with spaces, at both the top and nested levels.
    const howTo = file.templates?.["how-to"]?.sections?.["title"];
    expect(howTo?.sections?.["before you start"]?.heading?.const).toBe("Before you start");

    const intro = file.templates?.["Sample"]?.sections?.["Introduction"];
    // `$ref: "#/components/sections/Next steps"`, resolved before validation.
    expect(intro?.sections?.["Next steps"]?.heading?.const).toBe("Next steps");
    expect(intro?.sections?.["Next steps"]?.required).toBe(false);
    expect(intro?.sequence).toEqual([{ paragraphs: { min: 2 } }]);
    expect(isRequired(intro?.sections?.["Prerequisites"]!)).toBe(true);

    // `$ref: "#/components/parameters"` on a section with a heading pattern.
    const params = file.templates?.["api-operation"]?.sections?.["request-parameters"];
    expect(params?.heading?.pattern).toBe("^Parameters|Request Parameters$");
  });
});

describe("loadTemplate", () => {
  it("returns the only template in a file with no fragment", async () => {
    const template = await loadTemplate(join(fixtures, "single.yaml"));
    expect(template.types).toEqual(["how-to"]);
  });

  it("selects a template with a `#` fragment", async () => {
    const template = await loadTemplate(join(fixtures, "multi.yaml#reference"));
    expect(template.types).toEqual(["reference"]);
    expect(template.sections?.["syntax"]?.heading?.const).toBe("Syntax");
  });

  it("lists the available names when a multi-template file has no fragment", async () => {
    const source = join(fixtures, "multi.yaml");
    const message = await rejectionMessage(loadTemplate(source));
    expect(message).toContain("defines 2 templates");
    expect(message).toContain('name one with a "#" fragment');
    expect(message).toContain("how-to");
    expect(message).toContain("reference");
  });

  it("lists the available names when the fragment names nothing", async () => {
    const message = await rejectionMessage(loadTemplate(join(fixtures, "multi.yaml#nope")));
    expect(message).toContain('no template named "nope"');
    expect(message).toContain("how-to, reference");
  });

  // The template map is a plain object parsed from YAML, so `#constructor` and
  // `#toString` used to reach a member inherited from `Object.prototype`. That
  // member is truthy, so the "no template named" guard let it through and a
  // function came back as a template. Carrying no `sections`, it checked the
  // document against nothing, and the file was reported as PASSING.
  it("reports a fragment naming an inherited object member as no such template", async () => {
    const ctor = await rejectionMessage(loadTemplate(join(fixtures, "multi.yaml#constructor")));
    expect(ctor).toContain('no template named "constructor"');
    expect(ctor).toContain("how-to, reference");

    const str = await rejectionMessage(loadTemplate(join(fixtures, "multi.yaml#toString")));
    expect(str).toContain('no template named "toString"');
  });
});

/**
 * External `$ref` resolution is off. A template file is untrusted input - it can
 * be fetched over http, or written by someone other than whoever runs the lint -
 * and the dereferencer resolves `$ref` targets by reading files and making
 * requests from the linting host. Left on, `$ref: /etc/passwd` or
 * `$ref: http://169.254.169.254/...` in a template turned a lint run into an
 * arbitrary read.
 *
 * With external resolution off such a `$ref` is not fetched and not followed; it
 * is simply left standing, and the schema - `additionalProperties: false` on
 * every section rule - then rejects the file for carrying it.
 */
describe("`$ref` resolution stays inside the file", () => {
  // The regression risk of turning it off: intra-file `$ref` is how a template
  // file shares one section rule between templates, and it must survive.
  it("resolves an internal `$ref` shared between two templates", async () => {
    const file = await loadTemplateFile(join(fixtures, "internal-ref.yaml"));

    const howTo = file.templates?.["how-to"]?.sections?.["next steps"];
    expect(howTo?.heading?.const).toBe("Next steps");
    expect(howTo?.required).toBe(false);
    expect(howTo?.paragraphs?.min).toBe(1);

    const reference = file.templates?.["reference"]?.sections?.["next steps"];
    expect(reference?.heading?.const).toBe("Next steps");
    expect(reference?.paragraphs?.min).toBe(1);
  });

  // This one reached the network: the fixture's host does not exist, and the
  // failure it used to produce was "Error downloading ... fetch failed" - which
  // is proof the request was made.
  it("rejects a `$ref` at an http url rather than fetching it", async () => {
    const source = join(fixtures, "external-http-ref.yaml");
    const message = await rejectionMessage(loadTemplateFile(source));

    expect(message).toContain("/templates/how-to/sections/overview");
    expect(message).toContain("must NOT have additional properties");
    expect(message).toContain("$ref");
    // Not "could not resolve a `$ref`": the point is that nothing was fetched,
    // not that fetching failed.
    expect(message).not.toContain("could not resolve");
  });

  // The fixture's `$ref` names a file that really is there, so this used to
  // load clean - the read succeeded and nothing anywhere said it had happened.
  // Once the ref is no longer followed the target stops mattering, so the test
  // no longer depends on where the process is running from.
  it("rejects a `$ref` at a local file rather than reading it", async () => {
    const source = join(fixtures, "external-file-ref.yaml");
    const message = await rejectionMessage(loadTemplateFile(source));

    expect(message).toContain("/templates/how-to/sections/overview");
    expect(message).toContain("must NOT have additional properties");
    expect(message).toContain("$ref");
    expect(message).not.toContain("could not resolve");
  });
});

describe("resolveExtends", () => {
  const library: Record<string, Template> = {
    base: {
      types: ["how-to"],
      additionalSections: true,
      sections: {
        overview: { heading: { const: "Overview" }, paragraphs: { min: 1 } },
        "see also": { required: false, heading: { const: "See also" } },
        task: {
          sections: {
            steps: { heading: { const: "Steps" }, lists: { min: 1 } },
            caveats: { required: false },
          },
        },
      },
    },
    child: {
      extends: "base",
      sections: {
        overview: { heading: { const: "Introduction" }, paragraphs: { min: 2 } },
        // Tightens one nested rule. Its siblings under `task`, and `task`'s own
        // keys, must survive.
        task: { sections: { caveats: { required: true } } },
      },
    },
  };

  const load: TemplateResolver = async (ref) => {
    const template = library[ref];
    if (!template) throw new MooseLintError(`no such template: ${ref}`);
    return template;
  };

  it("returns a template with no `extends` unchanged", async () => {
    const base = library["base"]!;
    expect(await resolveExtends(base, load)).toBe(base);
  });

  it("overrides sections by key and inherits every key the child omits", async () => {
    const merged = await resolveExtends(library["child"]!, load);

    expect(merged.sections?.["overview"]?.heading?.const).toBe("Introduction");
    expect(merged.sections?.["see also"]?.heading?.const).toBe("See also");
    expect(merged.types).toEqual(["how-to"]);
    expect(merged.additionalSections).toBe(true);
    // The chain is resolved, so nothing downstream tries to resolve it again.
    expect(merged.extends).toBeUndefined();
  });

  // The merge reaches individual rules, not just section names: a child that
  // names one rule of a nested section keeps the parent's others.
  it("keeps a nested section's other rules when the child names only some", async () => {
    const deep: Record<string, Template> = {
      base: {
        sections: {
          task: {
            additionalSections: true,
            sections: {
              steps: {
                heading: { const: "Steps" },
                lists: { min: 1 },
                paragraphs: { max: 3 },
              },
            },
          },
        },
      },
      narrower: {
        extends: "base",
        sections: { task: { sections: { steps: { lists: { min: 2 } } } } },
      },
    };
    const loadDeep: TemplateResolver = async (ref) => deep[ref]!;

    const task = (await resolveExtends(deep["narrower"]!, loadDeep)).sections?.["task"];

    expect(task?.additionalSections).toBe(true);
    expect(task?.sections?.["steps"]?.lists).toEqual({ min: 2 });
    expect(task?.sections?.["steps"]?.heading?.const).toBe("Steps");
    expect(task?.sections?.["steps"]?.paragraphs?.max).toBe(3);
  });

  // `sections` is a container, not a rule. Replacing it wholesale would mean
  // tightening one nested section silently discarded every sibling the parent
  // declared - which is the opposite of what `extends` is for.
  it("merges nested sections instead of replacing the branch", async () => {
    const merged = await resolveExtends(library["child"]!, load);
    const task = merged.sections?.["task"];

    expect(Object.keys(task?.sections ?? {})).toEqual(["steps", "caveats"]);
    expect(task?.sections?.["steps"]?.heading?.const).toBe("Steps");
    expect(task?.sections?.["steps"]?.lists?.min).toBe(1);
    expect(task?.sections?.["caveats"]?.required).toBe(true);
  });

  // A section's own rules stay units: overriding `paragraphs` replaces it
  // rather than merging a child `min` into a parent `max`.
  it("replaces a content rule rather than merging into it", async () => {
    const merged = await resolveExtends(library["child"]!, load);
    expect(merged.sections?.["overview"]?.paragraphs).toEqual({ min: 2 });
  });

  it("keeps the parent's section order, with child-only additions last", async () => {
    const merged = await resolveExtends(library["child"]!, load);
    expect(Object.keys(merged.sections ?? {})).toEqual([
      "overview",
      "see also",
      "task",
    ]);
  });

  // Regression: Ajv `useDefaults` used to write `required`/`repeat`/
  // `additionalSections` into every section at load time, so a child that
  // overrode one nested rule carried defaults that beat the parent's real
  // values. Loading through the schema is the whole point of this test.
  it("inherits booleans the child never states, after a real schema load", async () => {
    const child = await loadTemplate(join(fixtures, "inherit-booleans.yaml#child"));
    const merged = await resolveExtends(child, (ref) => loadTemplate(join(fixtures, ref)));
    const task = merged.sections?.["task"];

    expect(task?.additionalSections).toBe(true);
    expect(task?.required).toBe(false);
    expect(task?.sections?.["steps"]?.lists?.min).toBe(2);
  });

  it("leaves the parent untouched", async () => {
    await resolveExtends(library["child"]!, load);
    expect(library["base"]?.sections?.["overview"]?.heading?.const).toBe("Overview");
    expect(Object.keys(library["base"]?.sections ?? {})).toEqual([
      "overview",
      "see also",
      "task",
    ]);
    // Deep merge must copy, not mutate, the parent's nested branch.
    expect(library["base"]?.sections?.["task"]?.sections?.["caveats"]?.required).toBe(
      false,
    );
  });

  it("resolves an `extends` that points into a file", async () => {
    const child = await loadTemplate(join(fixtures, "extends.yaml#child"));
    const merged = await resolveExtends(child, (ref) => loadTemplate(join(fixtures, ref)));

    expect(merged.sections?.["overview"]?.heading?.const).toBe("Introduction");
    expect(merged.sections?.["overview"]?.paragraphs?.min).toBe(2);
    expect(merged.sections?.["see also"]?.heading?.const).toBe("See also");
    expect(merged.additionalSections).toBe(true);
    expect(merged.extends).toBeUndefined();
  });

  it("detects a cycle and names the chain", async () => {
    const cyclic: Record<string, Template> = {
      a: { extends: "b" },
      b: { extends: "a" },
    };
    const loadCyclic: TemplateResolver = async (ref) => cyclic[ref]!;

    const message = await rejectionMessage(resolveExtends(cyclic["a"]!, loadCyclic));
    expect(message).toContain('Template "extends" cycle');
    expect(message).toContain("b -> a -> b");
  });

  it("detects a template that extends itself", async () => {
    const selfish: Record<string, Template> = { me: { extends: "me" } };
    const message = await rejectionMessage(
      resolveExtends(selfish["me"]!, async (ref) => selfish[ref]!),
    );
    expect(message).toContain("me -> me");
  });
});

describe("the template schema", () => {
  it("accepts an empty section rule", () => {
    // A bare slot with no constraints is how an unconstrained positional
    // section is written.
    const file = validateTemplateFile(
      { templates: { "how-to": { sections: { task: {} } } } },
      "empty.yaml",
    );
    const task = file.templates?.["how-to"]?.sections?.["task"];
    expect(isRequired(task!)).toBe(true);
    expect(isSlot(task!)).toBe(true);
    expect(task?.heading).toBeUndefined();
  });

  it("accepts `repeat` on a section rule", () => {
    const file = validateTemplateFile(
      { templates: { "how-to": { sections: { task: { repeat: true } } } } },
      "repeat.yaml",
    );
    expect(file.templates?.["how-to"]?.sections?.["task"]?.repeat).toBe(true);
    // Absent, not written in as `false`, so a plain slot claims exactly one
    // section without carrying a value that would win an `extends` merge.
    const plain = validateTemplateFile(
      { templates: { "how-to": { sections: { task: {} } } } },
      "repeat.yaml",
    );
    expect(plain.templates?.["how-to"]?.sections?.["task"]?.repeat).toBeUndefined();
  });

  it("accepts `types` and `extends` on a template", () => {
    const file = validateTemplateFile(
      { templates: { "how-to": { types: ["how-to", "howto"], extends: "tgdp:how-to:1" } } },
      "types.yaml",
    );
    expect(file.templates?.["how-to"]?.types).toEqual(["how-to", "howto"]);
    expect(file.templates?.["how-to"]?.extends).toBe("tgdp:how-to:1");
  });

  it("rejects an unknown key at the top level", () => {
    const message = thrownMessage(() =>
      validateTemplateFile({ templates: {}, "doc-structure-lint": "0.0.1" }, "legacy.yaml"),
    );
    expect(message).toContain("legacy.yaml");
    expect(message).toContain("doc-structure-lint");
  });

  it("requires a `templates` key", () => {
    const message = thrownMessage(() => validateTemplateFile({ info: {} }, "empty.yaml"));
    expect(message).toContain("must have required property 'templates'");
  });

  it("rejects a heading key that is not `const` or `pattern`", () => {
    const message = thrownMessage(() =>
      validateTemplateFile(
        { templates: { a: { sections: { s: { heading: { constant: "Overview" } } } } } },
        "typo.yaml",
      ),
    );
    expect(message).toContain("/templates/a/sections/s/heading");
    expect(message).toContain("constant");
  });

  it("rejects a sequence item that names two content kinds", () => {
    const message = thrownMessage(() =>
      validateTemplateFile(
        {
          templates: {
            a: { sections: { s: { sequence: [{ paragraphs: { min: 1 }, code_blocks: {} }] } } },
          },
        },
        "sequence.yaml",
      ),
    );
    expect(message).toContain("/templates/a/sections/s/sequence/0");
  });

  it("rejects a top-level value that is not an object", () => {
    const message = thrownMessage(() => validateTemplateFile("nope", "scalar.yaml"));
    expect(message).toContain("scalar.yaml");
    expect(message).toContain("must be object");
  });
});
