/**
 * `sequence:` - the ordered runs of content a section must contain.
 *
 * Content arrives flat and in document order, so consecutive nodes of the same
 * kind are first grouped into runs: `[p, p, code, list]` becomes three runs
 * (paragraphs, code_blocks, lists). Those runs are then matched positionally
 * against the template's sequence, and each run is handed to the ordinary
 * count/pattern rule for its kind.
 */

import type {
  ContentKind,
  ContentNode,
  Finding,
  Position,
  SectionNode,
} from "../types.js";
import { sectionContext, type RuleContext, type SequenceRule } from "./index.js";
import { checkParagraphsIn } from "./paragraphs.js";
import { checkCodeBlocksIn } from "./code-blocks.js";
import { checkListsIn } from "./lists.js";

/** The template keys a run can correspond to. */
type SequenceKey = "paragraphs" | "code_blocks" | "lists";

/** A maximal stretch of consecutive content nodes sharing one kind. */
export interface ContentRun {
  kind: ContentKind;
  nodes: ContentNode[];
  /** First node's start through last node's end. */
  position: Position;
}

/** Groups consecutive same-kind nodes into runs, preserving document order. */
export function groupRuns(content: ContentNode[]): ContentRun[] {
  const runs: ContentRun[] = [];

  for (const node of content) {
    const current = runs[runs.length - 1];
    if (current && current.kind === node.kind) {
      current.nodes.push(node);
      current.position = {
        start: current.position.start,
        end: node.position.end,
      };
    } else {
      runs.push({
        kind: node.kind,
        nodes: [node],
        position: { start: node.position.start, end: node.position.end },
      });
    }
  }

  return runs;
}

/**
 * Checks a section's content against the template's sequence.
 *
 * Bails after the first structural failure: once the runs are the wrong length
 * or the wrong order, per-run findings are noise about content the author has
 * not arranged yet.
 */
export function checkSequence(
  section: SectionNode,
  rule: SequenceRule | undefined
): Finding[] {
  const findings: Finding[] = [];
  if (!rule) return findings;

  const ctx = sectionContext(section);
  const runs = groupRuns(section.content);

  if (rule.length !== runs.length) {
    findings.push({
      type: "sequence_length_error",
      heading: ctx.heading,
      message: `Expected ${rule.length} content types in sequence, but found ${runs.length}`,
      position: ctx.position,
      severity: "error",
    });
    return findings;
  }

  const templateKeys = rule.map((item) => Object.keys(item)[0] ?? null);
  const runKeys = runs.map((run) => sequenceKeyOf(run.kind));

  if (runKeys.includes(null)) {
    findings.push({
      type: "sequence_order_error",
      heading: ctx.heading,
      message: "Unexpected content type found in sequence",
      position: ctx.position,
      severity: "error",
    });
    return findings;
  }

  if (JSON.stringify(templateKeys) !== JSON.stringify(runKeys)) {
    findings.push({
      type: "sequence_order_error",
      heading: ctx.heading,
      message: `Expected sequence ${JSON.stringify(templateKeys)}, but found sequence ${JSON.stringify(runKeys)}`,
      position: ctx.position,
      severity: "error",
    });
    return findings;
  }

  runs.forEach((run, index) => {
    const item = rule[index];
    if (!item) return;

    // A run holds one kind, so the rule for that kind sees exactly the nodes in
    // this stretch, not the section's other content of the same kind.
    const runCtx: RuleContext = { heading: ctx.heading, position: run.position };
    const key = runKeys[index] ?? null;

    switch (key) {
      case "paragraphs":
        findings.push(...checkParagraphsIn(run.nodes, item.paragraphs, runCtx));
        break;
      case "code_blocks":
        findings.push(...checkCodeBlocksIn(run.nodes, item.code_blocks, runCtx));
        break;
      case "lists":
        findings.push(...checkListsIn(run.nodes, item.lists, runCtx));
        break;
      default:
        findings.push({
          type: "sequence_order_error",
          heading: ctx.heading,
          message: `Unexpected content type (${key}) found in sequence`,
          position: ctx.position,
          severity: "error",
        });
    }
  });

  return findings;
}

/** Maps a content kind onto the template key that names it. */
function sequenceKeyOf(kind: ContentKind): SequenceKey | null {
  switch (kind) {
    case "paragraph":
      return "paragraphs";
    case "code":
      return "code_blocks";
    case "list":
      return "lists";
    default:
      return null;
  }
}
