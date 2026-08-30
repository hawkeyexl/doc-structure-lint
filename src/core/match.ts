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
 *  - `repeat` applies to anchored rules too, where it claims the run of
 *    consecutive sections whose headings satisfy the rule. That is how a
 *    doctype says "one or more sections named `Symptom N`" without giving up
 *    checking the heading text.
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

/**
 * Could a later *anchored* rule claim this section by its heading?
 *
 * Used to end a slot's run, and to stop an earlier rule taking a section a
 * later one names. Slots are excluded on purpose: a slot claims anything, so
 * counting them would make every lookahead true and stop every slot before it
 * consumed a single section.
 *
 * `requiredOnly` separates "who describes this section better" from "who
 * cannot do without it", and the two callers want different answers. A slot,
 * or an optional rule, yields to any later rule that names the section: the
 * named rule describes it better, and standing aside costs nothing either way.
 * A *required* rule yields only to another required rule - giving up a section
 * it needs so an optional rule can have one the template says it can live
 * without turns a clean document into a missing-section finding.
 */
function claimedLater(
  rules: Rule[],
  from: number,
  section: SectionNode,
  requiredOnly = false,
): boolean {
  for (let i = from; i < rules.length; i++) {
    const { rule } = rules[i]!;
    if (isSlot(rule)) continue;
    if (requiredOnly && !isRequired(rule)) continue;
    if (headingMatches(section.title, rule)) return true;
  }
  return false;
}

/**
 * Are there at least as many sections left as required rules left?
 *
 * This is what decides whether a required rule that matched nothing should
 * nevertheless pair with the section at the cursor, so the report reads
 * "expected X, found Y" instead of missing + unexpected.
 *
 * Coercion is right when the document has a section for every rule and simply
 * named one wrong - the everyday typo. It is wrong when the document is short,
 * because then something really is absent, and pairing the survivors up shifts
 * every later rule by one: the exact misalignment this matcher was rebuilt to
 * eliminate. Counting is enough to tell the two apart, and it stays O(n) - the
 * alternative is choosing between assignments, which is backtracking.
 */
function enoughSectionsRemain(
  rules: Rule[],
  from: number,
  sectionsRemaining: number,
): boolean {
  let required = 0;
  for (let i = from; i < rules.length; i++) {
    if (isRequired(rules[i]!.rule)) required++;
  }
  return sectionsRemaining >= required;
}

/**
 * First index at or after `from` whose section satisfies `rule` - but never
 * scanning past a section some later rule could claim.
 *
 * Scanning ahead is how sections that appear before an expected one get
 * absorbed as extras. Unbounded, it strands the ones that belong to later
 * rules: an optional rule matching near the end of the document would mark
 * every section in between as extra, including the section a later *required*
 * rule was going to match, which then reports as missing as well. That is one
 * misplaced heading producing both `missing_section` and `unexpected_section`
 * for the same title - the cascade this matcher exists to avoid.
 */
function findForward(
  sections: SectionNode[],
  from: number,
  rule: TemplateSection,
  rules: Rule[],
  ri: number,
): number {
  const requiredOnly = isRequired(rule);
  for (let i = from; i < sections.length; i++) {
    // The later claim is tested first, because a section can satisfy both
    // rules and only one of them can have it. A loose rule reaching a section
    // a stricter later rule names exactly - `^Symptom` reaching `Symptom
    // summary` - would otherwise take it and leave that rule missing, which is
    // the same cascade the bounded scan exists to prevent, one section earlier.
    if (claimedLater(rules, ri + 1, sections[i]!, requiredOnly)) return -1;
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

    // Anchored rule. It claims one section, or - with `repeat` - the whole run
    // of consecutive sections whose headings satisfy it. Repetition is not a
    // slot-only affordance: "one or more sections named `Symptom N`" is a real
    // doctype shape, and expressing it as an unconstrained slot would give up
    // checking the heading text in exchange for the repetition.
    //
    // The run is found either at the cursor or further on. Scanning ahead is
    // how extra sections before an expected one are absorbed, and the run has
    // to continue from wherever it starts - a single stray section ahead of a
    // repeating rule must not silently demote it to one match, because the
    // sections it would have claimed then become unexpected and, worse, are
    // never descended into.
    // The section at the cursor is the common case and is taken directly - but
    // it goes through the same lookahead as a scanned-to one. Without that, a
    // rule loose enough to match a heading a later rule names exactly took it
    // whenever it happened to sit at the cursor, and the bounded scan below,
    // which does check, was never consulted.
    const at =
      cursor < sections.length &&
      headingMatches(sections[cursor]!.title, rule) &&
      !claimedLater(rules, ri + 1, sections[cursor]!, isRequired(rule))
        ? cursor
        : findForward(sections, cursor, rule, rules, ri);

    if (at !== -1) {
      for (let i = cursor; i < at; i++) extras.push(sections[i]!);
      cursor = at;
      do {
        matches.push({ name, rule, section: sections[cursor]!, coerced: false });
        cursor++;
      } while (
        rule.repeat === true &&
        cursor < sections.length &&
        headingMatches(sections[cursor]!.title, rule) &&
        // The same guard the slot branch applies. Without it a repeating rule
        // whose pattern also matches a later rule's heading consumes that
        // section too, and then validates it against the wrong subsections -
        // so the later rule reports missing and the stolen section reports
        // whatever the repeating rule required of it.
        !claimedLater(rules, ri + 1, sections[cursor]!)
      );
      continue;
    }

    if (!isRequired(rule)) continue;

    // Required, and no section anywhere satisfies it. Pair with the section at
    // the cursor when nothing else names it and the document is long enough to
    // satisfy the rules that follow - a misnamed section rather than a missing
    // one.
    const here = sections[cursor];
    if (
      here &&
      !claimedLater(rules, ri + 1, here) &&
      enoughSectionsRemain(rules, ri, sections.length - cursor)
    ) {
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
