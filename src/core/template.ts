/**
 * The template DSL, as TypeScript. `src/schemas/template.json` is the
 * authority that user input is validated against; this is the shape the rest of
 * the code reads once that validation has passed.
 */
import type {
  CodeBlocksRule,
  HeadingRule,
  ListsRule,
  ParagraphsRule,
  SequenceRule,
} from "../rules/index.js";

export interface TemplateSection {
  /** Prose description of the section's purpose. Not validated against. */
  description?: string;
  heading?: HeadingRule;
  /** Default true. */
  required?: boolean;
  paragraphs?: ParagraphsRule;
  code_blocks?: CodeBlocksRule;
  lists?: ListsRule;
  sequence?: SequenceRule;
  /**
   * For a slot rule, whether it may claim more than one section. Default
   * false: a placeholder heading stands for one section unless the template
   * says otherwise. TGDP's repeated placeholders - `{Task name}`, `Symptom 1`
   * - set this; a template that simply does not constrain a heading, like a
   * `Setup` section between two other named ones, does not and must not, or it
   * would swallow every section after it.
   */
  repeat?: boolean;
  /** Allow document sections this template does not describe. Default false. */
  additionalSections?: boolean;
  /** Subsection rules, in document order. */
  sections?: Record<string, TemplateSection>;
}

export interface Template {
  /** Doctypes this template serves, matched against a page's `type`. */
  types?: string[];
  /** Built-in id or path to inherit from. */
  extends?: string;
  additionalSections?: boolean;
  sections?: Record<string, TemplateSection>;
}

/** A template file: named templates plus reusable `$ref` targets. */
export interface TemplateFile {
  templates?: Record<string, Template>;
  components?: Record<string, unknown>;
  info?: Record<string, unknown>;
}

/** A rule is required unless it says otherwise. */
export function isRequired(rule: TemplateSection): boolean {
  return rule.required !== false;
}

/**
 * A rule is a "slot" when it constrains no heading text - TGDP's
 * `## {Task name}` and `## Symptom 1` are the motivating cases. Slots match any
 * heading, and are greedy (see `match.ts`), because a placeholder heading in a
 * published template means "one or more sections go here", not "exactly one".
 */
export function isSlot(rule: TemplateSection): boolean {
  return !rule.heading?.const && !rule.heading?.pattern;
}

/** Whether a section's heading satisfies a rule's heading constraint. */
export function headingMatches(title: string, rule: TemplateSection): boolean {
  if (isSlot(rule)) return true;
  if (rule.heading?.const !== undefined) return title === rule.heading.const;
  if (rule.heading?.pattern !== undefined) {
    return new RegExp(rule.heading.pattern).test(title);
  }
  return true;
}
