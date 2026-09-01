/**
 * `paragraphs:` - paragraph counts and per-paragraph patterns.
 */

import { MooseLintError } from "../types.js";
import type { ContentNode, Finding, ParagraphNode, SectionNode } from "../types.js";
import {
  compilePattern,
  paragraphsOf,
  sectionContext,
  type ParagraphsRule,
  type RuleContext,
} from "./index.js";

/** Checks the paragraphs a section holds directly. */
export function checkParagraphs(
  section: SectionNode,
  rule: ParagraphsRule | undefined
): Finding[] {
  return checkParagraphsIn(section.content, rule, sectionContext(section));
}

/**
 * The reusable core: checks the paragraphs in any ordered content list.
 *
 * Used for a section's own content, for a list item's `children`, and for one
 * run of a `sequence`. `ctx` says where count findings land and what heading
 * they carry.
 */
export function checkParagraphsIn(
  content: ContentNode[],
  rule: ParagraphsRule | undefined,
  ctx: RuleContext
): Finding[] {
  const findings: Finding[] = [];
  if (!rule) return findings;

  const paragraphs = paragraphsOf(content);

  if (rule.min && paragraphs.length < rule.min) {
    findings.push({
      type: "paragraphs_count_error",
      heading: ctx.heading,
      message: `Expected at least ${rule.min} paragraphs, but found ${paragraphs.length}`,
      position: ctx.position,
      severity: "error",
    });
  }

  if (rule.max !== undefined && paragraphs.length > rule.max) {
    findings.push({
      type: "paragraphs_count_error",
      heading: ctx.heading,
      message: `Expected at most ${rule.max} paragraphs, but found ${paragraphs.length}`,
      position: ctx.position,
      severity: "error",
    });
  }

  findings.push(...checkPatterns(paragraphs, rule.patterns, ctx));

  return findings;
}

/**
 * Applies `patterns` to paragraphs in order, cycling the list when there are
 * more paragraphs than patterns.
 */
function checkPatterns(
  paragraphs: ParagraphNode[],
  patterns: string[] | undefined,
  ctx: RuleContext
): Finding[] {
  const findings: Finding[] = [];
  if (!patterns || patterns.length === 0) return findings;

  const regexes = compilePatterns(patterns);

  paragraphs.forEach((paragraph, index) => {
    const regex = regexes[index % regexes.length];
    if (regex && !regex.test(paragraph.text)) {
      findings.push({
        type: "paragraph_pattern_error",
        heading: ctx.heading,
        message: `Paragraph ${index + 1} doesn't match expected pattern.`,
        position: paragraph.position,
        severity: "error",
      });
    }
  });

  return findings;
}

/** A pattern that will not compile is a broken template, not a lint finding. */
function compilePatterns(patterns: string[]): RegExp[] {
  return patterns.map(compilePattern);
}
