import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { resolveTargets } from "../../src/core/load-files.js";
import { MooseLintError } from "../../src/types.js";

let dir: string;

async function write(rel: string): Promise<void> {
  const abs = join(dir, rel);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, "# Title\n", "utf8");
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "moose-lint-"));
  await write("docs/intro.md");
  await write("docs/guide.mdx");
  await write("docs/notes.txt");
  await write("docs/drafts/wip.md");
  await write("node_modules/some-pkg/readme.md");
  await write(".cache/stale.md");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("resolveTargets", () => {
  it("returns an explicitly named file as given", async () => {
    const files = await resolveTargets({ inputs: ["docs/intro.md"], cwd: dir });
    expect(files).toEqual(["docs/intro.md"]);
  });

  // The user asked about this file by name, so an unreadable format has to
  // come back as a reported skip from the lint command, not as silence here.
  it("keeps an explicit file whose extension no parser claims", async () => {
    const files = await resolveTargets({ inputs: ["docs/notes.txt"], cwd: dir });
    expect(files).toEqual(["docs/notes.txt"]);
  });

  // The pre-rewrite walker hardcoded [".md", ".markdown"], so registering the
  // MDX parser would not have made a directory of .mdx files lintable.
  it("walks a directory for every supported extension, and nothing else", async () => {
    const files = await resolveTargets({ inputs: ["docs"], cwd: dir });
    expect(files).toEqual([
      "docs/drafts/wip.md",
      "docs/guide.mdx",
      "docs/intro.md",
    ]);
    expect(files).not.toContain("docs/notes.txt");
  });

  it("expands a glob", async () => {
    const files = await resolveTargets({ inputs: ["docs/*.md"], cwd: dir });
    expect(files).toEqual(["docs/intro.md"]);
  });

  it("applies exclude globs", async () => {
    const files = await resolveTargets({
      inputs: ["docs"],
      exclude: ["**/drafts/**"],
      cwd: dir,
    });
    expect(files).toContain("docs/intro.md");
    expect(files).not.toContain("docs/drafts/wip.md");
  });

  it("excludes node_modules and dotdirs without being asked", async () => {
    const files = await resolveTargets({ inputs: ["."], cwd: dir });
    expect(files).toContain("docs/intro.md");
    expect(files.some((f) => f.includes("node_modules"))).toBe(false);
    expect(files.some((f) => f.startsWith("."))).toBe(false);
  });

  it("de-duplicates overlapping inputs and sorts the result", async () => {
    const files = await resolveTargets({
      inputs: ["docs/intro.md", "docs", "docs/*.md"],
      cwd: dir,
    });
    expect(files.filter((f) => f === "docs/intro.md")).toHaveLength(1);
    expect(files).toEqual([...files].sort());
  });

  it("restricts expansion to the given extensions", async () => {
    const files = await resolveTargets({
      inputs: ["docs"],
      exts: [".mdx"],
      cwd: dir,
    });
    expect(files).toEqual(["docs/guide.mdx"]);
  });

  it("skips the stdin token", async () => {
    const files = await resolveTargets({ inputs: ["-"], cwd: dir });
    expect(files).toEqual([]);
  });

  // A linter handed nothing that prints nothing is indistinguishable from a
  // linter that found nothing wrong, which is the worst way for CI to pass.
  it("rejects with a MooseLintError when there are no inputs at all", async () => {
    await expect(resolveTargets({ inputs: [], cwd: dir })).rejects.toThrow(
      MooseLintError,
    );
    await expect(resolveTargets({ inputs: [], cwd: dir })).rejects.toThrow(
      /No inputs/,
    );
  });
});
