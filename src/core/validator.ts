/**
 * Run a template over a parsed document.
 *
 * Matching and checking are deliberately separate: `match.ts` decides which
 * section each rule is talking about, and this module asks the content rules
 * about the pairs it produced. The old code fused the two - it inferred which
 * section a rule meant by running the rules and seeing whether they passed -
 * which made "does this section match?" and "is this section valid?" the same
 * question, so a section could never be both matched and wrong.
 *
 * Everything here is synchronous. It was async only to await a language model,
 * which this tool no longer has.
 */
import type { DocumentTree, Finding, SectionNode } from "../types.js";
import {
  checkCodeBlocks,
  checkHeading,
  checkLists,
  checkParagraphs,
  checkSequence,
} from "../rules/index.js";
import { matchSections } from "./match.js";
import type { Template, TemplateSection } from "./template.js";

/** Content and heading rules for one matched pair, without recursion. */
function checkSection(section: SectionNode, rule: TemplateSection): Finding[] {
  const findings: Finding[] = [];
  if (rule.heading) findings.push(...checkHeading(section, rule.heading));
  if (rule.sequence) findings.push(...checkSequence(section, rule.sequence));
  if (rule.paragraphs) findings.push(...checkParagraphs(section, rule.paragraphs));
  if (rule.code_blocks) findings.push(...checkCodeBlocks(section, rule.code_blocks));
  if (rule.lists) findings.push(...checkLists(section, rule.lists));
  return findings;
}

/** Match one level of sections, check each pair, then recurse. */
export function validateSections(
  sections: SectionNode[],
  templateSections: Record<string, TemplateSection> | undefined,
  options: { additionalSections?: boolean; parent?: SectionNode | null } = {},
): Finding[] {
  const { matches, findings } = matchSections(sections, templateSections, options);
  const all = [...findings];

  for (const match of matches) {
    all.push(...checkSection(match.section, match.rule));
    if (match.rule.sections) {
      all.push(
        ...validateSections(match.section.sections, match.rule.sections, {
          additionalSections: match.rule.additionalSections,
          parent: match.section,
        }),
      );
    }
  }

  return all;
}

/** Findings for one document against one template, in document order. */
export function validateDocument(tree: DocumentTree, template: Template): Finding[] {
  const findings = validateSections(tree.sections, template.sections, {
    additionalSections: template.additionalSections,
    parent: null,
  });

  // Rules fire in rule order, which is not necessarily document order once a
  // template mixes optional sections and subsections. Readers scan a report top
  // to bottom against the file, so sort by where the finding actually is.
  return findings.sort(
    (a, b) => a.position.start.offset - b.position.start.offset,
  );
}
