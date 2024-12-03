import { validateParagraphs } from "./paragraphsValidator.js";
import { validateCodeBlocks } from "./codeBlocksValidator.js";
import { validateLists } from "./listValidator.js";

export function validateSequence(structure, template) {
  const errors = [];
  if (!template.sequence || !structure.content) return errors;

  for (const seqItem of template.sequence) {
    const itemType = Object.keys(seqItem)[0];

    // Validate sequence order with position information
    for (const item of structure.content) {
      item.heading = structure.heading;

      const contentType = Object.keys(item)[0];
      if (contentType !== itemType) {
        errors.push({
          type: "sequence_order_error",
          head: item.heading.content,
          message: `${contentType} found out of sequence at position ${position}`,
          position: item.position,
        });
      }

      // Validate content type specific rules with position context
      switch (itemType) {
        case "paragraphs":
          errors.push(...validateParagraphs(item, seqItem));
          break;

        case "code_blocks":
          errors.push(...validateCodeBlocks(item, seqItem));
          break;

        case "lists":
          errors.push(...validateLists(item, seqItem));
          break;
      }
    }
  }

  // Check for content not defined in sequence
  const definedTypes = new Set(template.sequence.map((item) => item.type));
  const unexpectedContent = structure.content.filter(
    (item) => !definedTypes.has(item.type)
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
