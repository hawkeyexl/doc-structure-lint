import { ValidationError } from "./ValidationError.js";

export function validateLists(section, template) {
  const errors = [];
  if (!template.lists || !section.lists) return errors;

  // Min lists
  if (template.lists.min && section.lists.length < template.lists.min) {
    errors.push(new ValidationError(
      "lists_count_error",
      section.heading?.content,
      `Expected at least ${template.lists.min} lists, but found ${section.lists.length}`,
      section.position
    ));
  }

  // Max lists
  if (template.lists.max && section.lists.length > template.lists.max) {
    errors.push(new ValidationError(
      "lists_count_error",
      section.heading?.content,
      `Expected at most ${template.lists.max} lists, but found ${section.lists.length}`,
      section.position
    ));
  }

  // Max items
  if (
    template.lists.items &&
    template.lists.items.max &&
    section.lists.some((list) => list.items.length > template.lists.items.max)
  ) {
    errors.push(new ValidationError(
      "list_items_count_error",
      section.heading?.content,
      `Expected at most ${template.lists.items.max} items in a list`,
      section.position
    ));
  }

  // Min items
  if (
    template.lists.items &&
    template.lists.items.min &&
    section.lists.some((list) => list.items.length < template.lists.items.min)
  ) {
    errors.push(new ValidationError(
      "list_items_count_error",
      section.heading?.content,
      `Expected at least ${template.lists.items.min} items in a list`,
      section.position
    ));
  }

  return errors;
}
