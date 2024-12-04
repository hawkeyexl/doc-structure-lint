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
      message: `Expected sequence ${JSON.stringify(templateItemTypes)}, but found sequence ${JSON.stringify(structureItemTypes)}`,
      position: structure.position,
    });
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
    }
  }

  return errors;
}
