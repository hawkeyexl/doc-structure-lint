export function validateLists(section, template) {
  const errors = [];

  if (template.lists) {
    // Max
    if (
      template.lists.min &&
      section.lists.length < template.lists.min
    ) {
      errors.push({
        head: section.heading.content,
        position: section.position,
        message: `Expected at least ${template.lists.min} lists, but found ${section.lists.length}`,
      });
    }

    // Min
    if (
      template.lists.max &&
      section.lists.length > template.lists.max
    ) {
      errors.push({
        head: section.heading.content,
        position: section.position,
        message: `Expected at most ${template.lists.max} lists, but found ${section.lists.length}`,
      });
    }
  }

  // Max items
  if (
    template.lists.items &&
    template.lists.items.max &&
    section.lists.some((list) => list.items.length > template.lists.items.max)
  ) {
    errors.push({
      head: section.heading.content,
      position: section.position,
      message: `Expected at most ${template.lists.items.max} items in a list`,
    });
  }

  // Min items
  if (
    template.lists.items &&
    template.lists.items.min &&
    section.lists.some((list) => list.items.length < template.lists.items.min)
  ) {
    errors.push({
      head: section.heading.content,
      position: section.position,
      message: `Expected at least ${template.lists.items.min} items in a list`,
    });
  }

  return errors;
}
