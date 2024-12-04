import { ValidationError } from "./ValidationError.js";

/**
 * Validates that a section contains at least a minimum number of paragraphs.
 *
 * @param {Object} section - The section to validate.
 * @param {number} minCount - The minimum number of paragraphs required.
 * @returns {ValidationError|null} - Returns a ValidationError if the section has fewer paragraphs than the minimum count, otherwise returns null.
 */
function validateMinParagraphs(section, minCount) {
  if (minCount && section.paragraphs.length < minCount) {
    return new ValidationError(
      "paragraphs_count_error",
      section.heading?.content,
      `Expected at least ${minCount} paragraphs, but found ${section.paragraphs.length}`,
      section.position
    );
  }
  return null;
}

/**
 * Validates the number of paragraphs in a section against a maximum count.
 *
 * @param {Object} section - The section to validate.
 * @param {Array} section.paragraphs - The paragraphs in the section.
 * @param {Object} section.heading - The heading of the section.
 * @param {string} section.heading.content - The content of the heading.
 * @param {Object} section.position - The position of the section in the document.
 * @param {number} maxCount - The maximum allowed number of paragraphs.
 * @returns {ValidationError|null} - Returns a ValidationError if the number of paragraphs exceeds the maximum count, otherwise returns null.
 */
function validateMaxParagraphs(section, maxCount) {
  if (maxCount && section.paragraphs.length > maxCount) {
    return new ValidationError(
      "paragraphs_count_error",
      section.heading?.content,
      `Expected at most ${maxCount} paragraphs, but found ${section.paragraphs.length}`,
      section.position
    );
  }
  return null;
}

/**
 * Validates the paragraphs in a section against a set of patterns.
 *
 * @param {Object} section - The section containing paragraphs to validate.
 * @param {Array<RegExp>} patterns - An array of regular expression patterns to validate paragraphs against.
 * @returns {Array<ValidationError>} An array of validation errors, if any.
 */
function validateParagraphPatterns(section, patterns) {
  const errors = [];
  if (!patterns) return errors;

  section.paragraphs.forEach((paragraph, index) => {
    const pattern = patterns[index % patterns.length];
    if (pattern && !pattern.test(paragraph.content)) {
      errors.push(
        new ValidationError(
          "paragraph_pattern_error",
          section.heading?.content,
          `Paragraph does not match pattern: ${pattern}`,
          paragraph.position
        )
      );
    }
  });

  return errors;
}

/**
 * Validates the paragraphs of a given section against a template.
 *
 * @param {Object} section - The section to validate.
 * @param {Object} template - The template containing paragraph validation rules.
 * @param {Object} template.paragraphs - The paragraph validation rules.
 * @param {number} [template.paragraphs.min] - The minimum number of paragraphs required.
 * @param {number} [template.paragraphs.max] - The maximum number of paragraphs allowed.
 * @param {Array<RegExp>} [template.paragraphs.patterns] - An array of regular expressions to validate paragraph patterns.
 * @returns {Array<string>} An array of error messages, if any.
 */
export function validateParagraphs(section, template) {
  const errors = [];

  if (template.paragraphs) {
    const minError = validateMinParagraphs(section, template.paragraphs.min);
    if (minError) errors.push(minError);

    const maxError = validateMaxParagraphs(section, template.paragraphs.max);
    if (maxError) errors.push(maxError);

    errors.push(
      ...validateParagraphPatterns(section, template.paragraphs.patterns)
    );
  }

  return errors;
}
