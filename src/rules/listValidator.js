import { ValidationError } from "./ValidationError.js";

/**
 * Checks if the number of lists in a section meets the minimum required by the template.
 *
 * @param {Object} section - The section to validate.
 * @param {Array} section.lists - The lists in the section.
 * @param {Object} section.heading - The heading of the section.
 * @param {string} section.heading.content - The content of the heading.
 * @param {Object} section.position - The position of the section in the document.
 * @param {Object} template - The template to validate against.
 * @param {Object} template.lists - The lists configuration in the template.
 * @param {number} template.lists.min - The minimum number of lists required.
 * @returns {ValidationError|null} - Returns a ValidationError if the section does not meet the minimum list requirement, otherwise null.
 */
function checkMinLists(section, template) {
  if (!template.lists?.min) return null;

  if (section.lists.length < template.lists.min) {
    return new ValidationError(
      "lists_count_error",
      section.heading?.content,
      `Expected at least ${template.lists.min} lists, but found ${section.lists.length}`,
      section.position
    );
  }
  return null;
}

/**
 * Checks if the number of lists in a section exceeds the maximum allowed by the template.
 *
 * @param {Object} section - The section to validate.
 * @param {Array} section.lists - The lists in the section.
 * @param {Object} section.heading - The heading of the section.
 * @param {string} section.heading.content - The content of the heading.
 * @param {Object} section.position - The position of the section in the document.
 * @param {Object} template - The template to validate against.
 * @param {Object} template.lists - The lists configuration in the template.
 * @param {number} template.lists.max - The maximum number of lists allowed.
 * @returns {ValidationError|null} - Returns a ValidationError if the number of lists exceeds the maximum, otherwise null.
 */
function checkMaxLists(section, template) {
  if (!template.lists?.max) return null;

  if (section.lists.length > template.lists.max) {
    return new ValidationError(
      "lists_count_error",
      section.heading?.content,
      `Expected at most ${template.lists.max} lists, but found ${section.lists.length}`,
      section.position
    );
  }
  return null;
}

/**
 * Checks if any list in the given section exceeds the maximum number of items specified in the template.
 *
 * @param {Object} section - The section of the document to validate.
 * @param {Object} section.lists - The lists within the section.
 * @param {Array} section.lists.items - The items within each list.
 * @param {Object} section.heading - The heading of the section.
 * @param {Object} section.heading.content - The content of the heading.
 * @param {Object} section.position - The position of the section in the document.
 * @param {Object} template - The template containing validation rules.
 * @param {Object} template.lists - The list validation rules in the template.
 * @param {Object} template.lists.items - The item validation rules in the template.
 * @param {number} template.lists.items.max - The maximum number of items allowed in a list.
 * @returns {ValidationError|null} - Returns a ValidationError if any list exceeds the maximum number of items, otherwise returns null.
 */
function checkMaxListItems(section, template) {
  if (!template.lists?.items?.max) return null;

  if (section.lists.some((list) => list.items.length > template.lists.items.max)) {
    return new ValidationError(
      "list_items_count_error",
      section.heading?.content,
      `Expected at most ${template.lists.items.max} items in a list`,
      section.position
    );
  }
  return null;
}

/**
 * Validates that each list in the given section has at least the minimum number of items specified in the template.
 *
 * @param {Object} section - The section of the document to validate.
 * @param {Object} section.lists - The lists within the section.
 * @param {Array} section.lists.items - The items within each list.
 * @param {Object} section.heading - The heading of the section.
 * @param {string} section.heading.content - The content of the heading.
 * @param {Object} section.position - The position of the section in the document.
 * @param {Object} template - The template specifying validation rules.
 * @param {Object} template.lists - The list validation rules in the template.
 * @param {Object} template.lists.items - The item validation rules for lists.
 * @param {number} template.lists.items.min - The minimum number of items required in each list.
 * @returns {ValidationError|null} - Returns a ValidationError if any list has fewer items than the minimum required, otherwise returns null.
 */
function checkMinListItems(section, template) {
  if (!template.lists?.items?.min) return null;

  if (section.lists.some((list) => list.items.length < template.lists.items.min)) {
    return new ValidationError(
      "list_items_count_error",
      section.heading?.content,
      `Expected at least ${template.lists.items.min} items in a list`,
      section.position
    );
  }
  return null;
}

/**
 * Validates the lists in a section against a template.
 *
 * @param {Object} section - The section to validate.
 * @param {Object} template - The template to validate against.
 * @param {Array} template.lists - The lists defined in the template.
 * @param {Array} section.lists - The lists defined in the section.
 * @returns {Array} An array of error messages, if any.
 */
export function validateLists(section, template) {
  const errors = [];
  if (!template.lists || !section.lists) return errors;

  const minListsError = checkMinLists(section, template);
  if (minListsError) errors.push(minListsError);

  const maxListsError = checkMaxLists(section, template);
  if (maxListsError) errors.push(maxListsError);

  const maxItemsError = checkMaxListItems(section, template);
  if (maxItemsError) errors.push(maxItemsError);

  const minItemsError = checkMinListItems(section, template);
  if (minItemsError) errors.push(minItemsError);

  return errors;
}
