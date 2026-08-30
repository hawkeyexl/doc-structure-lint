/**
 * The template DSL, as TypeScript. `src/schemas/template.json` is the
 * authority that user input is validated against; this is the shape the rest of
 * the code reads once that validation has passed.
 */
import { compilePattern } from "../rules/index.js";
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
   * Whether this rule may claim more than one section. Default false.
   *
   * On an anchored rule it claims the run of consecutive sections whose
   * headings satisfy it - how a doctype says "one or more sections named
   * `Symptom N`" without giving up checking the heading text. On a slot it
   * claims every section up to the next anchored rule that could claim one.
   *
   * Opt-in either way. A slot that repeated by default would swallow the
   * section belonging to the slot after it, which adjacent unconstrained
   * sections - `Setup` then `Usage` - make an ordinary shape.
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
 * `## {Task name}` is the motivating case. A slot matches any heading, and
 * claims exactly one section unless it sets `repeat`.
 *
 * Being a slot changes more than heading matching: `match.ts` reads it when
 * deciding what may end a repeating run, and a slot is the one kind of rule
 * that cannot distinguish the section it wants from any other.
 */
export function isSlot(rule: TemplateSection): boolean {
  return !rule.heading?.const && !rule.heading?.pattern;
}

/** Whether a section's heading satisfies a rule's heading constraint. */
export function headingMatches(title: string, rule: TemplateSection): boolean {
  if (isSlot(rule)) return true;
  if (rule.heading?.const !== undefined) return title === rule.heading.const;
  if (rule.heading?.pattern !== undefined) {
    return compilePattern(rule.heading.pattern).test(title);
  }
  return true;
}
