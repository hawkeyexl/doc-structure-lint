import { ValidationError } from "./ValidationError.js";

/**
 * Validates that a section contains at least the minimum number of code blocks specified in the template.
 *
 * @param {Object} section - The section to validate.
 * @param {Object} section.codeBlocks - An array of code blocks in the section.
 * @param {Object} section.heading - The heading of the section.
 * @param {Object} section.heading.content - The content of the heading.
 * @param {Object} section.position - The position of the section in the document.
 * @param {Object} template - The template containing validation rules.
 * @param {Object} template.code_blocks - The code block validation rules.
 * @param {number} template.code_blocks.min - The minimum number of code blocks required.
 * @returns {ValidationError|null} - Returns a ValidationError if the section does not meet the minimum code block requirement, otherwise returns null.
 */
function checkMinCodeBlocks(section, template) {
  if (!template.code_blocks?.min) return null;
  
  if (section.codeBlocks.length < template.code_blocks.min) {
    return new ValidationError(
      "code_blocks_count_error",
      section.heading?.content,
      `Expected at least ${template.code_blocks.min} code blocks, but found ${section.codeBlocks.length}`,
      section.position
    );
  }
  return null;
}

/**
 * Validates the number of code blocks in a section against the maximum allowed by the template.
 *
 * @param {Object} section - The section to validate.
 * @param {Array} section.codeBlocks - The code blocks in the section.
 * @param {Object} section.heading - The heading of the section.
 * @param {Object} section.position - The position of the section in the document.
 * @param {Object} template - The template containing validation rules.
 * @param {Object} template.code_blocks - The code block validation rules.
 * @param {number} template.code_blocks.max - The maximum number of code blocks allowed.
 * @returns {ValidationError|null} - Returns a ValidationError if the number of code blocks exceeds the maximum, otherwise null.
 */
function checkMaxCodeBlocks(section, template) {
  if (!template.code_blocks?.max) return null;
  
  if (section.codeBlocks.length > template.code_blocks.max) {
    return new ValidationError(
      "code_blocks_count_error",
      section.heading?.content,
      `Expected at most ${template.code_blocks.max} code blocks, but found ${section.codeBlocks.length}`,
      section.position
    );
  }
  return null;
}

/**
 * Validates the code blocks in a given section against a template.
 *
 * @param {Object} section - The section to validate.
 * @param {Array} section.codeBlocks - The code blocks in the section.
 * @param {Object} template - The template to validate against.
 * @param {Array} template.code_blocks - The code blocks in the template.
 * @returns {Array} An array of error messages, if any.
 */
export function validateCodeBlocks(section, template) {
  const errors = [];
  if (!template.code_blocks || !section.codeBlocks) return errors;

  const minError = checkMinCodeBlocks(section, template);
  if (minError) errors.push(minError);

  const maxError = checkMaxCodeBlocks(section, template);
  if (maxError) errors.push(maxError);

  return errors;
}
