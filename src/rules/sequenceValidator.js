import { validateParagraphs } from "./paragraphsValidator.js";
import { validateCodeBlocks } from "./codeBlocksValidator.js";
import { validateLists } from "./listValidator.js";
import { ValidationError } from "./ValidationError.js";

export function validateSequence(structure, template) {
  const errors = [];
  if (!template.sequence || !structure.content) return errors;

  // Check sequence length
  if (template.sequence.length !== structure.content.length) {
    errors.push(new ValidationError(
      "sequence_length_error",
      structure.heading.content,
      `Expected ${template.sequence.length} content types in sequence, but found ${structure.content.length}`,
      structure.position
    ));
    return errors;
  }

  // Check sequence order
  const templateItemTypes = template.sequence.map(item => Object.keys(item)[0]);
  const structureItemTypes = structure.content.map(item => {
    if (Object.hasOwn(item, "paragraphs")) {
      return "paragraphs";
    } else if (Object.hasOwn(item, "code_blocks")) {
      return "code_blocks";
    } else if (Object.hasOwn(item, "lists")) {
      return "lists";
    } else {
      return null;
    }
  });
  // Check for unexpected content types
  if (structureItemTypes.includes(null)) {
    errors.push(new ValidationError(
      "sequence_order_error",
      structure.heading.content,
      `Unexpected content type (${type}) found in sequence`,
      structure.position
    ));
    return errors;
  }
  // Check for sequence order mismatch
  if (JSON.stringify(templateItemTypes) !== JSON.stringify(structureItemTypes)) {
    errors.push(new ValidationError(
      "sequence_order_error",
      structure.heading.content,
      `Expected sequence ${JSON.stringify(templateItemTypes)}, but found sequence ${JSON.stringify(structureItemTypes)}`,
      structure.position
    ));
    return errors;
  }

  // Validate each sequence item against rules
  for (
    let index = 0;
    index < template.sequence.length;
    index++
  ) {
    const templateItem = template.sequence[index];
    const structureItem = structure.content[index];
    const type = templateItemTypes[index];

    switch (type) {
      case "paragraphs":
        errors.push(...validateParagraphs(structureItem, templateItem));
        break;

      case "code_blocks":
        errors.push(...validateCodeBlocks(structureItem, templateItem));
        break;

      case "lists":
        errors.push(...validateLists(structureItem, templateItem));
        break;

      default:
        errors.push(new ValidationError(
          "sequence_order_error",
          structure.heading.content,
          `Unexpected content type (${type}) found in sequence`,
          structure.position
        ));
    }
  }

  return errors;
}
