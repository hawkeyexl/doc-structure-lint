/**
 * `lists:` - list counts, item counts, and per-item content requirements.
 */

import type { ContentNode, Finding, SectionNode } from "../types.js";
import {
  listsOf,
  sectionContext,
  type ListsRule,
  type RuleContext,
} from "./index.js";
import { checkParagraphsIn } from "./paragraphs.js";
import { checkCodeBlocksIn } from "./code-blocks.js";

/** Checks the lists a section holds directly. */
export function checkLists(
  section: SectionNode,
  rule: ListsRule | undefined
): Finding[] {
  return checkListsIn(section.content, rule, sectionContext(section));
}

/**
 * The reusable core: checks the lists in any ordered content list.
 *
 * `rule.items` recurses - a list item's children are a `ContentNode[]` like any
 * other, so item-level paragraph/code/list requirements run through the same
 * functions, arbitrarily deep.
 */
export function checkListsIn(
  content: ContentNode[],
  rule: ListsRule | undefined,
  ctx: RuleContext
): Finding[] {
  const findings: Finding[] = [];
  if (!rule) return findings;

  const lists = listsOf(content);

  if (rule.min && lists.length < rule.min) {
    findings.push({
      type: "lists_count_error",
      heading: ctx.heading,
      message: `Expected at least ${rule.min} lists, but found ${lists.length}`,
      position: ctx.position,
      severity: "error",
    });
  }

  if (rule.max !== undefined && lists.length > rule.max) {
    findings.push({
      type: "lists_count_error",
      heading: ctx.heading,
      message: `Expected at most ${rule.max} lists, but found ${lists.length}`,
      position: ctx.position,
      severity: "error",
    });
  }

  const items = rule.items;
  if (!items) return findings;

  // Item counts report once for the whole rule, however many lists break it,
  // anchored at the first list that does.
  const maxItems = items.max;
  if (maxItems !== undefined) {
    const offender = lists.find((list) => list.items.length > maxItems);
    if (offender) {
      findings.push({
        type: "list_items_count_error",
        heading: ctx.heading,
        message: `Expected at most ${maxItems} items in a list`,
        position: offender.position,
        severity: "error",
      });
    }
  }

  const minItems = items.min;
  if (minItems !== undefined) {
    const offender = lists.find((list) => list.items.length < minItems);
    if (offender) {
      findings.push({
        type: "list_items_count_error",
        heading: ctx.heading,
        message: `Expected at least ${minItems} items in a list`,
        position: offender.position,
        severity: "error",
      });
    }
  }

  if (!items.paragraphs && !items.code_blocks && !items.lists) return findings;

  for (const list of lists) {
    for (const item of list.items) {
      const itemCtx: RuleContext = {
        heading: ctx.heading,
        position: item.position,
      };
      findings.push(...checkParagraphsIn(item.children, items.paragraphs, itemCtx));
      findings.push(...checkCodeBlocksIn(item.children, items.code_blocks, itemCtx));
      findings.push(...checkListsIn(item.children, items.lists, itemCtx));
    }
  }

  return findings;
}
