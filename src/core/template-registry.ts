/**
 * Source of truth for templates. Holds the built-in doctype templates
 * (addressed by `vendor:name:version`-style ids) and knows how to load any
 * template reference - a built-in id, a local `.yaml`/`.yml`/`.json` path, or
 * an `http(s)` URL, optionally naming one template inside a file with a `#`
 * fragment (`./templates.yaml#how-to`).
 *
 * Two ordering decisions are load-bearing:
 *
 *  - A file is dereferenced *before* it is validated. `$ref` is how a template
 *    file shares one section rule between templates, and a section rule is
 *    `additionalProperties: false`, so any `$ref` still standing at validation
 *    time would be reported as an unexpected key.
 *  - `instructions` is looked for by hand *before* Ajv runs. The schema rejects
 *    it too (`not: {required: ["instructions"]}`), but a raw schema error says
 *    nothing useful about where the feature went; scanning the parsed data
 *    directly is both more reliable than reverse-engineering which Ajv error
 *    came from the `not` keyword and the only way to quote the author's own
 *    instruction back at them in the migration snippet.
 *
 * `extends` is deliberately *not* resolved by `loadTemplate`. Inheritance needs
 * a resolver that knows what a relative ref is relative to, which only the
 * caller knows, so `resolveExtends` takes that resolver as an argument.
 */
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve as resolvePath } from "node:path";
import { parse as parseYaml } from "yaml";
import { dereference } from "@apidevtools/json-schema-ref-parser";
import * as AjvNs from "ajv";
import type { ErrorObject, SchemaObject, ValidateFunction } from "ajv";
import { MooseLintError } from "../types.js";
import type { Template, TemplateFile, TemplateSection } from "./template.js";
import templateFileSchema from "../schemas/template.json" with { type: "json" };
import tgdpManifest from "../templates/tgdp/manifest.json" with { type: "json" };

// ajv is CommonJS with a default export; under NodeNext the constructable
// value lives on `.default`. Cast through the named default type so tsc sees a
// constructor.
type AjvCtor = typeof import("ajv").default;
const Ajv = AjvNs.default as unknown as AjvCtor;

export interface BuiltinInfo {
  id: string;
  title: string;
  types: string[];
}

/**
 * Built-in doctype templates.
 *
 * The manifest is a JSON import, so it is bundled and `listBuiltins()` stays
 * synchronous. The templates themselves are YAML files beside it, read on
 * demand: they are meant to be opened, read, and copied by anyone writing their
 * own template, and YAML is the format that survives that. `tsup` copies
 * `src/templates/` into `dist/`, and resolving against `import.meta.url` finds
 * them identically from source and from the built package.
 */
interface ManifestEntry {
  id: string;
  file: string;
  title: string;
  types: string[];
  /** Upstream file this was derived from, for provenance. */
  source?: string;
}

interface Manifest {
  vendor: string;
  upstream: string;
  pin: string;
  templates: ManifestEntry[];
}

const MANIFESTS: Manifest[] = [tgdpManifest as Manifest];

const BUILTINS = new Map<string, ManifestEntry>();
for (const manifest of MANIFESTS) {
  for (const entry of manifest.templates) BUILTINS.set(entry.id, entry);
}

/** Parsed built-ins, keyed by id. Populated on first load. */
const builtinCache = new Map<string, Template>();

export function listBuiltins(): BuiltinInfo[] {
  return [...BUILTINS.values()].map((entry) => ({
    id: entry.id,
    title: entry.title,
    types: entry.types,
  }));
}

/**
 * Locate a built-in's YAML beside the module that asks for it.
 *
 * Two candidates, because source and package have different shapes: from
 * `src/core/` the templates are at `../templates/`, but tsup bundles the whole
 * library into one chunk at the root of `dist/`, where they are at
 * `./templates/`. Probing both keeps a single code path working in the repo, in
 * the published package, and under vitest - and a mismatch here fails only in
 * the built artifact, which is the worst place to discover it.
 */
async function readBuiltinFile(id: string, file: string): Promise<string> {
  const candidates = [
    new URL(`../templates/${file}`, import.meta.url),
    new URL(`./templates/${file}`, import.meta.url),
  ];
  const errors: string[] = [];
  for (const url of candidates) {
    try {
      return await readFile(url, "utf8");
    } catch (err) {
      errors.push((err as Error).message);
    }
  }
  throw new MooseLintError(
    `Built-in template "${id}" is registered but its file could not be read (${file}). Tried:\n  ${errors.join("\n  ")}`,
  );
}

/**
 * Read, validate, and cache one built-in.
 *
 * Built-ins go through exactly the same schema validation as a user's file. A
 * template we ship is not more trustworthy than one you write - it is only
 * better tested - and a shipped template that violates its own schema should
 * fail loudly here rather than behave strangely during matching.
 */
async function loadBuiltin(id: string): Promise<Template> {
  const cached = builtinCache.get(id);
  if (cached) return cached;

  const entry = BUILTINS.get(id)!;
  const raw = await readBuiltinFile(id, entry.file);

  const file = validateTemplateFile(
    await dereference<Record<string, unknown>>(
      parseYaml(raw) as Record<string, unknown>,
    ),
    entry.file,
  );
  const names = Object.keys(file.templates ?? {});
  const template = file.templates?.[names[0] ?? ""];
  if (!template || names.length !== 1) {
    throw new MooseLintError(
      `Built-in template "${id}" must define exactly one template, found ${names.length}.`,
    );
  }

  // `types` lives in the manifest so the type map can be built without reading
  // every YAML file; mirror it onto the template so both agree.
  const resolved: Template = { types: entry.types, ...template };
  builtinCache.set(id, resolved);
  return resolved;
}

export type RefKind = "builtin" | "file" | "url";

/**
 * A built-in id looks like `seg(:seg)+` using only [a-z0-9._-] segments, with
 * no path separators and no template-file extension. This deliberately
 * excludes Windows paths (`C:\...`), URLs, and `.yaml`/`.yml`/`.json` files so
 * a typo'd built-in is reported as an unknown id rather than silently treated
 * as a missing file.
 */
const BUILTIN_ID = /^[a-z0-9][a-z0-9._-]*(?::[a-z0-9][a-z0-9._-]*)+$/i;

const FILE_EXTENSIONS = [".yaml", ".yml", ".json"];

export function classifyRef(ref: string): { kind: RefKind; ref: string } {
  if (/^https?:\/\//i.test(ref)) return { kind: "url", ref };
  const lower = ref.toLowerCase();
  if (
    !ref.includes("/") &&
    !ref.includes("\\") &&
    !FILE_EXTENSIONS.some((ext) => lower.endsWith(ext)) &&
    BUILTIN_ID.test(ref)
  ) {
    return { kind: "builtin", ref };
  }
  return { kind: "file", ref };
}

/** Default network timeout for fetching a remote (`http(s)`) template file. */
const DEFAULT_TIMEOUT_MS = 10_000;

export interface LoadTemplateOptions {
  /** Abort a remote fetch after this many ms (default 10_000). */
  timeoutMs?: number;
}

/* -------------------------------------------------------------------------- *
 * Validation
 * -------------------------------------------------------------------------- */

// `useDefaults` is not cosmetic: it is what fills in `required: true` on every
// section rule that does not say otherwise, which the matcher reads.
const ajv = new Ajv({ useDefaults: true });

let compiled: ValidateFunction | null = null;

function fileValidator(): ValidateFunction {
  compiled ??= ajv.compile(templateFileSchema as SchemaObject);
  return compiled;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** One `instructions` key found in a template file, and where it lives. */
interface InstructionsHit {
  /** Dotted path to the rule carrying it, e.g. `templates.how-to.sections.title`. */
  path: string;
  /** Suggested eval name, kebab-cased from the path. */
  name: string;
  /** The instruction strings, verbatim. */
  values: string[];
}

/** The strings in an `instructions:` value, whatever shape it was written in. */
function stringsOf(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  return [];
}

/**
 * Name for the suggested eval: the path with the structural keys (`templates`,
 * `sections`) dropped, kebab-cased. `templates.how-to.sections.title` becomes
 * `how-to-title`.
 */
function suggestEvalName(segments: string[]): string {
  const name = segments
    .filter((segment) => segment !== "templates" && segment !== "sections")
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return name || "section-instructions";
}

/**
 * First `instructions` key anywhere in a parsed template file.
 *
 * Dereferencing can make two rules share one object, and a self-referential
 * `$ref` can make the tree cyclic, hence the `seen` set.
 */
function findInstructions(
  node: unknown,
  segments: string[] = [],
  seen = new WeakSet<object>(),
): InstructionsHit | null {
  if (typeof node !== "object" || node === null) return null;
  if (seen.has(node)) return null;
  seen.add(node);

  if (Array.isArray(node)) {
    for (const [index, item] of node.entries()) {
      const hit = findInstructions(item, [...segments, String(index)], seen);
      if (hit) return hit;
    }
    return null;
  }

  const record = node as Record<string, unknown>;

  // Only a section's own `instructions` *property* is the legacy key. Inside a
  // `sections:` map the keys are section names the author chose, and a section
  // legitimately called "instructions" - TGDP's README doctype wants one - must
  // not be mistaken for it. So descend into a `sections` map without testing
  // its keys, and test the property everywhere else.
  const insideSectionsMap = segments.at(-1) === "sections";
  if (!insideSectionsMap && "instructions" in record) {
    return {
      path: segments.join("."),
      name: suggestEvalName(segments),
      values: stringsOf(record.instructions),
    };
  }
  for (const [key, value] of Object.entries(record)) {
    const hit = findInstructions(value, [...segments, key], seen);
    if (hit) return hit;
  }
  return null;
}

/**
 * The message a template still carrying `instructions` gets: what replaced the
 * feature, and the config to paste, with the author's own instruction in it.
 */
function instructionsMessage(source: string, hit: InstructionsHit): string {
  const assertion = hit.values[0] ?? "";
  return [
    `${source}: "${hit.path}" uses \`instructions\`, which moose-lint no longer evaluates — structure checking is deterministic. Move it to a moose-docevals assertion eval in moose.config.yaml:`,
    "",
    "  docevals:",
    "    evals:",
    `      ${hit.name}:`,
    `        assertion: ${assertion}`,
    "        grader: ai",
  ].join("\n");
}

/** `/templates/how-to/sections/title must NOT have additional properties (foo)`. */
function describeError(error: ErrorObject): string {
  const params = error.params as { additionalProperty?: unknown };
  const extra =
    typeof params.additionalProperty === "string" ? ` ("${params.additionalProperty}")` : "";
  return `${error.instancePath || "/"} ${error.message ?? "is invalid"}${extra}`;
}

/**
 * Validate a parsed, dereferenced template file, filling in rule defaults.
 *
 * Throws `MooseLintError` naming `source` and the offending instance path. The
 * pre-rewrite loader threw a bare "Template is invalid" and passed the real
 * detail as `new Error(msg, {message: ...})` - an options bag that only
 * understands `cause` - so every schema error reached the user as four words.
 */
export function validateTemplateFile(data: unknown, source: string): TemplateFile {
  const instructions = findInstructions(data);
  if (instructions) throw new MooseLintError(instructionsMessage(source, instructions));

  const validate = fileValidator();
  if (!validate(data)) {
    const errors = validate.errors ?? [];
    const detail = errors.map(describeError).join("; ") || "does not match the template schema";
    throw new MooseLintError(`${source} is not a valid template file: ${detail}.`);
  }
  return data as TemplateFile;
}

/* -------------------------------------------------------------------------- *
 * Loading
 * -------------------------------------------------------------------------- */

/** Split `./templates.yaml#how-to` into its file part and template name. */
function splitFragment(ref: string): { base: string; fragment: string | null } {
  const hash = ref.lastIndexOf("#");
  if (hash === -1) return { base: ref, fragment: null };
  return { base: ref.slice(0, hash), fragment: ref.slice(hash + 1) || null };
}

/** The part of a ref an extension should be read off - a URL's path, not its query. */
function extensionSource(ref: string, kind: RefKind): string {
  if (kind !== "url") return ref;
  try {
    return new URL(ref).pathname;
  } catch {
    return ref;
  }
}

/**
 * Parse a template file by extension. Anything unrecognized is parsed as YAML,
 * which is a superset of JSON, so an extensionless URL still loads.
 */
function parseTemplateFile(raw: string, source: string, kind: RefKind): unknown {
  const lower = extensionSource(source, kind).toLowerCase();
  if (lower.endsWith(".json")) {
    try {
      return JSON.parse(raw) as unknown;
    } catch (err) {
      throw new MooseLintError(`${source} is not valid JSON: ${(err as Error).message}`);
    }
  }
  try {
    return parseYaml(raw) as unknown;
  } catch (err) {
    throw new MooseLintError(`${source} is not valid YAML: ${(err as Error).message}`);
  }
}

async function readText(ref: string): Promise<string> {
  try {
    return await readFile(ref, "utf8");
  } catch {
    throw new MooseLintError(`Template file not found: "${ref}".`);
  }
}

const urlCache = new Map<string, TemplateFile>();

async function fetchText(ref: string, timeoutMs: number): Promise<string> {
  let res: Response;
  try {
    res = await fetch(ref, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    const e = err as Error;
    if (e.name === "TimeoutError" || e.name === "AbortError") {
      throw new MooseLintError(
        `Failed to fetch template file "${ref}": timed out after ${timeoutMs}ms.`,
      );
    }
    throw new MooseLintError(`Failed to fetch template file "${ref}": ${e.message}`);
  }
  if (!res.ok) {
    throw new MooseLintError(`Failed to fetch template file "${ref}": HTTP ${res.status}.`);
  }
  return await res.text();
}

/** Resolve every `$ref` in place, so validation never sees one. */
async function dereferenceTemplates(
  data: Record<string, unknown>,
  source: string,
): Promise<Record<string, unknown>> {
  try {
    return await dereference<Record<string, unknown>>(data);
  } catch (err) {
    throw new MooseLintError(`${source}: could not resolve a "$ref": ${(err as Error).message}`);
  }
}

/** Load, dereference, and validate a whole template file. */
export async function loadTemplateFile(
  ref: string,
  options: LoadTemplateOptions = {},
): Promise<TemplateFile> {
  const { kind } = classifyRef(ref);
  if (kind === "builtin") {
    throw new MooseLintError(
      `"${ref}" is a built-in template id, not a template file. Load it with loadTemplate().`,
    );
  }

  const cached = kind === "url" ? urlCache.get(ref) : undefined;
  if (cached) return cached;

  const raw =
    kind === "url"
      ? await fetchText(ref, options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
      : await readText(ref);

  const parsed = parseTemplateFile(raw, ref, kind);
  if (!isRecord(parsed)) {
    throw new MooseLintError(
      `${ref} is not a template file: expected an object at the top level, got ${
        parsed === null ? "null" : Array.isArray(parsed) ? "an array" : typeof parsed
      }.`,
    );
  }

  const file = validateTemplateFile(await dereferenceTemplates(parsed, ref), ref);
  if (kind === "url") urlCache.set(ref, file);
  return file;
}

/**
 * Resolve a single template.
 *
 * A built-in id names one directly. A file or URL may name one inside itself
 * with a `#` fragment; without a fragment a single-template file resolves
 * unambiguously and anything else is an error listing what is on offer.
 *
 * `extends` is left unresolved - see `resolveExtends`.
 */
export async function loadTemplate(
  ref: string,
  options: LoadTemplateOptions = {},
): Promise<Template> {
  const { base, fragment } = splitFragment(ref);
  const { kind } = classifyRef(base);

  if (kind === "builtin") {
    if (!BUILTINS.has(base)) {
      const available = [...BUILTINS.keys()].join(", ");
      throw new MooseLintError(
        `Unknown built-in template "${base}". Available: ${available || "(none)"}.`,
      );
    }
    return loadBuiltin(base);
  }

  const file = await loadTemplateFile(base, options);
  const templates = file.templates ?? {};
  const names = Object.keys(templates);

  if (fragment !== null) {
    const named = templates[fragment];
    if (!named) {
      throw new MooseLintError(
        `${base} has no template named "${fragment}". Available: ${names.join(", ") || "(none)"}.`,
      );
    }
    return named;
  }

  if (names.length === 1) return templates[names[0]!]!;
  if (names.length === 0) throw new MooseLintError(`${base} defines no templates.`);
  throw new MooseLintError(
    `${base} defines ${names.length} templates; name one with a "#" fragment ` +
      `(e.g. "${base}#${names[0]}"). Available: ${names.join(", ")}.`,
  );
}

/* -------------------------------------------------------------------------- *
 * Inheritance
 * -------------------------------------------------------------------------- */

/** How `resolveExtends` turns an `extends` ref into a template. */
export type TemplateResolver = (ref: string) => Promise<Template>;

/**
 * Merge a child template onto its parent.
 *
 * Recursion follows `sections` and stops there. A section's own rules are units:
 * overriding `paragraphs` means replacing that rule, not merging a child's `min`
 * into the parent's `max` and hoping the pair still means something. But
 * `sections` is a container, not a rule - replacing it wholesale would mean that
 * tightening one nested section silently discards every sibling the parent
 * declared, which is the opposite of what `extends` is for.
 *
 * So: `sections` merges by key, recursively, all the way down; every other key
 * the child sets replaces the parent's outright.
 */
function mergeSectionMaps(
  parent: Record<string, TemplateSection> | undefined,
  child: Record<string, TemplateSection> | undefined,
): Record<string, TemplateSection> | undefined {
  if (!parent) return child;
  if (!child) return parent;

  // Parent order first, so inherited sections keep the document order the
  // parent declared and child-only additions land at the end.
  const merged: Record<string, TemplateSection> = { ...parent };
  for (const [name, childSection] of Object.entries(child)) {
    const parentSection = parent[name];
    merged[name] = parentSection
      ? mergeSections(parentSection, childSection)
      : childSection;
  }
  return merged;
}

function mergeSections(
  parent: TemplateSection,
  child: TemplateSection,
): TemplateSection {
  const merged: TemplateSection = { ...parent, ...child };
  const sections = mergeSectionMaps(parent.sections, child.sections);
  if (sections) merged.sections = sections;
  return merged;
}

function mergeTemplates(parent: Template, child: Template): Template {
  const merged: Template = { ...parent, ...child };
  const sections = mergeSectionMaps(parent.sections, child.sections);
  if (sections) merged.sections = sections;
  // The chain is resolved; leaving `extends` on would invite resolving twice.
  delete merged.extends;
  return merged;
}

/**
 * Resolve a template's `extends` chain, innermost first.
 *
 * `load` is injected because a relative `extends` is relative to the file the
 * child came from, which this function has no way to know. `chain` is internal
 * bookkeeping for cycle detection.
 */
export async function resolveExtends(
  template: Template,
  load: TemplateResolver = loadTemplate,
  chain: string[] = [],
): Promise<Template> {
  const parentRef = template.extends;
  if (parentRef === undefined) return template;

  if (chain.includes(parentRef)) {
    throw new MooseLintError(
      `Template "extends" cycle: ${[...chain, parentRef].join(" -> ")}.`,
    );
  }

  const parent = await resolveExtends(await load(parentRef), load, [...chain, parentRef]);
  return mergeTemplates(parent, template);
}

/* -------------------------------------------------------------------------- *
 * Resolution relative to the declaring file
 * -------------------------------------------------------------------------- */

/**
 * Re-base a ref against the file that declared it.
 *
 * A built-in id, a URL, and an absolute path all name themselves and are
 * returned unchanged. A relative path means "beside the file I am written in",
 * which is the one reading `loadTemplate` cannot produce on its own - it reads
 * against the process working directory, so `extends: ./base.yaml` in
 * `tpl/house.yaml` looked for `./base.yaml` at the cwd and found either nothing
 * or, worse, an unrelated file of that name.
 */
export function refRelativeTo(baseRef: string, ref: string): string {
  const { base, fragment } = splitFragment(ref);
  if (classifyRef(base).kind !== "file" || isAbsolute(base)) return ref;

  const { base: fromBase } = splitFragment(baseRef);
  if (classifyRef(fromBase).kind !== "file") return ref;

  const rebased = resolvePath(dirname(fromBase), base);
  return fragment === null ? rebased : `${rebased}#${fragment}`;
}

/**
 * Load a template with its `extends` chain resolved, re-basing each relative
 * ref against the file that declared it.
 *
 * This is what a caller should use. `resolveExtends` stays exported for callers
 * that supply their own resolver, but its default is the cwd-relative
 * `loadTemplate`, and reaching that default silently is the bug this exists to
 * avoid - `.then(resolveExtends)` passes one argument, so the default is
 * exactly what you get.
 */
export async function loadResolvedTemplate(
  ref: string,
  options: LoadTemplateOptions = {},
  chain: string[] = [],
): Promise<Template> {
  const template = await loadTemplate(ref, options);
  const parentRef = template.extends;
  if (parentRef === undefined) return template;

  const absolute = refRelativeTo(ref, parentRef);
  if (chain.includes(absolute)) {
    throw new MooseLintError(
      `Template "extends" cycle: ${[...chain, absolute].join(" -> ")}.`,
    );
  }

  const parent = await loadResolvedTemplate(absolute, options, [
    ...chain,
    absolute,
  ]);
  return mergeTemplates(parent, template);
}
