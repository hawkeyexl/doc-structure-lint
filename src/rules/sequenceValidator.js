import { validateParagraphs } from "./paragraphsValidator.js";
import { validateCodeBlocks } from "./codeBlocksValidator.js";
import { validateLists } from "./listValidator.js";

export function validateSequence(structure, template) {
  const errors = [];
  if (!template.sequence || !structure.content) return errors;

  // Check sequence length
  if (template.sequence.length !== structure.content.length) {
    errors.push({
      type: "sequence_length_error",
      head: structure.heading.content,
      message: `Expected ${template.sequence.length} content types in sequence, but found ${structure.content.length}`,
      position: structure.position,
    });
    return errors;
  }

  // Check sequence order
  const templateItemTypes = template.sequence.map(item => Object.keys(item)[0]);
  const structureItemTypes = structure.content.map(item => {
    if (item.hasOwnProperty("paragraphs")) {
      return "paragraphs";
    } else if (item.hasOwnProperty("code_blocks")) {
      return "code_blocks";
    } else if (item.hasOwnProperty("lists")) {
      return "lists";
    }
  });
  if (JSON.stringify(templateItemTypes) !== JSON.stringify(structureItemTypes)) {
    errors.push({
      type: "sequence_order_error",
      head: structure.heading.content,
      message: `Expected ${JSON.stringify(templateItemTypes)} but found ${JSON.stringify(structureItemTypes)}`,
      position: structure.position,
    });
    return errors;
  }

  for (
    let sequencePosition = 0;
    sequencePosition < template.sequence.length;
    sequencePosition++
  ) {
    // Get template sequence item and structure item
    const templateItem = template.sequence[sequencePosition];
    const templateItemType = Object.keys(templateItem)[0];

    let structureItem = structure.content[sequencePosition];
    let structureItemType;

    if (structureItem.hasOwnProperty("paragraphs")) {
      structureItemType = "paragraphs";
    } else if (structureItem.hasOwnProperty("code_blocks")) {
      structureItemType = "code_blocks";
    } else if (structureItem.hasOwnProperty("lists")) {
      structureItemType = "lists";
    }

    // Validate sequence order with position information
    if (structureItemType !== templateItemType) {
      errors.push({
        type: "sequence_order_error",
        head: structureItem.heading.content,
        message: `Expected ${templateItemType} but found ${structureItemType}`,
        position: structureItem.position,
      });
      break;
    }

    // Validate content type specific rules with position context
    switch (templateItemType) {
      case "paragraphs":
        errors.push(...validateParagraphs(structureItem, templateItem));
        break;

      case "code_blocks":
        errors.push(...validateCodeBlocks(structureItem, templateItem));
        break;

      case "lists":
        errors.push(...validateLists(structureItem, templateItem));
        break;
    }
  }

  // Check for content not defined in sequence
  const definedTypes = new Set(template.sequence.map((structureItem) => structureItem.type));
  const unexpectedContent = structure.content.filter(
    (structureItem) => !definedTypes.has(structureItem.type)
  );

  if (unexpectedContent.length > 0) {
    errors.push({
      type: "sequence_unexpected_content",
      message: `Found ${unexpectedContent.length} content elements not defined in sequence`,
      position: unexpectedContent[0].element?.position,
    });
  }

  return errors;
}
