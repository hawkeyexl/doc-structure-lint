import { ValidationError } from "./ValidationError.js";

/**
 * Validates that the heading of a section matches a constant value specified in the template.
 *
 * @param {Object} section - The section object containing the heading to validate.
 * @param {Object} template - The template object containing the expected heading constant.
 * @param {Object} template.heading - The heading object within the template.
 * @param {string} template.heading.const - The constant value that the section heading should match.
 * @param {Object} section.heading - The heading object within the section.
 * @param {string} section.heading.content - The actual heading content of the section.
 * @param {Object} section.position - The position object indicating the location of the section.
 * @returns {ValidationError|null} - Returns a ValidationError if the heading does not match the constant, otherwise null.
 */
function checkHeadingConst(section, template) {
  if (!template.heading?.const) return null;

  if (section.heading.content !== template.heading.const) {
    return new ValidationError(
      "heading_const_error",
      section.heading.content,
      `Expected title "${template.heading.const}", but found "${section.heading.content}"`,
      section.position
    );
  }
  return null;
}

/**
 * Validates the heading of a section against a specified pattern in the template.
 *
 * @param {Object} section - The section object containing the heading to be validated.
 * @param {Object} template - The template object containing the heading pattern to validate against.
 * @param {Object} template.heading - The heading object within the template.
 * @param {RegExp} template.heading.pattern - The regular expression pattern to validate the heading against.
 * @param {Object} section.heading - The heading object within the section.
 * @param {string} section.heading.content - The content of the heading to be validated.
 * @param {Object} section.position - The position object indicating the location of the section.
 * @returns {ValidationError|null} Returns a ValidationError if the heading does not match the pattern, otherwise null.
 */
function checkHeadingPattern(section, template) {
  if (!template.heading?.pattern) return null;

  if (!template.heading.pattern.test(section.heading.content)) {
    return new ValidationError(
      "heading_pattern_error",
      section.heading.content,
      `Title "${section.heading.content}" doesn't match pattern "${template.heading.pattern}"`,
      section.position
    );
  }
  return null;
}

/**
 * Validates the heading of a given section against a template.
 *
 * @param {Object} section - The section object containing the heading to be validated.
 * @param {Object} template - The template object containing the heading rules.
 * @returns {Array} An array of error messages, if any.
 */
export function validateHeading(section, template) {
  const errors = [];
  if (!template.heading) return errors;

  const constError = checkHeadingConst(section, template);
  if (constError) errors.push(constError);

  const patternError = checkHeadingPattern(section, template);
  if (patternError) errors.push(patternError);

  return errors;
}
