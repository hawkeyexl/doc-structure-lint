/**
 * Config loading, pinned end to end against real files.
 *
 * Every discovery case writes an actual tree under `mkdtemp` rather than
 * mocking `fs`: the behaviors that matter here - a walk that stops at the
 * repository root, an `ENOENT` that means "absent" while an `EISDIR` means
 * "broken" - are properties of the filesystem, and a mocked `fs` would only
 * pin this test's idea of one.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONFIG_FILENAMES,
  SECTION_KEY,
  loadConfig,
  parseConfig,
} from "../../src/core/config.js";
import configSchema from "../../src/schemas/config.json" with { type: "json" };
import { MooseLintError } from "../../src/types.js";

const FIXTURES = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../fixtures/config",
);

let dir: string;

/** Write a file under the temp repo, creating its parent directories. */
async function write(rel: string, text: string): Promise<void> {
  const abs = join(dir, rel);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, text, "utf8");
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "moose-lint-config-"));
  // The walk stops at the repository root, so every temp tree needs one -
  // without it the walk would climb out of the fixture and into the real
  // filesystem, which is the failure the boundary exists to prevent.
  await write(".git", "gitdir: elsewhere\n");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** The message of the MooseLintError `run` throws. Fails if it throws nothing. */
async function messageOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (err) {
    expect(err).toBeInstanceOf(MooseLintError);
    return (err as Error).message;
  }
  throw new Error("expected a MooseLintError, but nothing was thrown");
}

describe("parseConfig", () => {
  it("reads the lint section", () => {
    const config = parseConfig(
      [
        "lint:",
        '  paths: ["docs/**/*.md"]',
        '  exclude: ["**/drafts/**"]',
        '  templates: ["./templates.yaml"]',
        "  template: tgdp:how-to:1.6",
        "  types:",
        "    api-operation: ./templates.yaml#api-operation",
        "  overrides:",
        '    - files: "docs/api/**"',
        "      template: tgdp:reference:1.6",
      ].join("\n"),
      "moose.config.yaml",
    );

    expect(config).toEqual({
      paths: ["docs/**/*.md"],
      exclude: ["**/drafts/**"],
      templates: ["./templates.yaml"],
      template: "tgdp:how-to:1.6",
      types: { "api-operation": "./templates.yaml#api-operation" },
      overrides: [{ files: "docs/api/**", template: "tgdp:reference:1.6" }],
    });
  });

  // The point of the shared file: a sibling's keys are neither read nor
  // validated, so adding a tool to the family needs no change here.
  it("ignores sibling tools' sections, including ones spelling our own keys", () => {
    const config = parseConfig(
      [
        "docevals:",
        "  provider:",
        "    default: anthropic",
        "docmeta:",
        '  paths: ["should-not-be-read/**"]',
        "  overrides:",
        '    - files: "**"',
        "      schemas: [okf]",
        "lint:",
        '  paths: ["docs/**/*.md"]',
      ].join("\n"),
      "moose.config.yaml",
    );

    expect(config).toEqual({ paths: ["docs/**/*.md"] });
  });

  // Keeps one shared file usable by a project that has not adopted this tool.
  it("returns defaults for a file carrying only other tools' sections", () => {
    const config = parseConfig("docevals:\n  provider:\n    default: openai\n", "x");
    expect(config).toEqual({});
  });

  it("returns defaults for an empty file", () => {
    expect(parseConfig("", "x")).toEqual({});
    expect(parseConfig("# just a comment\n", "x")).toEqual({});
  });

  it("returns defaults for a lint key with nothing under it", () => {
    expect(parseConfig("lint:\n", "x")).toEqual({});
  });

  it("rejects a non-mapping root", async () => {
    const message = await messageOf(async () =>
      parseConfig("- lint\n- docevals\n", "moose.config.yaml"),
    );
    expect(message).toContain("moose.config.yaml");
    expect(message).toContain("top level must be a mapping");
  });

  it("rejects unparseable YAML", async () => {
    const message = await messageOf(async () =>
      parseConfig("lint:\n  paths: [unclosed\n", "moose.config.yaml"),
    );
    expect(message).toContain("moose.config.yaml: invalid YAML:");
  });

  it("names the path of an invalid value inside the section", async () => {
    const message = await messageOf(async () =>
      parseConfig(
        ["lint:", "  overrides:", '    - files: "docs/**"', "      template: 7"].join(
          "\n",
        ),
        "moose.config.yaml",
      ),
    );
    expect(message).toContain(`invalid "${SECTION_KEY}" section`);
    expect(message).toContain("lint/overrides/0/template");
    expect(message).toContain("must be string");
  });

  // additionalProperties: false at every level is what turns a typo into a
  // loud failure rather than a key that quietly does nothing.
  it("rejects an unknown key inside the section, and names it", async () => {
    const message = await messageOf(async () =>
      parseConfig('lint:\n  path: ["docs"]\n', "moose.config.yaml"),
    );
    expect(message).toContain("must NOT have additional properties");
    expect(message).toContain('"path"');
  });

  it("rejects an unknown key nested inside an override", async () => {
    const message = await messageOf(async () =>
      parseConfig(
        ["lint:", "  overrides:", '    - files: "docs/**"', "      schemas: [okf]"].join(
          "\n",
        ),
        "moose.config.yaml",
      ),
    );
    expect(message).toContain("lint/overrides/0");
    expect(message).toContain('"schemas"');
  });

  describe("the un-nested config", () => {
    it("names the stray keys and the key they belong under", async () => {
      const message = await messageOf(async () =>
        parseConfig(
          [
            'paths: ["docs/**/*.md"]',
            "overrides:",
            '  - files: "docs/api/**"',
            "    template: tgdp:reference:1.6",
          ].join("\n"),
          "moose.config.yaml",
        ),
      );
      expect(message).toContain('"paths:"');
      expect(message).toContain('"overrides:"');
      expect(message).toContain('no "lint:" key');
      expect(message).toContain("Indent the file's contents one level");
    });

    // The stray list is derived from the schema's own properties, so it cannot
    // fall behind the real key set. Assert that for every key there is.
    it("catches every key the schema declares", async () => {
      const keys = Object.keys(configSchema.properties);
      expect(keys.length).toBeGreaterThan(0);
      for (const key of keys) {
        const message = await messageOf(async () =>
          parseConfig(`${key}: {}\n`, "moose.config.yaml"),
        );
        expect(message, `root "${key}:" should be reported`).toContain(`"${key}:"`);
      }
    });

    it("does not fire on a sibling tool's key", () => {
      expect(parseConfig("schemas: [okf]\n", "x")).toEqual({});
    });
  });

  describe("the miscased wrapper", () => {
    // The stray-key check cannot see this one: its keys are nested, not at the
    // top level, so nothing this tool owns appears at the root.
    it("rejects a top-level key matching lint only case-insensitively", async () => {
      const message = await messageOf(async () =>
        parseConfig('Lint:\n  paths: ["docs/**/*.md"]\n', "moose.config.yaml"),
      );
      expect(message).toContain('"Lint:"');
      expect(message).toContain("case-sensitive");
      expect(message).toContain('Rename "Lint:" to "lint:"');
    });

    it("rejects an all-caps wrapper too", async () => {
      const message = await messageOf(async () =>
        parseConfig("LINT:\n  template: tgdp:how-to:1.6\n", "x"),
      );
      expect(message).toContain('"LINT:"');
    });

    // Accepted, and documented in the ADR: without a registry of tool names, a
    // wrapper misspelled any other way is another tool's section.
    it("cannot see a wrapper misspelled any other way", () => {
      expect(parseConfig('lnt:\n  paths: ["docs"]\n', "x")).toEqual({});
    });
  });
});

describe("loadConfig", () => {
  it("reads the section out of a real shared file, ignoring siblings", async () => {
    const found = await loadConfig(join(FIXTURES, "moose.config.yaml"));
    expect(found).not.toBeNull();
    expect(found?.config).toEqual({
      paths: ["docs/**/*.md"],
      exclude: ["**/drafts/**"],
      templates: ["./templates.yaml"],
      template: "tgdp:how-to:1.6",
      types: { "api-operation": "./templates.yaml#api-operation" },
      overrides: [{ files: "docs/api/**", template: "tgdp:reference:1.6" }],
    });
  });

  it("returns null when no config is anywhere up the tree", async () => {
    await mkdir(join(dir, "docs"), { recursive: true });
    expect(await loadConfig(undefined, join(dir, "docs"))).toBeNull();
  });

  it("returns defaults, not null, for a file carrying only other tools", async () => {
    await write("moose.config.yaml", "docevals:\n  provider:\n    default: openai\n");
    const found = await loadConfig(undefined, dir);
    expect(found?.config).toEqual({});
    expect(found?.path).toBe(join(dir, "moose.config.yaml"));
  });

  it("accepts the .yml spelling", async () => {
    expect(CONFIG_FILENAMES).toContain("moose.config.yml");
    await write("moose.config.yml", 'lint:\n  template: tgdp:how-to:1.6\n');
    const found = await loadConfig(undefined, dir);
    expect(found?.config).toEqual({ template: "tgdp:how-to:1.6" });
  });

  describe("discovery", () => {
    // People run the CLI from wherever they are. Looking only in cwd resolved
    // every one of those runs to defaults, with the config one directory up.
    it("walks up from a subdirectory to the repository root", async () => {
      await write("moose.config.yaml", 'lint:\n  paths: ["docs/**/*.md"]\n');
      await mkdir(join(dir, "docs", "api"), { recursive: true });

      const found = await loadConfig(undefined, join(dir, "docs", "api"));
      expect(found?.config).toEqual({ paths: ["docs/**/*.md"] });
      expect(found?.path).toBe(join(dir, "moose.config.yaml"));
    });

    it("prefers the nearest config to a farther one", async () => {
      await write("moose.config.yaml", "lint:\n  template: far\n");
      await write("docs/moose.config.yaml", "lint:\n  template: near\n");

      const found = await loadConfig(undefined, join(dir, "docs"));
      expect(found?.config).toEqual({ template: "near" });
    });

    // Reaching past the project finds a config belonging to something else,
    // which is worse than finding none.
    it("stops at the repository root rather than adopting a config above it", async () => {
      // `dir` holds the `.git` marker; the config sits outside it.
      const outside = await mkdtemp(join(tmpdir(), "moose-lint-outer-"));
      try {
        await writeFile(
          join(outside, "moose.config.yaml"),
          "lint:\n  template: not-ours\n",
          "utf8",
        );
        const inner = join(outside, "repo", "docs");
        await mkdir(inner, { recursive: true });
        await writeFile(join(outside, "repo", ".git"), "gitdir: elsewhere\n", "utf8");

        expect(await loadConfig(undefined, inner)).toBeNull();
      } finally {
        await rm(outside, { recursive: true, force: true });
      }
    });
  });

  describe("the un-renamed config", () => {
    it("names the new filename and the required key", async () => {
      await write("doc-structure-lint.config.yaml", 'paths: ["docs/**/*.md"]\n');
      const message = await messageOf(() => loadConfig(undefined, dir));

      expect(message).toContain("doc-structure-lint.config.yaml");
      expect(message).toContain("moose.config.yaml");
      expect(message).toContain(`"${SECTION_KEY}:"`);
    });

    it("is raised for the .yml spelling too", async () => {
      await write("doc-structure-lint.config.yml", "paths: []\n");
      const message = await messageOf(() => loadConfig(undefined, dir));
      expect(message).toContain("doc-structure-lint.config.yml");
    });

    // A stale config two directories up is exactly as misleading as one in cwd.
    it("is raised from a subdirectory of the repo", async () => {
      await write("doc-structure-lint.config.yaml", "paths: []\n");
      await mkdir(join(dir, "docs", "api"), { recursive: true });

      const message = await messageOf(() =>
        loadConfig(undefined, join(dir, "docs", "api")),
      );
      expect(message).toContain("doc-structure-lint.config.yaml");
    });

    it("is not raised when a moose config sits beside it", async () => {
      await write("doc-structure-lint.config.yaml", "paths: []\n");
      await write("moose.config.yaml", "lint:\n  template: tgdp:how-to:1.6\n");

      const found = await loadConfig(undefined, dir);
      expect(found?.config).toEqual({ template: "tgdp:how-to:1.6" });
    });

    // --config gets no filename sniffing: a file passed by hand may be called
    // anything, so blaming a pre-rename name there would be a guess.
    it("is not sniffed for behind an explicit --config", async () => {
      await write("doc-structure-lint.config.yaml", 'paths: ["docs/**"]\n');
      const message = await messageOf(() =>
        loadConfig(join(dir, "doc-structure-lint.config.yaml")),
      );
      // The un-nested check still fires - by shape, not by filename.
      expect(message).toContain('"paths:"');
      expect(message).not.toContain("rename the file");
    });
  });

  describe("an unreadable moose.config.yaml", () => {
    it("is reported rather than defaulted through", async () => {
      // A directory by that name: the portable stand-in for a file that exists
      // but will not open. Node reports EISDIR, which is not ENOENT/ENOTDIR.
      await mkdir(join(dir, "moose.config.yaml"), { recursive: true });

      const message = await messageOf(() => loadConfig(undefined, dir));
      expect(message).toContain("Cannot read config file");
      expect(message).toContain(join(dir, "moose.config.yaml"));
    });

    // The whole reason the read error is raised before the legacy check: a
    // permissions problem reported as "you never renamed your file" sends the
    // reader off to fix something that is not broken.
    it("does not let the legacy file take the blame", async () => {
      await mkdir(join(dir, "moose.config.yaml"), { recursive: true });
      await write("doc-structure-lint.config.yaml", "paths: []\n");

      const message = await messageOf(() => loadConfig(undefined, dir));
      expect(message).toContain("Cannot read config file");
      expect(message).not.toContain("doc-structure-lint.config.yaml");
      expect(message).not.toContain("rename the file");
    });

    it("is reported for an explicit --config too", async () => {
      await mkdir(join(dir, "custom.yaml"), { recursive: true });
      const message = await messageOf(() => loadConfig(join(dir, "custom.yaml")));
      expect(message).toContain("Cannot read config file");
      expect(message).not.toContain("not found");
    });
  });

  describe("--config", () => {
    it("errors on a missing path", async () => {
      const missing = join(dir, "nope.yaml");
      const message = await messageOf(() => loadConfig(missing));
      expect(message).toBe(`Config file not found: "${missing}".`);
    });

    it("resolves a relative path against cwd", async () => {
      await write("config/custom.yaml", "lint:\n  template: tgdp:reference:1.6\n");
      const found = await loadConfig("config/custom.yaml", dir);
      expect(found?.config).toEqual({ template: "tgdp:reference:1.6" });
      expect(found?.path).toBe(join(dir, "config", "custom.yaml"));
    });

    // Discovery is skipped entirely, so a config sitting in cwd is not read.
    it("skips discovery", async () => {
      await write("moose.config.yaml", "lint:\n  template: discovered\n");
      await write("elsewhere/custom.yaml", "lint:\n  template: explicit\n");

      const found = await loadConfig(join(dir, "elsewhere", "custom.yaml"), dir);
      expect(found?.config).toEqual({ template: "explicit" });
    });
  });
});
