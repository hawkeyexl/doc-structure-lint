/**
 * `heading:` - the section's title must equal a constant and/or match a regex.
 */

import type { Finding, SectionNode } from "../types.js";
import { compilePattern } from "./index.js";
import type { HeadingRule } from "./index.js";

/**
 * Checks a section's title against the template's heading rule.
 *
 * Both constraints are independent: a rule carrying `const` and `pattern` can
 * produce two findings for one title.
 */
export function checkHeading(
  section: SectionNode,
  rule: HeadingRule | undefined
): Finding[] {
  const findings: Finding[] = [];
  if (!rule) return findings;

  // The heading itself is the offending node when it has a span of its own;
  // the implicit lead section has none, so fall back to the section.
  const position = section.headingPosition ?? section.position;

  if (rule.const && section.title !== rule.const) {
    findings.push({
      type: "heading_const_error",
      heading: section.title,
      message: `Expected title "${rule.const}", but found "${section.title}"`,
      position,
      severity: "error",
    });
  }

  if (rule.pattern && !compilePattern(rule.pattern).test(section.title)) {
    findings.push({
      type: "heading_pattern_error",
      heading: section.title,
      message: `Title "${section.title}" doesn't match pattern "${rule.pattern}"`,
      position,
      severity: "error",
    });
  }

  return findings;
}
