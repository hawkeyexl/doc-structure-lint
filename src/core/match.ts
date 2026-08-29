/**
 * Match a document's sections against a template's section rules, in order.
 *
 * The pre-rewrite code paired rules to sections by array index, so a single
 * missing optional section misaligned every comparison after it - and its
 * `additionalSections` path decided a section "was" a rule by running full
 * validation and treating zero errors as identity, which made any two loosely
 * constrained sections interchangeable. Neither survives contact with a real
 * doctype template, where optional sections are the norm.
 *
 * This is one left-to-right pass with three cases:
 *
 *  - An *anchored* rule (one that constrains heading text) matches at most one
 *    section. If the section at the cursor does not match, we scan ahead: a
 *    match further on means the sections in between are extra, no match at all
 *    means the rule is missing.
 *  - A *slot* rule (a placeholder heading like TGDP's `## {Task name}`) claims
 *    one section, or - when it sets `repeat` - every section up to the next
 *    anchored rule that can claim one. Repetition is opt-in rather than the
 *    default: two adjacent slots are common in hand-written templates, and a
 *    greedy first slot would swallow the second one's section.
 *  - An optional rule that does not match is simply skipped, and the cursor
 *    does not move.
 *
 * In every case a slot yields a section that some later anchored rule could
 * claim, so a named section is never consumed by an unnamed placeholder.
 */
import type { Finding, SectionNode } from "../types.js";
import {
  headingMatches,
  isRequired,
  isSlot,
  type TemplateSection,
} from "./template.js";

/** One rule paired with the section (if any) it claimed. */
export interface Match {
  name: string;
  rule: TemplateSection;
  section: SectionNode;
  /**
   * True when the rule was paired with a section whose heading does not
   * satisfy it, because nothing else could claim that section. Keeps the
   * precise "Expected title X, but found Y" report for the common one-for-one
   * case instead of degrading it into missing + unexpected.
   */
  coerced: boolean;
}

export interface MatchResult {
  matches: Match[];
  findings: Finding[];
}

interface Rule {
  name: string;
  rule: TemplateSection;
}

/** Anchor a finding on a section, or at the start of the parent when absent. */
function findingAt(
  type: string,
  message: string,
  section: SectionNode | undefined,
  parent: SectionNode | null,
): Finding {
  const anchor = section ?? parent;
  return {
    type,
    heading: anchor ? anchor.title || null : null,
    message,
    position: anchor
      ? anchor.position
      : {
          start: { line: 1, column: 1, offset: 0 },
          end: { line: 1, column: 1, offset: 0 },
        },
    severity: "error",
  };
}

/** Could any rule from `from` onward claim this section by its heading? */
function claimedLater(rules: Rule[], from: number, section: SectionNode): boolean {
  for (let i = from; i < rules.length; i++) {
    const { rule } = rules[i]!;
    // A slot claims anything, which would make every lookahead true and stop
    // every slot immediately. Only anchored rules can end a slot's run.
    if (isSlot(rule)) continue;
    if (headingMatches(section.title, rule)) return true;
  }
  return false;
}

/** First index at or after `from` whose section satisfies `rule`. */
function findForward(
  sections: SectionNode[],
  from: number,
  rule: TemplateSection,
): number {
  for (let i = from; i < sections.length; i++) {
    if (headingMatches(sections[i]!.title, rule)) return i;
  }
  return -1;
}

function describe(name: string, rule: TemplateSection): string {
  if (rule.heading?.const) return `"${rule.heading.const}"`;
  if (rule.heading?.pattern) return `"${name}" (heading matching /${rule.heading.pattern}/)`;
  return `"${name}"`;
}

export function matchSections(
  sections: SectionNode[],
  templateSections: Record<string, TemplateSection> | undefined,
  options: { additionalSections?: boolean; parent?: SectionNode | null } = {},
): MatchResult {
  const parent = options.parent ?? null;
  const allowExtra = options.additionalSections === true;
  const matches: Match[] = [];
  const findings: Finding[] = [];

  if (!templateSections) return { matches, findings };

  const rules: Rule[] = Object.entries(templateSections).map(([name, rule]) => ({
    name,
    rule,
  }));

  /** Sections consumed by no rule, reported once at the end. */
  const extras: SectionNode[] = [];
  let cursor = 0;

  for (let ri = 0; ri < rules.length; ri++) {
    const { name, rule } = rules[ri]!;

    if (isSlot(rule)) {
      const consumed: SectionNode[] = [];
      while (
        cursor < sections.length &&
        !claimedLater(rules, ri + 1, sections[cursor]!)
      ) {
        consumed.push(sections[cursor]!);
        cursor++;
        if (!rule.repeat) break;
      }
      if (consumed.length === 0) {
        if (isRequired(rule)) {
          findings.push(
            findingAt(
              "missing_section",
              `Missing section ${describe(name, rule)}`,
              sections[cursor],
              parent,
            ),
          );
        }
        continue;
      }
      for (const section of consumed) {
        matches.push({ name, rule, section, coerced: false });
      }
      continue;
    }

    // Anchored rule: at most one section.
    if (cursor < sections.length && headingMatches(sections[cursor]!.title, rule)) {
      matches.push({ name, rule, section: sections[cursor]!, coerced: false });
      cursor++;
      continue;
    }

    const ahead = findForward(sections, cursor, rule);
    if (ahead !== -1) {
      for (let i = cursor; i < ahead; i++) extras.push(sections[i]!);
      matches.push({ name, rule, section: sections[ahead]!, coerced: false });
      cursor = ahead + 1;
      continue;
    }

    if (!isRequired(rule)) continue;

    // Required, and no section anywhere satisfies it. If the section at the
    // cursor is not wanted by any later rule, pair with it anyway so the
    // report is "expected X, found Y" rather than two findings that make the
    // reader reconstruct that themselves.
    const here = sections[cursor];
    if (here && !claimedLater(rules, ri + 1, here)) {
      matches.push({ name, rule, section: here, coerced: true });
      cursor++;
      continue;
    }

    findings.push(
      findingAt(
        "missing_section",
        `Missing section ${describe(name, rule)}`,
        here,
        parent,
      ),
    );
  }

  for (let i = cursor; i < sections.length; i++) extras.push(sections[i]!);

  if (!allowExtra) {
    for (const section of extras) {
      findings.push(
        findingAt(
          "unexpected_section",
          `Unexpected section "${section.title}". Set additionalSections: true to allow sections the template does not describe.`,
          section,
          parent,
        ),
      );
    }
  }

  return { matches, findings };
}
