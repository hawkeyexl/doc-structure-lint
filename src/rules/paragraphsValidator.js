export function validateParagraphs(section, template) {
  const errors = [];

  if (template.paragraphs) {
    // Max
    if (
      template.paragraphs.min &&
      section.paragraphs.length < template.paragraphs.min
    ) {
      errors.push({
        head: section.heading.content,
        startIndex: section.startIndex,
        endIndex: section.endIndex,
        message: `Expected at least ${template.paragraphs.min} paragraphs, but found ${section.paragraphs.length}`,
      });
    }

    // Min
    if (
      template.paragraphs.max &&
      section.paragraphs.length > template.paragraphs.max
    ) {
      errors.push({
        head: section.heading.content,
        startIndex: section.startIndex,
        endIndex: section.endIndex,
        message: `Expected at most ${template.paragraphs.max} paragraphs, but found ${section.paragraphs.length}`,
      });
    }
  }

  return errors;
}
