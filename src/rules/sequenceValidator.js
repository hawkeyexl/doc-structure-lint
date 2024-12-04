import { validateParagraphs } from "./paragraphsValidator.js";
import { validateCodeBlocks } from "./codeBlocksValidator.js";
import { validateLists } from "./listValidator.js";
import { ValidationError } from "./ValidationError.js";

/**
 * Validates that the length of the sequence in the structure matches the length of the sequence in the template.
 *
 * @param {Object} structure - The structure object to validate.
 * @param {Object} structure.content - The content array of the structure.
 * @param {Object} structure.heading - The heading object of the structure.
 * @param {string} structure.heading.content - The content of the heading.
 * @param {Object} structure.position - The position object of the structure.
 * @param {Object} template - The template object to validate against.
 * @param {Array} template.sequence - The sequence array of the template.
 * @returns {ValidationError|null} Returns a ValidationError if the sequence lengths do not match, otherwise returns null.
 */
function checkSequenceLength(structure, template) {
  if (template.sequence.length !== structure.content.length) {
    return new ValidationError(
      "sequence_length_error",
      structure.heading.content,
      `Expected ${template.sequence.length} content types in sequence, but found ${structure.content.length}`,
      structure.position
    );
  }
  return null;
}

/**
 * Maps the structure items to their respective types.
 *
 * @param {Object} structure - The structure object containing content items.
 * @param {Array} structure.content - An array of content items.
 * @param {Object} structure.content[].paragraphs - Optional paragraphs property of a content item.
 * @param {Object} structure.content[].code_blocks - Optional code_blocks property of a content item.
 * @param {Object} structure.content[].lists - Optional lists property of a content item.
 * @returns {Array<string|null>} An array of strings representing the type of each content item, or null if no type matches.
 */
function mapStructureItemTypes(structure) {
  return structure.content.map(item => {
    if (Object.hasOwn(item, "paragraphs")) return "paragraphs";
    if (Object.hasOwn(item, "code_blocks")) return "code_blocks";
    if (Object.hasOwn(item, "lists")) return "lists";
    return null;
  });
}

/**
 * Validates the order of items in a given structure against a template sequence.
 *
 * @param {Object} structure - The structure to validate.
 * @param {Object} template - The template containing the expected sequence.
 * @param {Array} template.sequence - The expected sequence of item types.
 * @returns {ValidationError|null} - Returns a ValidationError if the sequence order is incorrect, otherwise null.
 */
function checkSequenceOrder(structure, template) {
  const templateItemTypes = template.sequence.map(item => Object.keys(item)[0]);
  const structureItemTypes = mapStructureItemTypes(structure);

  if (structureItemTypes.includes(null)) {
    return new ValidationError(
      "sequence_order_error",
      structure.heading.content,
      "Unexpected content type found in sequence",
      structure.position
    );
  }

  if (JSON.stringify(templateItemTypes) !== JSON.stringify(structureItemTypes)) {
    return new ValidationError(
      "sequence_order_error",
      structure.heading.content,
      `Expected sequence ${JSON.stringify(templateItemTypes)}, but found sequence ${JSON.stringify(structureItemTypes)}`,
      structure.position
    );
  }
  return null;
}

/**
 * Validates a sequence item based on its type.
 *
 * @param {Object} structure - The overall structure containing the sequence.
 * @param {Object} templateItem - The template item to validate against.
 * @param {Object} structureItem - The actual structure item to validate.
 * @param {string} type - The type of the sequence item (e.g., "paragraphs", "code_blocks", "lists").
 * @returns {Array|ValidationError[]} - Returns an array of validation errors if any, otherwise an empty array.
 */
function validateSequenceItem(structure, templateItem, structureItem, type) {
  switch (type) {
    case "paragraphs":
      return validateParagraphs(structureItem, templateItem);
    case "code_blocks":
      return validateCodeBlocks(structureItem, templateItem);
    case "lists":
      return validateLists(structureItem, templateItem);
    default:
      return [new ValidationError(
        "sequence_order_error",
        structure.heading.content,
        `Unexpected content type (${type}) found in sequence`,
        structure.position
      )];
  }
}

/**
 * Validates the sequence of the given structure against the provided template.
 *
 * @param {Object} structure - The structure to be validated.
 * @param {Object} template - The template containing the expected sequence.
 * @returns {Array} An array of error messages, if any.
 */
export function validateSequence(structure, template) {
  const errors = [];
  if (!template.sequence || !structure.content) return errors;

  const lengthError = checkSequenceLength(structure, template);
  if (lengthError) {
    errors.push(lengthError);
    return errors;
  }

  const orderError = checkSequenceOrder(structure, template);
  if (orderError) {
    errors.push(orderError);
    return errors;
  }

  const templateItemTypes = template.sequence.map(item => Object.keys(item)[0]);
  for (let index = 0; index < template.sequence.length; index++) {
    errors.push(...validateSequenceItem(
      structure,
      template.sequence[index],
      structure.content[index],
      templateItemTypes[index]
    ));
  }

  return errors;
}
