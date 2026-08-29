/**
 * Roadmap parsers: registered, not implemented.
 *
 * Registering a format we cannot parse yet is not dead weight. It is what makes
 * `moose-lint formats` honest, and what turns a `.rst` file from something
 * quietly parsed as Markdown - which the pre-rewrite `inferFileType` did for
 * every unrecognized extension - into a named, reported gap.
 */
import type { DocumentParser } from "../types.js";
import { MooseLintError } from "../types.js";

export function stubParser(
  name: string,
  label: string,
  extensions: string[],
): DocumentParser {
  return {
    name,
    label,
    extensions,
    implemented: false,
    parse(_content, filePath) {
      throw new MooseLintError(
        `${filePath}: ${label} is not implemented yet. Run "moose-lint formats" to see supported formats.`,
      );
    },
  };
}

export const asciidocParser = stubParser("asciidoc", "AsciiDoc", [
  ".adoc",
  ".asciidoc",
]);
export const rstParser = stubParser("rst", "reStructuredText", [".rst"]);
export const htmlParser = stubParser("html", "HTML", [".html", ".htm"]);
export const xmlParser = stubParser("xml", "XML", [".xml"]);
