/**
 * Parser registry. Maps file extensions to parsers and resolves a parser by
 * name for the `--as` override.
 *
 * Shaped after docmeta's extractor registry, and for the same reason:
 * everything downstream of `parse()` operates on the generic `DocumentTree`, so
 * adding a format is one file plus one line here - no change to matching,
 * rules, templates, or reporting.
 *
 * Every registered format is implemented today. `DocumentParser.implemented`
 * stays because the roadmap-stub pattern is what kept the pre-rewrite
 * `inferFileType` from quietly parsing an `.rst` file as Markdown: a format
 * that is coming should be registered with `implemented: false` and a `parse`
 * that throws a `MooseLintError` naming it, so `moose-lint formats` reports the
 * gap and a file of that type is skipped by name rather than mis-parsed.
 */
import type { DocumentParser } from "../types.js";
import { markdownParser, mdxParser } from "./markdown.js";
import { htmlParser } from "./html.js";
import { rstParser } from "./rst.js";
import { xmlParser } from "./xml.js";
import { asciidocParser } from "./asciidoc.js";

export const PARSERS: DocumentParser[] = [
  markdownParser,
  mdxParser,
  htmlParser,
  asciidocParser,
  rstParser,
  xmlParser,
];

const byExtension = new Map<string, DocumentParser>();
const byName = new Map<string, DocumentParser>();
for (const parser of PARSERS) {
  byName.set(parser.name, parser);
  for (const ext of parser.extensions) byExtension.set(ext.toLowerCase(), parser);
}

/**
 * Resolve a parser for a file extension (including the dot). Returns a
 * registered but unimplemented parser too, so the caller can report the format
 * by name instead of treating the file as unknown.
 */
export function parserForExtension(ext: string): DocumentParser | undefined {
  return byExtension.get(ext.toLowerCase());
}

/** Resolve a parser by its `--as` name, implemented or not. */
export function parserByName(name: string): DocumentParser | undefined {
  return byName.get(name.toLowerCase());
}

/** Extensions handled by implemented parsers. Used for directory walks. */
export function supportedExtensions(): string[] {
  return PARSERS.filter((p) => p.implemented).flatMap((p) => p.extensions);
}

/** Every registered format, for `moose-lint formats`. */
export function listFormats(): {
  name: string;
  label: string;
  extensions: string[];
  implemented: boolean;
}[] {
  return PARSERS.map((p) => ({
    name: p.name,
    label: p.label,
    extensions: p.extensions,
    implemented: p.implemented,
  }));
}
