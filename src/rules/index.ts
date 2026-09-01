/**
 * Content rules: the checks that run against a single section's own content.
 *
 * A rule is a pure, synchronous function of one `SectionNode` and its slice of
 * a template, returning `Finding[]`. Rules never touch a parser AST and never
 * await anything.
 *
 * The content model is format-neutral and flat: a section carries one ordered
 * `content: ContentNode[]`, and the paragraph/code/list "buckets" every rule
 * needs are queries over it (`paragraphsOf`, `codeBlocksOf`, `listsOf`) rather
 * than separately maintained arrays. The same queries work unchanged on a list
 * item's `children`, which is why `lists.items` can recurse.
 */

import { MooseLintError } from "../types.js";
import type {
  CodeNode,
  ContentNode,
  ListNode,
  ParagraphNode,
  Position,
  SectionNode,
} from "../types.js";

/* -------------------------------------------------------------------------- *
 * Template rule shapes
 *
 * These mirror the template DSL one-for-one.
 * Each `checkX` takes exactly the slice named after it.
 * -------------------------------------------------------------------------- */

/** `heading:` - the section's title must equal `const` and/or match `pattern`. */
export interface HeadingRule {
  const?: string;
  pattern?: string;
}

/** `paragraphs:` - how many paragraphs, and what they must look like. */
export interface ParagraphsRule {
  min?: number;
  max?: number;
  /** Regex sources, applied to paragraphs in order and cycled when exhausted. */
  patterns?: string[];
}

/** `code_blocks:` - how many code blocks. */
export interface CodeBlocksRule {
  min?: number;
  max?: number;
}

/** `lists.items:` - how many items per list, and what each item must contain. */
export interface ListItemsRule {
  min?: number;
  max?: number;
  /** Runs against each item's `children`. */
  paragraphs?: ParagraphsRule;
  /** Runs against each item's `children`. */
  code_blocks?: CodeBlocksRule;
  /** Runs against each item's `children`; recurses arbitrarily deep. */
  lists?: ListsRule;
}

/** `lists:` - how many lists, and item-level requirements. */
export interface ListsRule {
  min?: number;
  max?: number;
  items?: ListItemsRule;
}

/**
 * One entry of `sequence:`. Exactly one key is set; the key names the content
 * kind expected at that position and its value constrains that run.
 */
export interface SequenceItemRule {
  paragraphs?: ParagraphsRule;
  code_blocks?: CodeBlocksRule;
  lists?: ListsRule;
}

/** `sequence:` - the ordered runs of content a section must contain. */
export type SequenceRule = SequenceItemRule[];

/* -------------------------------------------------------------------------- *
 * Finding anchoring
 * -------------------------------------------------------------------------- */

/**
 * Where findings land when a rule runs over content that is not a whole
 * section - a list item's `children`, or one run inside a `sequence`.
 */
export interface RuleContext {
  /** Stamped onto every finding as `Finding.heading`. */
  heading: string | null;
  /** Used when the offending thing is a count rather than a single node. */
  position: Position;
}

/** The context for rules run against a section's own content. */
export function sectionContext(section: SectionNode): RuleContext {
  return { heading: section.title, position: section.position };
}

/* -------------------------------------------------------------------------- *
 * Content queries
 *
 * The single place the flat content array is bucketed by kind. Rules call
 * these; they never filter inline.
 * -------------------------------------------------------------------------- */

/** The paragraphs in an ordered content list, in document order. */
export function paragraphsOf(content: ContentNode[]): ParagraphNode[] {
  return content.filter((node): node is ParagraphNode => node.kind === "paragraph");
}

/** The code blocks in an ordered content list, in document order. */
export function codeBlocksOf(content: ContentNode[]): CodeNode[] {
  return content.filter((node): node is CodeNode => node.kind === "code");
}

/** The lists in an ordered content list, in document order. */
export function listsOf(content: ContentNode[]): ListNode[] {
  return content.filter((node): node is ListNode => node.kind === "list");
}

/* -------------------------------------------------------------------------- *
 * The rules
 * -------------------------------------------------------------------------- */

export { checkHeading } from "./heading.js";
export { checkParagraphs, checkParagraphsIn } from "./paragraphs.js";
export { checkCodeBlocks, checkCodeBlocksIn } from "./code-blocks.js";
export { checkLists, checkListsIn } from "./lists.js";
export { checkSequence, groupRuns } from "./sequence.js";
export type { ContentRun } from "./sequence.js";

/**
 * Compile an author-supplied pattern, or say which one is broken.
 *
 * A pattern comes from a template, so a bad one is a broken template rather
 * than a lint finding - and the raw `SyntaxError` names the regex but not the
 * template, the section, or the file. Every caller must route the result
 * through the same containment a template load failure gets, or one bad
 * pattern takes the whole run down with it.
 */
const compiled = new Map<string, RegExp>();

export function compilePattern(pattern: string): RegExp {
  // Memoized because heading matching is quadratic by nature: the matcher asks
  // every rule about every section, so a template with ten pattern rules against
  // a twenty-section page compiled the same ten regexes two hundred times.
  //
  // Safe to share one instance: these are built with no flags, and `lastIndex`
  // is only carried between calls by `g` and `y`. Adding either to this
  // construction would make the cached regex stateful across sections.
  const hit = compiled.get(pattern);
  if (hit) return hit;
  try {
    const regex = new RegExp(pattern);
    compiled.set(pattern, regex);
    return regex;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new MooseLintError(`Invalid pattern "${pattern}": ${reason}`);
  }
}

/** Drop the compiled-pattern memo. See `clearCaches` in the package root. */
export function clearPatternCache(): void {
  compiled.clear();
}
