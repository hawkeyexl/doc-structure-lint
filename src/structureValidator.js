export function validateStructure(section, template, path = []) {
  const errors = [];

  // Check title
  if (template.title && template.title.const && section.title !== template.title.const) {
    errors.push({
      head: section.title,
      startIndex: section.startIndex,
      endIndex: section.endIndex,
      message: `Expected title "${template.title.const}", but found "${section.title}"`,
    });
  }

  // Check paragraphs
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

  // Check code blocks
  if (template.code_blocks) {
    if (
      template.code_blocks.min &&
      section.code_blocks < template.code_blocks.min
    ) {
      errors.push({
        head: section.title,
        startIndex: section.startIndex,
        endIndex: section.endIndex,
        message: `Expected at least ${template.code_blocks.min} code blocks, but found ${section.code_blocks}`,
      });
    }
    if (
      template.code_blocks.max &&
      section.code_blocks > template.code_blocks.max
    ) {
      errors.push({
        head: section.title,
        startIndex: section.startIndex,
        endIndex: section.endIndex,
        message: `Expected at most ${template.code_blocks.max} code blocks, but found ${section.code_blocks}`,
      });
    }
  }

  // Check subsections
  if (template.sections) {
    const expectedSections = new Set(Object.keys(template.sections));
    const foundSections = new Set(section.subsections.map((s) => s.title));

    for (const expectedSection of expectedSections) {
      if (
        !foundSections.has(expectedSection) &&
        template.sections[expectedSection].required !== false
      ) {
        errors.push({
          head: section.title,
          startIndex: section.startIndex,
          endIndex: section.endIndex,
          message: `Missing required section "${expectedSection}"`,
        });
      }
    }

    if (!template.additionalSections) {
      for (const foundSection of foundSections) {
        if (!expectedSections.has(foundSection)) {
          const unexpectedSection = section.subsections.find(s => s.title === foundSection);
          errors.push({
            head: unexpectedSection.title,
            startIndex: unexpectedSection.startIndex,
            endIndex: unexpectedSection.endIndex,
            message: `Unexpected section "${foundSection}"`,
          });
        }
      }
    }

    for (const subsection of section.subsections) {
      const subsectionTemplate = template.sections[subsection.title];
      if (subsectionTemplate) {
        errors.push(
          ...validateStructure(
            subsection,
            subsectionTemplate,
            [...path, subsection.title]
          )
        );
      }
    }
  }

  return errors;
}
