export function validateParagraphs(section, template) {
  const errors = [];

  if (template.paragraphs) {
    if (
      template.paragraphs.min &&
      section.paragraphs < template.paragraphs.min
    ) {
      errors.push({
        head: section.title,
        startIndex: section.startIndex,
        endIndex: section.endIndex,
        message: `Expected at least ${template.paragraphs.min} paragraphs, but found ${section.paragraphs}`,
      });
    }
    if (
      template.paragraphs.max &&
      section.paragraphs > template.paragraphs.max
    ) {
      errors.push({
        head: section.title,
        startIndex: section.startIndex,
        endIndex: section.endIndex,
        message: `Expected at most ${template.paragraphs.max} paragraphs, but found ${section.paragraphs}`,
      });
    }
  }

  return errors;
}
