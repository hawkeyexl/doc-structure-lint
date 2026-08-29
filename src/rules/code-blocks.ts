/**
 * `code_blocks:` - code block counts.
 */

import type { ContentNode, Finding, SectionNode } from "../types.js";
import {
  codeBlocksOf,
  sectionContext,
  type CodeBlocksRule,
  type RuleContext,
} from "./index.js";

/** Checks the code blocks a section holds directly. */
export function checkCodeBlocks(
  section: SectionNode,
  rule: CodeBlocksRule | undefined
): Finding[] {
  return checkCodeBlocksIn(section.content, rule, sectionContext(section));
}

/**
 * The reusable core: checks the code blocks in any ordered content list -
 * a section's content, a list item's `children`, or one run of a `sequence`.
 */
export function checkCodeBlocksIn(
  content: ContentNode[],
  rule: CodeBlocksRule | undefined,
  ctx: RuleContext
): Finding[] {
  const findings: Finding[] = [];
  if (!rule) return findings;

  const codeBlocks = codeBlocksOf(content);

  if (rule.min && codeBlocks.length < rule.min) {
    findings.push({
      type: "code_blocks_count_error",
      heading: ctx.heading,
      message: `Expected at least ${rule.min} code blocks, but found ${codeBlocks.length}`,
      position: ctx.position,
      severity: "error",
    });
  }

  if (rule.max !== undefined && codeBlocks.length > rule.max) {
    findings.push({
      type: "code_blocks_count_error",
      heading: ctx.heading,
      message: `Expected at most ${rule.max} code blocks, but found ${codeBlocks.length}`,
      position: ctx.position,
      severity: "error",
    });
  }

  return findings;
}
