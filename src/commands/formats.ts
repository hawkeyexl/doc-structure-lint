/**
 * `formats` command core. Reports every registered input format, implemented
 * or not.
 *
 * Listing the unimplemented ones is the whole point: the pre-rewrite
 * `inferFileType` defaulted every unrecognized extension to Markdown, so an
 * `.rst` file was quietly mis-parsed instead of being named as a gap. A
 * roadmap format that says "planned" here is a promise the tool can keep.
 *
 * Returns data; `src/reporters/index.ts` renders it.
 */
import { listFormats } from "../parsers/index.js";

export interface FormatInfo {
  /** Parser name, also what `--as` accepts. */
  name: string;
  label: string;
  extensions: string[];
  implemented: boolean;
}

export function runFormats(): FormatInfo[] {
  return listFormats();
}
